# AI 面板深度优化路线图

| 项       | 内容                                                 |
| -------- | ---------------------------------------------------- |
| 文档版本 | v0.1                                                 |
| 阶段     | 跨里程碑规划（AI 工作区双模式 + 图表 + 管理）        |
| 配套     | [PRD.md](./PRD.md) · [TRD.md](./TRD.md)              |
| 目标     | 把 AI 操作数据库打磨成「编辑器 / AGENT」双模式工作区 |
| 最后更新 | 2026-06-16                                           |

---

## 0. 背景与核心思路

### 0.1 用户目标

用户希望 AI 操作数据库有**两种心智模型**，用一个统一入口承载：

- **编辑器模式**：人主导，AI 辅助。SQL 编辑器 + 自动补全 + 注释生成 SQL + 解释/优化/修复。
- **AGENT 模式**（对应 Trae Solo）：AI 主导，人监督。类 Codex 工作台——任务/会话列表 + 对话流 + AI 自主调用工具（查 schema、跑查询、存查询、画图），人在关键点介入。

### 0.2 已锁定的关键决策

| #   | 决策点       | 结论                                                            |
| --- | ------------ | --------------------------------------------------------------- |
| D-1 | 模式切换位置 | **全局顶栏**（影响当前工作区，Trae 式）                         |
| D-2 | 模式切换语义 | **保留上下文**（编辑器 ↔ AGENT 平滑切换，共享草稿/会话/schema） |
| D-3 | 模式命名     | **编辑器 / AGENT**                                              |

### 0.3 现状基线（来自代码勘察）

| 能力           | 现状                                                                                    | 落点                                             |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| LLM 调用       | OpenAI 兼容直调，**非流式**，温度 0.2，超时 60s                                         | `src/main/domain/llm/client.ts:39`               |
| AI 对话        | `AiChat` 全屏 tab，**对话仅存 React state，刷新即丢**，无多会话                         | `src/renderer/components/AiChat.tsx:51`          |
| AI 辅助        | explain/optimize/nl2sql/fixError 四种动作                                               | `src/renderer/components/AiAssistPanel.tsx`      |
| Monaco 补全    | **完全没有**，裸 SQL 模式，零 completion provider                                       | `src/renderer/config/monaco.ts`                  |
| 注释生成 SQL   | nl2sql 输入框（非注释触发器）                                                           | `src/renderer/components/SqlWorkspace.tsx:222`   |
| Schema 上下文  | 实时查目标库系统表，**无缓存**，Markdown 注入，裁剪 40 表/12k 字符                      | `src/main/domain/privacy/schema-context.ts:41`   |
| 顶层 Tab       | `tableData\|tableDetail\|sql\|chat\|database`，仅内存，无路由                           | `src/renderer/App.tsx:22-29`                     |
| 数据库详情页   | **单一表列表视图，无内部子 tab**                                                        | `src/renderer/components/DatabaseDetail.tsx`     |
| 已建表但零代码 | `chat_history` / `schema_cache` / `saved_queries` 三张占位表，**无 DAO、无 IPC、无 UI** | `src/main/infra/storage/migrations/001_init.sql` |
| 图表           | **完全没有**（无 echarts/recharts），PRD 标 P2                                          | —                                                |
| 用户/角色管理  | **没有**；现有 security 是 SQL 语句级权限判定，非 DB 用户管理                           | `src/main/domain/security/`                      |
| 数据库类型     | MySQL / PostgreSQL / SQLite / Redis 四种                                                | `src/main/domain/db/driver.ts:100`               |

> **关键结论**：绝大多数新功能要么有占位表已就绪（`saved_queries`/`chat_history`/`schema_cache`），要么有现成三件套范式可照搬（`sql-history-dao.ts` + `sql-history.ts` IPC + `SqlHistory.tsx` UI）。改造成本可控。

### 0.4 两条核心设计原则

1. **AGENT ≠ 无脑全自动**。数据库里 DDL/无 WHERE 的 UPDATE 不可逆，"全自动"必须分级：

   ```
   只读 (SELECT/SHOW/EXPLAIN)   →  全自动执行
   写操作 + dev 环境            →  自动执行
   写操作 + staging             →  一次性确认
   写操作 + prod / 高危 DDL     →  强确认 + 审计（强制人工）
   图表/分析生成                →  全自动
   ```

   复用现有 security 层（`domain/security/` 环境分级 + 危险 SQL 拦截 + `audit_log`）。UI 上对越界操作明确标注环境风险。

