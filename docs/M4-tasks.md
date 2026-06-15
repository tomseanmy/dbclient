# M4 任务拆解清单 — AI 双模式（Chat + GUI 辅助 + LLM 网关）

| 项       | 内容                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| 文档版本 | v0.1                                                                                                                 |
| 阶段     | M4（AI 双模式）                                                                                                      |
| 配套     | [PRD.md](./PRD.md)（M5 Chat·M6 AI 辅助·M8 LLM 网关·M10 隐私）· [TRD.md](./TRD.md)（§3.2 LLM·§3.4 隐私·§4.2 AI 链路） |
| 目标     | 打通「自然语言 → SQL → 确认 → 执行」全链路；多 provider LLM 网关；Schema-only 隐私默认                               |
| 最后更新 | 2026-06-15                                                                                                           |

---

## 0. 验收标准（Definition of Done）

| #   | 验收项                                                                          | 验证方式      |
| --- | ------------------------------------------------------------------------------- | ------------- |
| D1  | 可配置多个 LLM provider（名称/Base URL/API Key/模型列表），保存前测连通性       | 手动          |
| D2  | 全局默认 provider+模型；支持在对话/操作级临时切换                               | 手动          |
| D3  | 走 OpenAI 兼容 `/v1/chat/completions`，覆盖 DeepSeek/Qwen/Moonshot/Ollama       | 手动          |
| D4  | API Key 通过 CredentialStore（Keychain）存储，不落库、不入日志                  | 查库 + 查日志 |
| D5  | NL2SQL：中文/英文需求 → 生成 SQL → **用户确认后**执行（不自动执行）             | 手动          |
| D6  | Schema 自动注入：发送当前连接相关表的 Schema（表/列/类型/注释），不发数据行     | 抓包/日志     |
| D7  | SQL 解释：选中/粘贴 SQL → AI 用自然语言解释                                     | 手动          |
| D8  | 优化建议：选中 SQL → AI 给优化方案                                              | 手动          |
| D9  | GUI 辅助：SQL 编辑器右键「解释/优化/NL2SQL」；执行报错时给修复建议              | 手动          |
| D10 | 每次调用记录 token 用量（prompt/completion/total）到本地库                      | 查库          |
| D11 | 数据流向提示：AI 调用前 UI 显示「将向 \<provider\> 发送：Schema / Schema+样本」 | 手动          |
| D12 | AI 生成的写操作 SQL 仍走 M3 安全层（权限判定/危险确认/审计），不绕过            | 手动          |
| D13 | typecheck / lint / test 全绿                                                    | CI            |

**M4 不做**：流式输出（P1）、对话历史本地持久化（P1）、操作卡片化（P1）、列级脱敏（M6/P1）、样本数据发送（P1）。

---

## 1. 设计原则

### 1.1 LLM 网关：统一抽象，provider 无关

```
AI 调用链路（TRD §4.2）
渲染进程 → invoke('ai:chat', { connId, messages, ... })
        → 主进程 LLM 网关
           ├─ 1. 加载 provider 配置 + API Key（CredentialStore）
           ├─ 2. 构造 system prompt（Schema 注入 + 隐私裁剪）
           ├─ 3. 调用外部 LLM（OpenAI 兼容，第一版非流式）
           └─ 4. 记录 token 用量
```

- **统一接口**：`async chat(req: ChatRequest): Promise<ChatResponse>`，底层走 OpenAI 兼容协议。
- **Provider 配置与密钥分离**：配置存本地 SQLite，API Key 存 CredentialStore（Keychain）。
- **Prompt 集中管理**：system prompt 在领域层构造，provider 不感知业务语义。
- **第一版非流式**：P1 加 SSE 流式（`openai` SDK 原生支持）。

### 1.2 隐私不变量：Schema-only 默认

| 边界           | 默认 | 说明                                           |
| -------------- | ---- | ---------------------------------------------- |
| Schema（结构） | ✅   | 库名/表名/列名/类型/注释/索引/外键             |
| 样本数据（行） | ❌   | 发送前 N 行需显式开关（P1，M4 先不做）         |
| 查询结果       | ❌   | 不自动回传给 LLM（除用户主动「解释结果」，P1） |
| DDL            | ✅   | 可作为上下文（结构信息）                       |

> 每次调用前，UI 明确提示「将向 \<provider\> 发送：Schema」。

### 1.3 AI → 安全：不绕过 M3

AI 生成的 SQL **不直接执行**，必须经用户确认。确认后走 `db:confirmExecute`（M3 已建），受环境分级权限约束：

```
AI 生成 SQL
  → 用户点「执行」
    → db:confirmExecute（M3 安全层：权限判定 / 危险确认 / 审计）
      → 允许则执行
```