2. **两模式共享上下文**。编辑器里写到一半的 SQL、选中的表、会话历史，切到 AGENT 模式后 AI 可见可用——与 Trae「同一项目在两种模式切换」一致。

---

## 1. 总体架构

### 1.1 统一「AI 工作区」+ 双模式

引入统一工作区容器，承载顶部模式切换；两种模式共用一套上下文 store。

```
┌────────────────────────────────────────────────────────────┐
│  AiDbClient        [ 编辑器 ] ( AGENT )          ⚙ 设置     │ ← 全局顶栏模式切换
├──────────┬─────────────────────────────────────────────────┤
│          │  （编辑器模式）                （AGENT 模式）      │
│ 数据库    │  ┌────────────────────┐  ┌────────┬───────────┐ │
│  tree    │  │ SQL 编辑器           │  │ 任务/   │ 对话 +     │ │
│          │  │ + 补全/注释生成      │  │ 会话列表│ 工具调用流  │ │
│ conn1    │  │ + AI 辅助面板        │  │ • 月度…│ 🤖 查schema│ │
│  db_a    │  │                      │  │ • 用户…│ 🔧 listTbl │ │
│   t1     │  │                      │  │ • 新建 │ 📊 图表    │ │
│   t2     │  └────────────────────┘  └────────┴───────────┘ │
└──────────┴─────────────────────────────────────────────────┘
```

- 现有 `App.tsx` 里 `kind: 'sql'` 和 `kind: 'chat'` 两个并列 tab **合并为单一 `kind: 'workspace'` tab**，内部按模式渲染。
- 模式切换走全局顶栏，作用于当前激活的工作区 tab。

### 1.2 数据库详情页 tab 化（产物沉淀载体）

`DatabaseDetail.tsx` 从单一表列表视图，重构为内部多子 tab（参考 `TableDetail.tsx:29` 的 `columns|indexes|foreignKeys|ddl` 范式）：

```
数据库详情页（db_a）
├── 表        ← 现有表列表视图搬入
├── 查询      ← saved_queries 列表（新增）
├── 图表      ← charts 列表（新增）
└── 用户与权限 ← DB 用户/角色/权限（新增，按数据库能力按需显示）
```

### 1.3 实施顺序总览

```
阶段一（地基 + 速效）：0.1 流式 → 0.2 Schema 缓存 → 0.5 工作区骨架 → 1.1 自动补全 → 3.2 saved_queries
阶段二（AGENT 成型）  ：0.3 会话持久化 → 2.1 布局 → 2.4 工具调用 → 2.5/2.6/2.7
阶段三（沉淀载体）    ：3.1 DatabaseDetail tab 化 → 3.3/3.5 查询列表与联动
阶段四（图表）        ：4.0 选型 → 4.1 → 4.3 → 4.5 安全
阶段五（按需）        ：5.x 用户权限 / 6.x 横切打磨 / MCP
```

---

## 2. Phase 0 — 地基（横切，先行或并行）

> 范式 B（AGENT）和图表体验的硬前提。

### 2.1 验收标准

| #     | 验收项                                    | 验证方式    |
| ----- | ----------------------------------------- | ----------- |
| P0-D1 | LLM 流式输出，长 SQL/图表无 60s 空白等待  | 手动 + 单测 |
| P0-D2 | Schema 缓存命中，AI 调用不再每次查目标库  | 单测 + 性能 |
| P0-D3 | 对话/会话可持久化，刷新不丢、可重开       | 手动        |
| P0-D4 | 统一 AI 工作区容器可切换编辑器/AGENT 模式 | 手动        |
| P0-D5 | typecheck / lint / test 全绿              | CI          |

### 2.2 任务拆解

#### T0.1 LLM 流式输出（SSE）

**目标**：长 SQL / 图表 HTML 流式生成，告别 60s 空白等待。

**子任务**：

- T0.1.1 `llm/client.ts` 新增 `chatStream()`，基于 SSE 增量返回
- T0.1.2 `gateway.ts` 暴露流式接口，token 用量按累计 delta 计
- T0.1.3 IPC 新增 `ai:chatStream`（`shared/ipc.ts` + `preload/index.ts` 白名单同步）
- T0.1.4 前端对话/工作台增量渲染（逐 token 追加）
- T0.1.5 流式中断/超时/失败的兜底与重试

**依赖**：—（client.ts 注释已标 P1）
**落点**：`src/main/domain/llm/client.ts:39`、`src/main/domain/llm/gateway.ts:38`、`src/main/ipc/ai.ts`

#### T0.2 Schema 缓存

**目标**：AI 调用不再每次 N 次查目标库；支持失效/手动刷新。

**子任务**：

- T0.2.1 新增 `schema-cache-dao.ts`（表 `schema_cache` 已建），CRUD + 版本号
- T0.2.2 `schema-context.ts:buildSchemaContext` 改为先查缓存、miss 时回源并写缓存
- T0.2.3 失效策略：DDL 执行后（`executor.ts` 已有 `triggerRefresh` 机制）联动失效；ObjectTree 手动刷新联动失效
- T0.2.4 多 connection/schema 维度的缓存 key 设计
- T0.2.5 单测覆盖命中/失效/回源

**依赖**：—（占位表就绪）

#### T0.3 会话/任务持久化基础

**目标**：对话/任务可存可续（AGENT 模式地基）。

**子任务**：

- T0.3.1 新增 `chat-session-dao.ts`，复用 `chat_history` 表（确认字段是否够用，不够加迁移 `003_chat_sessions.sql`）
- T0.3.2 会话模型：session_id / 标题 / 关联 connection_id+schema / 创建时间 / 更新时间 / 消息列表
- T0.3.3 IPC：session 的 create/list/rename/delete + message 的 append/list
- T0.3.4 Zustand store 前端会话状态管理（与持久化同步）

**依赖**：—（占位表 `chat_history` 就绪）

#### T0.4 AI 上下文增强（可选，可与 Phase 1 并行）

**目标**：样本数据发送开关 + 列级脱敏，让 AI 生成更准且不泄密。

**子任务**：

- T0.4.1 `schema-context.ts` 增加「发送样本数据」开关（连接级配置，默认关）
- T0.4.2 列级脱敏（基于列名/类型正则，如 `*_email`/`*_phone`），脱敏后再入 context
- T0.4.3 prompt 模板同步说明"含样本数据"/"已脱敏"
- T0.4.4 审计：每次发送样本数据记 `audit_log`

**依赖**：T0.2（缓存样本更快）

#### T0.5 工作区模式架构（双模式承重墙）⭐

**目标**：建立统一「AI 工作区」容器，承载顶部模式切换；两模式共享上下文。

**子任务**：

- T0.5.1 新建 `WorkspaceContainer` 组件，含顶栏模式切换（编辑器 / AGENT）+ 模式 store
- T0.5.2 共享上下文 store：当前 connection / schema / 选中的表 / 草稿 SQL / 当前会话
- T0.5.3 `App.tsx` 顶层 tab：合并 `kind:'sql'` + `kind:'chat'` 为 `kind:'workspace'`；`getTabLabel`/右键菜单同步
- T0.5.4 全局顶栏模式按钮（应用级，作用于激活的工作区 tab）
- T0.5.5 模式切换语义：保留上下文平滑切换（不清空、不开新会话）
- T0.5.6 编辑器模式渲染 = 现有 `SqlWorkspace` + `AiAssistPanel`；AGENT 模式渲染 = 工作台（Phase 2 填充）

**依赖**：—（Phase 1/2 内容挂载点）

---

## 3. Phase 1 — 编辑器模式深度打磨

### 3.1 验收标准

| #     | 验收项                                            | 验证方式 |
| ----- | ------------------------------------------------- | -------- |
| P1-D1 | 输入表名/列名有自动补全（基于 schema）            | 手动     |
| T1.2  | SQL 关键字/函数/snippet 补全                      | 手动     |
| P1-D3 | 注释生成 SQL 流程顺畅，支持历史建议/多候选/直执行 | 手动     |
| P1-D4 | AI 辅助动作流式展示                               | 手动     |

### 3.2 任务拆解

#### T1.1 Schema-aware 自动补全 ⭐