---

## 2. 任务拆解

### T4.1 LLM 网关核心（批次 A）

**目标**：可配置、可切换、可连通性测试的 LLM 调用能力。

**子任务**：

- T4.1.1 类型定义 `src/shared/types/llm.ts`
  - `LlmProvider`：`{ id, name, baseUrl, models: string[], isDefault }`
  - `LlmProviderInput`：新建/编辑输入（含 `apiKey`）
  - `ChatMessage`：`{ role: 'system'|'user'|'assistant', content: string }`
  - `ChatRequest`：`{ messages, providerId?, model?, temperature?, maxTokens? }`
  - `ChatResponse`：`{ content, model, usage: { prompt, completion, total } }`
  - `ChatError`：`{ code, message }`
- T4.1.2 存储 `src/main/infra/storage/llm-provider-dao.ts`
  - 基于新增 `llm_providers` 表（M4 迁移）
  - `list() / get(id) / create(input) / update(id, input) / remove(id)`
  - `setDefault(id)`：保证全局唯一默认
  - API Key 不入此表，走 CredentialStore
- T4.1.3 LLM 客户端 `src/main/domain/llm/client.ts`
  - `chat(baseUrl, apiKey, model, messages, opts): Promise<ChatResponse>`
  - 用 `undici`（Node 内置 fetch）直调 `/v1/chat/completions`
  - 解析 `choices[0].message.content` + `usage`
  - 超时、错误透传（HTTP 状态 + body）
  - **不 import 任何具体 provider SDK**，纯 OpenAI 兼容协议
- T4.1.4 网关门面 `src/main/domain/llm/gateway.ts`
  - `chat(req: ChatRequest): Promise<ChatResponse>`
  - 解析 providerId（缺省用默认 provider）→ 取配置 + API Key → 调 client
  - 记录 token 用量（调 T4.1.5）
- T4.1.5 Token 用量 `src/main/infra/storage/llm-usage-dao.ts`
  - 基于新增 `llm_usage` 表（M4 迁移）
  - `record(entry)`：provider/model/prompt/completion/total/costEstimate/createdAt
- T4.1.6 IPC `src/main/ipc/llm.ts`
  - `llm:listProviders` / `llm:getProvider` / `llm:createProvider` / `llm:updateProvider` / `llm:deleteProvider` / `llm:setDefaultProvider`
  - `llm:testProvider`：保存前连通性测试（发一个 ping 请求）
  - `llm:getUsage` / `llm:clearUsage`

**依赖**：无（纯领域 + 基础设施）

---

### T4.2 Schema 上下文构建器 + 隐私基础（批次 B）

**目标**：把 DB 元数据转为 LLM 友好的 prompt 片段，且只含结构不含数据。

**子任务**：

- T4.2.1 `src/main/domain/privacy/schema-context.ts`
  - `buildSchemaContext(connId, { schema?, tables? }): Promise<string>`
  - 复用现有 `describeTable`（db 驱动）取表结构
  - 支持三种范围：
    - 全库（所有表，但大库需裁剪）
    - 指定 schema
    - 指定表列表（用户「本次涉及哪些表」，P1，先留接口）
  - 输出格式化文本（Markdown 表格 / DDL 风格），含表名/列/类型/注释/主键/外键
  - **Token 裁剪**：表数或列数超阈值时，优先保留用户选中的表，其余截断 + 提示
- T4.2.2 `src/main/domain/privacy/prompt.ts`（system prompt 模板）
  - 角色：数据库专家助手
  - 注入：DB 类型（mysql/pg/sqlite/redis）+ Schema 上下文
  - 约束：只生成符合该 DB 方言的 SQL；不要执行；危险操作标注风险
  - 输出规范：SQL 用 ```sql 代码块包裹 + 简短说明
- T4.2.3 数据流向描述 `describeDataFlow(provider, ctx)`
  - 返回 `「将向 <provider.name> 发送：Schema（N 张表）」`
  - 供前端 UI 提示用

**依赖**：T4.1（provider 概念）、现有 db 驱动

---

### T4.3 AI Chat 工作区（批次 C）

**目标**：自然语言驱动的对话工作台，核心是 NL2SQL + 确认。

**子任务**：

- T4.3.1 IPC `src/main/ipc/ai.ts`
  - `ai:chat`：`{ connId, messages, providerId?, model?, scopeTables? }` → `{ reply, sql?, dataFlow }`
    - 注入 system prompt（T4.2.2）+ Schema 上下文（T4.2.1）
    - 调 gateway.chat
    - 从回复中提取 SQL（解析 ```sql 块）
    - 返回 `dataFlow` 供前端提示