**目标**：输入补全表名/列名/视图/别名，最大体验缺口。

**子任务**：

- T1.1.1 `monaco.ts` 注册 `CompletionItemProvider`（当前完全没接）
- T1.1.2 数据源复用 `db:listTables` / `db:describeTable` IPC（前端已具备）+ Schema 缓存（T0.2）
- T1.1.3 触发字符：`.`（列补全）、空格、字母；上下文感知（`FROM` 后补表、`SELECT`/`WHERE` 后补列）
- T1.1.4 别名解析：`FROM users u` 后 `u.` 触发 users 的列补全
- T1.1.5 补全项图标/分类（表/列/视图/关键字/函数）

**依赖**：T0.2（缓存加速）

#### T1.2 SQL 关键字 / 函数 / snippet 补全

**子任务**：

- T1.2.1 SQL 关键字字典（方言差异化）
- T1.2.2 常用函数（聚合 / 日期 / 字符串）
- T1.2.3 snippet 模板（`SELECT ... FROM ... JOIN ... ON ...`）

#### T1.3 Inline 幽灵补全（可选）

**子任务**：

- T1.3.1 `registerInlineCompletionsProvider` + 新 `ai:inlineComplete` IPC
- T1.3.2 基于上下文（schema + 已输入）调 LLM 生成整段灰字建议
- T1.3.3 debounce + 快速取消

**依赖**：T0.1（流式更佳）、T0.2

#### T1.4 注释生成 SQL 体验打磨

**目标**：现有 nl2sql-bar（`SqlWorkspace.tsx:222`）优化。

**子任务**：

- T1.4.1 历史建议下拉（基于 sql_history 提示词复用）
- T1.4.2 流式展示生成过程
- T1.4.3 生成后可直接执行（走安全层）

**依赖**：T0.1

#### T1.5 选中片段 AI 动作交互打磨

**子任务**：

- T1.5.1 explain/optimize/fix 流式展示（替换当前非流式 `ai:assist`）
- T1.5.2 结果卡片化：优化建议可一键应用、报错修复可一键替换

**依赖**：T0.1

#### T1.6 EXPLAIN 执行计划可视化（可选增强）

**子任务**：

- T1.6.1 EXPLAIN 结果表格化/树形化展示
- T1.6.2 高亮全表扫描 / 缺索引

---

## 4. Phase 2 — AGENT 模式工作台（核心）

> 把 `AiChat` 从"单轮聊天框"升级为"会调工具的 Agent 工作台"。

### 4.1 验收标准

| #     | 验收项                                                   | 验证方式    |
| ----- | -------------------------------------------------------- | ----------- |
| P2-D1 | 左 tree + 右 任务列表/会话 + 对话流 三栏布局             | 手动        |
| P2-D2 | 多会话新建/切换/重命名/删除，刷新不丢                    | 手动        |
| P2-D3 | AI 能自主调工具：查 schema、执行只读查询、生成/保存 SQL  | 手动 + 单测 |
| P2-D4 | 写操作走分级安全层：dev 自动、staging 确认、prod 强确认  | 手动 + 审计 |
| P2-D5 | SQL 执行报错 → AI 自动读错误 → 修正 → 重试（带次数上限） | 手动        |

### 4.2 任务拆解

#### T2.1 工作台布局重构

**目标**：左 tree + 右 任务列表/会话栏 + 对话区 三栏。

**子任务**：

- T2.1.1 重构/新建工作台组件（`AiChat.tsx` 或新 `AgentWorkspace.tsx`），作为 AGENT 模式渲染体（T0.5.6 填充）
- T2.1.2 三栏布局 + 响应式收折
- T2.1.3 任务/会话列表面板（T0.3 持久化对接）

**依赖**：T0.5（工作区骨架）、T0.3（会话持久化）

#### T2.2 多会话/任务管理

**目标**：新建/切换/重命名/删除任务（会话）。

**子任务**：

- T2.2.1 任务列表 UI（CRUD，对接 T0.3 DAO）
- T2.2.2 任务 = 会话的语义化包装（标题、关联库/表、最后活动）
- T2.2.3 任务搜索/筛选

**依赖**：T0.3

#### T2.3 对话历史持久化与续接

**目标**：刷新不丢、可重开旧任务继续。

**子任务**：

- T2.3.1 消息增量持久化（每轮结束 append 到 `chat_history`）
- T2.3.2 打开旧会话时从持久化恢复
- T2.3.3 流式生成中崩溃的会话恢复策略

**依赖**：T0.3

#### T2.4 AI 工具调用（function calling）⭐⭐⭐

**目标**：AI 能调工具——这是 Codex/AGENT 的灵魂，也是和当前 `AiChat`（只吐文本+SQL 卡片）的本质区别。

**子任务**：

- T2.4.1 定义工具 schema（JSON Schema 形式）：`listTables` / `describeTable` / `executeReadOnlyQuery` / `generateSql` / `saveQuery` / `generateChart`（图表见 Phase 4）
- T2.4.2 LLM client 扩展支持 tool calling（OpenAI 兼容协议）
- T2.4.3 工具执行引擎：分发 + 结果序列化 + 错误捕获
- T2.4.4 system prompt 扩展：声明可用工具与使用规范
- T2.4.5 多轮工具调用循环（工具结果回灌 → AI 决策下一步）
- T2.4.6 对话流中渲染工具调用卡片（类 Codex：🔧 工具名 + 参数 + 结果预览）

**依赖**：T0.1（流式）、T0.2（schema 缓存）

#### T2.5 工具执行安全层复用

**目标**：工具调用走现有 M3 安全层，越界强制确认。

**子任务**：

- T2.5.1 `executeReadOnlyQuery` 只允许 SELECT/SHOW/EXPLAIN（静态拦截）
- T2.5.2 写操作工具（如未来 `executeWrite`）走分级确认：dev 自动 / staging 一次性确认 / prod 强确认 + 审计
- T2.5.3 危险 SQL（DROP/TRUNCATE 等）拦截 + 强确认
- T2.5.4 所有工具调用记 `audit_log`（source = ai-agent）

**依赖**：T2.4

#### T2.6 中间产物卡片化

**目标**：SQL/结果/图表/错误都作为卡片嵌入对话流，可执行/保存/再编辑。

**子任务**：

- T2.6.1 统一卡片组件体系（SQL 卡片 / 结果卡片 / 图表卡片 / 错误卡片）
- T2.6.2 卡片动作：执行 / 保存到查询 / 插入编辑器（切编辑器模式）/ 复制
- T2.6.3 卡片上下文：关联到产生它的工具调用与对话轮次

**依赖**：T2.4

#### T2.7 错误自动修复循环

**目标**：AI 执行报错 → 自动读错误 → 修正 → 重试（带次数上限）。

**子任务**：

- T2.7.1 工具执行失败时，错误回灌给 AI（作为 tool result）
- T2.7.2 复用现有 fixError prompt 模板
- T2.7.3 重试次数上限（默认 3）+ 超限降级为人工介入

**依赖**：T2.4

#### T2.8 上下文窗口管理

**目标**：长对话 token 裁剪、schema 范围勾选。

**子任务**：

- T2.8.1 对话历史 token 预估与滑动窗口裁剪
- T2.8.2 schema 范围选择 UI（只带相关表，复用 ObjectTree 勾选）
- T2.8.3 裁剪后给用户可见提示（"已省略 N 轮历史"）

**依赖**：T0.2

---

## 5. Phase 3 — 数据库详情页 tab 化 + 查询管理

### 5.1 验收标准

| #     | 验收项                                             | 验证方式    |
| ----- | -------------------------------------------------- | ----------- |
| P3-D1 | DatabaseDetail 重构为多子 tab（表/查询/图表/用户） | 手动        |
| P3-D2 | saved_queries DAO+IPC+UI 三件套可用                | 手动 + 单测 |
| P3-D3 | 查询列表 tab 可按连接/库组织、搜索                 | 手动        |
| P3-D4 | 编辑器内「保存」、列表「打开」双向联动             | 手动        |
| P3-D5 | AGENT 工作台 SQL 卡片可一键保存到查询列表          | 手动        |

### 5.2 任务拆解

#### T3.1 DatabaseDetail 重构为多 tab

**目标**：单视图 → 内部多子 tab（参考 `TableDetail.tsx:29` 范式）。

**子任务**：