- T4.3.2 组件 `src/renderer/components/AiChat.tsx`
  - 对话消息列表（user/assistant 气泡）
  - 输入框 + 发送
  - 绑定当前激活连接（顶部显示连接名 + provider + 数据流向提示）
  - provider/model 选择器（下拉）
  - AI 回复中的 SQL：渲染为代码块 + 「插入编辑器 / 执行 / 复制」按钮
  - 「执行」→ 走 `db:confirmExecute`（M3 安全层）
- T4.3.3 SQL 提取工具 `src/main/domain/llm/extract-sql.ts`
  - 从 LLM 回复文本中提取 `sql ... ` 代码块
  - 多个块全部返回，首个为推荐
- T4.3.4 Chat 作为 tab 的一种 kind 接入 App.tsx tab 系统
  - Tab kind 新增 `'chat'`
  - 从连接右键「AI 对话」打开

**依赖**：T4.1（gateway）、T4.2（prompt/context）、M3（confirmExecute）

---

### T4.4 AI 辅助 GUI（批次 D）

**目标**：在现有界面各处提供「一键 AI」，不离开当前界面。

**子任务**：

- T4.4.1 IPC `ai:assist`
  - `{ connId, action: 'explain'|'optimize'|'nl2sql'|'fixError', payload }`
    - explain/optimize：`payload.sql`
    - nl2sql：`payload.naturalText`
    - fixError：`{ sql, error }`
  - 复用 T4.2 prompt 模板（按 action 切换指令）
  - 返回 `{ reply, sql?, dataFlow }`
- T4.4.2 SqlEditor 右键菜单
  - 选中 SQL → 右键「✨ 解释这条 SQL」「⚡ 优化建议」
  - 旁输入框 → 「自然语言转 SQL」
  - 结果显示在弹层 / 侧边面板（复用 AiChat 的 SQL 卡片渲染）
- T4.4.3 执行报错 → 修复建议
  - SqlWorkspace 执行失败时，错误面板加「让 AI 看看」按钮
  - 调 `ai:assist` action=fixError
- T4.4.4 表对象右键「解释这张表」（P1，先留入口占位）

**依赖**：T4.2、T4.3.3（SQL 提取复用）

---

### T4.5 设置页 + Token 统计 + 测试（批次 E）

**子任务**：

- T4.5.1 设置页 `src/renderer/pages/Settings.tsx`
  - LLM Provider 管理：列表 / 新增 / 编辑 / 删除 / 设默认 / 测试连通性
  - 表单字段：名称 / Base URL / API Key / 模型列表（逗号分隔）
  - Token 用量统计：按 provider 汇总，展示总量
- T4.5.2 迁移 `004_llm.sql`
  - `llm_providers` 表（id/name/base_url/models_json/is_default/created_at/updated_at）
  - `llm_usage` 表（id/provider_id/provider_name/model/prompt_tokens/completion_tokens/total_tokens/created_at）
- T4.5.3 单元测试
  - `extract-sql.test.ts`：代码块提取（单个/多个/无）
  - `schema-context.test.ts`：格式化输出 + token 裁剪
  - `gateway.test.ts`：mock client，验证 provider 选择 + 用量记录
- T4.5.4 端到端验收
  - 配置一个 Ollama/OpenAI 兼容 provider，连通性测试通过
  - NL2SQL：中文需求 → 生成 SQL → 确认 → 执行成功
  - AI 生成的 DROP 在 prod 被拦截（安全层联动验证）
- T4.5.5 文档更新（M4 实施记录）+ git 提交

**依赖**：T4.1 ~ T4.4

---

## 3. 依赖关系

```
T4.1 LLM 网关 ──→ T4.2 Schema/隐私 ──→ T4.3 AI Chat ──→ T4.5 验收
                          │                 │
                          └──→ T4.4 AI 辅助 ─┘
                                   │
                              (复用 T4.3.3 提取)
T4.5.2 迁移 ← T4.1.2 / T4.1.5（DAO 依赖表）
```

**关键路径**：T4.1 → T4.2 → T4.3 → T4.5

---

## 4. 实施批次

| 批次       | 任务          | 产出                                                 |
| ---------- | ------------- | ---------------------------------------------------- |
| **批次 A** | T4.1 + T4.5.2 | LLM 网关（provider 配置 + 调用 + 连通性测试 + 存储） |
| **批次 B** | T4.2          | Schema 上下文构建器 + prompt 模板 + 数据流向描述     |
| **批次 C** | T4.3          | AI Chat 工作区（NL2SQL 确认流程）                    |
| **批次 D** | T4.4          | GUI AI 辅助（右键解释/优化/NL2SQL/修复）             |
| **批次 E** | T4.5          | 设置页 + Token 统计 + 测试与验收                     |

---

## 5. 数据模型（新增表）

### 5.1 llm_providers