- T3.1.1 `DatabaseDetail.tsx` 引入内部 tab state（`'tables' | 'queries' | 'charts' | 'users'`）
- T3.1.2 tab 头部组件 + URL/hash 可选记忆（当前无路由，先内存）
- T3.1.3 现有表列表视图搬入「表」tab
- T3.1.4 各 tab 按数据库能力按需显示（图表见 Phase 4、用户见 Phase 5）

**依赖**：—

#### T3.2 saved_queries DAO + IPC + UI ⭐

**目标**：表已建，补齐三件套（照搬 sql-history 模式）。

**子任务**：

- T3.2.1 新增 `saved-queries-dao.ts`（表 `saved_queries` 已建），CRUD + 按 connection/schema 过滤
- T3.2.2 IPC：`savedQuery:list/save/update/delete`（`shared/ipc.ts` + `preload/index.ts` 白名单同步）
- T3.2.3 「查询」tab 内容组件：列表 + 搜索 + 分组/标签

**依赖**：—（占位表就绪）

#### T3.3 查询列表 tab UI

**子任务**：

- T3.3.1 列表项：名称 + SQL 预览 + 关联库 + 更新时间 + 标签
- T3.3.2 搜索（名称/SQL 文本）、按标签筛选、排序
- T3.3.3 右键：打开 / 复制 / 编辑 / 删除

**依赖**：T3.2

#### T3.4 编辑器 ↔ 保存查询联动

**子任务**：

- T3.4.1 编辑器工具栏「保存」/「另存为」（`SqlWorkspace.tsx`）
- T3.4.2 列表「打开」→ 新开/回填编辑器 tab
- T3.4.3 已保存查询的更新检测（脏状态）

**依赖**：T3.2

#### T3.5 从 AGENT 工作台一键保存 SQL

**目标**：承接"生成 SQL 可保存"需求。

**子任务**：

- T3.5.1 AGENT 对话流 SQL 卡片「保存」按钮 → 调 `savedQuery:save`
- T3.5.2 保存时预填名称（基于会话标题/用户输入）

**依赖**：T2.6、T3.2

#### T3.6 参数化查询（可选）

**子任务**：

- T3.6.1 `:param` / `?` 占位 + 运行时填值弹窗
- T3.6.2 executor 层参数绑定

**依赖**：—

---

## 6. Phase 4 — 统计图表 tab（Vibe coding → 图表）

### 6.1 待决策：图表方案选型

| 方案                                       | 优点                                          | 缺点                   |
| ------------------------------------------ | --------------------------------------------- | ---------------------- |
| **A. AI 生成自包含 HTML**（推荐）          | 灵活、契合"vibe coding 生成 html"、可独立导出 | 需强沙箱（XSS 风险）   |
| B. 固定组件（echarts）+ AI 只生成配置 JSON | 可控、一致、安全                              | 表达力受限，不够"vibe" |

> 倾向 **A**，理由：用户明确说"通过 vibe coding 生成 sql 并形成统计图表 html"。沙箱用 iframe sandbox + CSP 兜底（T4.5）。

### 6.2 验收标准

| #     | 验收项                                           | 验证方式 |
| ----- | ------------------------------------------------ | -------- |
| P4-D1 | 图表持久化模型 + DAO 可用                        | 单测     |
| P4-D2 | 图表 tab 列表 + 预览 + 新建对话框                | 手动     |
| P4-D3 | NL → SQL → 取数 → 图表 HTML 全流程               | 手动     |
| P4-D4 | 图表可刷新/编辑/删除                             | 手动     |
| P4-D5 | 图表 HTML 在 sandbox iframe + CSP 下渲染，无 XSS | 安全测试 |

### 6.3 任务拆解

#### T4.1 图表持久化模型 + DAO

**子任务**：

- T4.1.1 新迁移 `003_charts.sql`：表 `charts`（id, name, prompt, sql_text, html, connection_id, schema, chart_type, created_at, updated_at）
- T4.1.2 `chart-dao.ts` CRUD + 按库/标签过滤
- T4.1.3 IPC：`chart:list/save/update/delete`

**依赖**：—

#### T4.2 图表 tab UI

**子任务**：