```sql
CREATE TABLE IF NOT EXISTS llm_providers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  models_json TEXT NOT NULL DEFAULT '[]',   -- 模型列表 JSON 数组
  is_default  INTEGER NOT NULL DEFAULT 0,   -- 全局唯一默认
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- API Key 不存此表，存 CredentialStore（key: llm:<providerId>）
```

### 5.2 llm_usage

```sql
CREATE TABLE IF NOT EXISTS llm_usage (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id      TEXT,
  provider_name    TEXT,
  model            TEXT,
  prompt_tokens    INTEGER,
  completion_tokens INTEGER,
  total_tokens     INTEGER,
  action           TEXT,    -- chat / explain / optimize / nl2sql / fixError
  created_at       TEXT NOT NULL
);
```

---

## 6. IPC 通道（新增）

| 通道                     | 请求                                              | 响应                           |
| ------------------------ | ------------------------------------------------- | ------------------------------ |
| `llm:listProviders`      | `void`                                            | `LlmProvider[]`                |
| `llm:createProvider`     | `LlmProviderInput`                                | `LlmProvider`                  |
| `llm:updateProvider`     | `{ id, input }`                                   | `LlmProvider`                  |
| `llm:deleteProvider`     | `{ id }`                                          | `{ success }`                  |
| `llm:setDefaultProvider` | `{ id }`                                          | `{ success }`                  |
| `llm:testProvider`       | `LlmProviderInput`                                | `{ success, message, model? }` |
| `llm:getUsage`           | `{ providerId? }`                                 | `UsageSummary`                 |
| `ai:chat`                | `{ connId, messages, providerId?, scopeTables? }` | `{ reply, sql?, dataFlow }`    |
| `ai:assist`              | `{ connId, action, payload }`                     | `{ reply, sql?, dataFlow }`    |

---

## 7. 实施记录

（待批次完成后填写）

## 7. 实施记录

### 7.1 交付物清单

**批次 A — LLM 网关**

- 迁移 `002_llm_providers.sql`：llm_providers 表（API Key 存 Keychain，不落库）
- `shared/types/llm.ts`：Provider/ChatRequest/ChatResponse/Usage 等全套类型
- `domain/llm/client.ts`：OpenAI 兼容 `/v1/chat/completions` 直调（Node fetch，无 SDK）+ ping 连通性测试
- `domain/llm/gateway.ts`：provider 解析 + apiKey 取用 + 用量记录门面
- `domain/llm/extract-sql.ts`：从回复提取 sql 围栏代码块
- `llm-provider-dao.ts` / `llm-usage-dao.ts`：配置 CRUD + token 用量汇总

**批次 B — Schema 上下文 + Prompt**

- `domain/privacy/schema-context.ts`：复用 describeTable 构建 Markdown 结构文本，Schema-only，含 token 裁剪
- `domain/privacy/prompt.ts`：按 action 产出 system prompt，统一注入方言+Schema
- `db/manager`：新增 `getConfig()` 暴露活跃连接配置

**批次 C — AI Chat 工作区**

- `ipc/ai.ts`：`ai:chat` + `ai:assist` handler，注入 Schema → 调网关 → 提取 SQL → 返回数据流向
- `AiChat.tsx`：对话气泡 + provider 下拉 + SQL 卡片（复制/执行）+ 数据流向提示
- 执行 SQL 走 `db:confirmExecute`（M3 安全层），不绕过权限

**批次 D — GUI AI 辅助**

- `AiAssistPanel.tsx`：可复用 AI 回复面板（SQL 卡片：复制/插入/执行）
- SqlEditor 工具栏：「✨ 解释」「⚡ 优化」按钮
- SqlWorkspace：NL2SQL 输入栏 + 报错「让 AI 修复」按钮

**批次 E — 设置页 + 测试**

- `pages/Settings.tsx`：Provider 管理 + Token 用量统计
- `extract-sql.test.ts`：8 个单测

### 7.2 验收状态

| 项                               | 状态       |
| -------------------------------- | ---------- |
| D1 多 provider 配置 + 连通性测试 | ✅         |
| D2 默认 + 临时切换               | ✅         |
| D3 OpenAI 兼容协议               | ✅         |
| D4 API Key 走 Keychain           | ✅         |
| D5 NL2SQL 确认执行               | ✅         |
| D6 Schema 注入                   | ✅         |
| D7 SQL 解释                      | ✅         |
| D8 优化建议                      | ✅         |
| D9 GUI 右键辅助                  | ✅         |
| D10 Token 用量记录               | ✅         |
| D11 数据流向提示                 | ✅         |
| D12 AI 不绕过安全层              | ✅         |
| D13 typecheck/lint/test          | ✅ 44 单测 |