- T4.2.1 「图表」tab 列表（缩略图预览 + 名称 + 关联表 + 更新时间）
- T4.2.2 「新建图表」对话框：自然语言输入 + 可选表勾选
- T4.2.3 图表详情/全屏预览

**依赖**：T3.1（tab 化）、T4.1

#### T4.3 图表生成流程

**目标**：NL → SQL → 执行取数 → 生成图表 HTML。

**子任务**：

- T4.3.1 复用 T2.4 工具调用：新增 `generateChart` 工具
- T4.3.2 流程编排：NL → generateSql → executeReadOnlyQuery（取数）→ generateChart（HTML）
- T4.3.3 图表 HTML prompt 模板（含数据样本、要求自包含、指定库版本 CDN 或内联）
- T4.3.4 流式生成 HTML

**依赖**：T2.4（工具调用）、T4.1

#### T4.4 图表生命周期

**子任务**：

- T4.4.1 刷新（重跑 SQL 取新数据 + 可选重生成 HTML）
- T4.4.2 编辑（改 prompt 重生成）
- T4.4.3 删除 / 复制 / 重命名

**依赖**：T4.2

#### T4.5 HTML 沙箱安全 ⭐

**目标**：iframe sandbox + CSP，禁外联脚本，防 XSS。

**子任务**：

- T4.5.1 图表 HTML 渲染组件：`<iframe sandbox="allow-scripts">`（不带 allow-same-origin，禁 cookie/localStorage）
- T4.5.2 CSP：`script-src 'unsafe-inline'`（图表脚本内联）、禁 connect-src 外联
- T4.5.3 禁用顶层导航、弹窗
- T4.5.4 安全测试：注入 `<img onerror>` / fetch 外联 / 父窗口访问等用例

**依赖**：T4.0 方案 A

#### T4.6 图表导出（可选）

**子任务**：

- T4.6.1 导出独立 HTML（含数据，可离线打开）
- T4.6.2 导出 PNG（从 iframe 截图）

**依赖**：T4.5

---

## 7. Phase 5 — 数据库管理 tab：用户/角色/权限（较大，后置）

> 与 AI 关系较弱，工作量大，按需排期。

### 7.1 验收标准

| #     | 验收项                                                | 验证方式    |
| ----- | ----------------------------------------------------- | ----------- |
| P5-D1 | 驱动层 listUsers/listRoles/listPrivileges（MySQL/PG） | 单测        |
| P5-D2 | 用户/角色列表 tab（按数据库能力按需显示）             | 手动        |
| P5-D3 | GRANT/REVOKE 可视化授权/回收，prod 强确认 + 审计      | 手动 + 审计 |

### 7.2 任务拆解

#### T5.1 驱动层扩展

**目标**：`listUsers/listRoles/listPrivileges`（MySQL/PG 各异，SQLite/Redis 无则隐藏 tab）。

**子任务**：

- T5.1.1 `DbDriver` 接口扩展可选能力方法
- T5.1.2 MySQL 实现（查 mysql.user / SHOW GRANTS / role_edge）
- T5.1.3 PG 实现（pg_roles / pg_authid / 信息模式）
- T5.1.4 能力探测：SQLite/Redis 不实现 → tab 不显示

**依赖**：—

#### T5.2 用户/角色列表 tab

**子任务**：

- T5.2.1 「用户与权限」tab 内容组件
- T5.2.2 列表：用户 / 角色 / 关联权限

**依赖**：T3.1、T5.1

#### T5.3 权限矩阵查看

**子任务**：

- T5.3.1 库/表级权限矩阵展示
- T5.3.2 权限说明 tooltip

**依赖**：T5.1

#### T5.4 GRANT/REVOKE UI 化

**子任务**：

- T5.4.1 可视化授权/回收表单
- T5.4.2 prod 强确认 + 走 security 层 + `audit_log`

**依赖**：T5.1

---

## 8. Phase 6 — 横切：质量 / 可观测 / 可发现

### 8.1 任务拆解

#### T6.1 入口与可发现性统一

**子任务**：

- T6.1.1 新功能入口进工具栏/右键菜单/快捷键
- T6.1.2 全局顶栏模式切换的视觉/交互打磨
- T6.1.3 空状态引导（首次进入各 tab 的 onboarding）

#### T6.2 AI 成本/用量看板

**目标**：`llm_usage` 已有数据，扩展 UI 展示。

**子任务**：

- T6.2.1 用量汇总（按 provider/model/时间）
- T6.2.2 成本估算（按 provider 配价）
- T6.2.3 异常用量告警（单次调用 token 超阈值）

**依赖**：复用 `src/main/infra/storage/llm-usage-dao.ts`

#### T6.3 错误处理与降级

**子任务**：

- T6.3.1 LLM 失败/超时/流式中断的兜底与重试
- T6.3.2 工具执行失败的统一错误展示
- T6.3.3 离线/无 provider 配置时的降级提示

#### T6.4 测试覆盖

**子任务**：

- T6.4.1 DAO 单测（schema-cache / chat-session / saved-queries / chart）
- T6.4.2 补全 provider 单测
- T6.4.3 工具调用引擎单测
- T6.4.4 安全层集成测试（分级确认/危险拦截）
- T6.4.5 沙箱安全测试

#### T6.5 文档同步

**子任务**：

- T6.5.1 README 更新（新功能、截图）
- T6.5.2 PRD/M2-M4 进度勾稽
- T6.5.3 本路线图随实施滚动更新（勾 checkbox）

---

## 9. 依赖关系总览

```
T0.1 流式 ─────────┬─→ T1.4/T1.5 (编辑器流式)
                   ├─→ T1.3 (inline 补全)
                   ├─→ T2.4 (工具调用, 流式渲染)
                   └─→ T4.3 (图表生成流式)

T0.2 Schema 缓存 ──┬─→ T1.1 (补全数据源)
                   ├─→ T2.8 (上下文管理)
                   └─→ T4.3 (图表取数)

T0.3 会话持久化 ───┬─→ T2.1 (工作台布局)
                   ├─→ T2.2 (多会话)
                   └─→ T2.3 (历史续接)

T0.5 工作区骨架 ───┬─→ T1.x (编辑器模式挂载)
                   └─→ T2.1 (AGENT 模式挂载)

T2.4 工具调用 ─────┬─→ T3.5 (保存 SQL)
                   ├─→ T4.3 (图表生成)
                   └─→ T2.6/T2.7 (卡片/修复)

T2.6 卡片 ─────────→ T3.5 (保存 SQL)
T3.1 tab 化 ───────→ T4.2/T5.2 (图表/用户 tab)
T3.2 saved_queries → T3.5 (保存联动)
```

**关键路径**（决定整体节奏）：
`T0.1 流式 → T0.5 工作区骨架 → T0.2 缓存 → T2.4 工具调用`
打通这条线，AGENT 模式即成型。

---

## 10. 推荐实施顺序与里程碑划分

| 里程碑    | 范围                                                                            | 交付价值                              |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| **AI-M1** | T0.1 流式 + T0.2 缓存 + T0.5 工作区骨架 + T1.1 自动补全 + T3.2 saved_queries    | 地基 + 速效，编辑器模式立即可感知提升 |
| **AI-M2** | T0.3 会话持久化 + T2.1 布局 + T2.4 工具调用 + T2.5 安全 + T2.6 卡片 + T2.7 修复 | AGENT 模式成型，核心里程碑            |
| **AI-M3** | T3.1 tab 化 + T3.3/T3.4/T3.5 查询列表与联动                                     | 产物沉淀，数据库详情页成型            |
| **AI-M4** | T4.0~T4.5 图表全流程 + 沙箱                                                     | 图表 vibe coding                      |
| **AI-M5** | T5.x 用户权限 / T6.x 横切 / MCP（按需）                                         | 管理能力 + 质量                       |

**速效优先**：T1.1（自动补全）和 T3.2（saved_queries）独立可交付，可优先做让用户立刻感知提升。
**关键路径**：T0.1 → T0.5 → T0.2 → T2.4 是决定整体节奏的主线。

---

## 11. 待确认（实施中滚动更新）

- [ ] 图表方案 A vs B（倾向 A：AI 生成自包含 HTML）
- [ ] MCP Server 是否纳入本次（README 标 🚧）
- [ ] 数据库差异处理细节（用户/权限在 MySQL/PG 差异大，SQLite/Redis 无用户体系）
- [ ] 成本预算：vibe coding + 图表是 token 大户，是否需要默认用量上限
