# AI Database Client — 技术路线文档（TRD）

| 项       | 内容               |
| -------- | ------------------ |
| 文档版本 | v0.2               |
| 状态     | 待评审             |
| 配套文档 | [PRD.md](./PRD.md) |
| 最后更新 | 2026-06-14         |

> **v0.2 变更**：后端语言由 Rust 调整为 **TypeScript（Electron 全栈）**。
> 原因：MCP 生态主力语言是 TypeScript（官方 TS SDK 最成熟），DB/LLM/加密生态更完善，且用户可读代码、参与排查；Rust 版在 MCP + Tauri 异步组合上存在真实且用户无法兜底的风险。详见第 0 章。

---

## 0. 技术选型决策记录（ADR）

### ADR-01：后端语言 Rust → TypeScript

**背景**：初版 TRD 选 Tauri + Rust，理由是包小、性能好。

**问题**：本项目的核心价值在「AI + MCP + 多数据库 + 权限」，没有任何一处在乎 Rust 性能（DB 工具瓶颈是网络和 DB 本身）。而 Rust 在以下点存在用户无法兜底的风险：

| 风险点                | Rust 现状                         | TS 现状                                                     |
| --------------------- | --------------------------------- | ----------------------------------------------------------- |
| MCP Server            | `rmcp` 较新，async trait 边界问题 | **官方 TS SDK，主力生态**，stdio+SSE+Streamable HTTP 全支持 |
| 异步状态/连接池跨 IPC | Send/Sync/生命周期错误，定位慢    | 单线程事件循环，心智简单                                    |
| DB 驱动               | sqlx 成熟但类型体操多             | mysql2/pg/better-sqlite3/ioredis 极成熟                     |
| LLM 调用              | reqwest 手搓                      | openai-node 等 SDK 现成                                     |
| 用户可读性            | 用户完全不会，无法参与排查        | 用户能读、能搜报错、能参与                                  |

**决策**：采用 **Electron + TypeScript 全栈**。

**代价**：安装包大（~80MB vs Tauri ~10MB）。对本项目可接受。

**收益**：开发速度↑、调试成本↓、MCP 风险↓、用户可参与度↑。

---

## 1. 技术选型

### 1.1 选型原则

1. **生态成熟优先**：每个关键依赖选社区主流、近一年仍活跃维护的。
2. **TS 全栈**：主进程与渲染进程同语言，类型可跨进程共享。
3. **可替换**：DB 驱动、LLM 调用、MCP 传输都做成接口，方便换实现。
4. **原生 SQL 优先**：DB 工具场景，拒绝 ORM 隔离原生 SQL 能力。

### 1.2 技术栈总表

| 层             | 选型                                             | 选择理由                                    |
| -------------- | ------------------------------------------------ | ------------------------------------------- |
| **应用框架**   | Electron 30+                                     | 原生窗口 + Node 主进程，跨平台一致，TS 全栈 |
| **语言**       | TypeScript 5.x（strict）                         | 全栈类型安全                                |
| **前端框架**   | React 18                                         | 生态最广，组件库丰富                        |
| **前端构建**   | Vite 5 + electron-vite                           | Electron 官方推荐，HMR 快                   |
| **UI 组件库**  | Shadcn UI + Radix + Tailwind CSS                 | 可复制源码、可深度定制                      |
| **状态管理**   | Zustand 4                                        | 轻量，适合中等复杂度                        |
| **数据请求**   | TanStack Query 5                                 | 缓存/重试/失效契合「连接-查询-缓存」        |
| **SQL 编辑器** | Monaco Editor                                    | VS Code 同源，高亮+补全+格式化              |
| **数据网格**   | TanStack Table v8 + 虚拟滚动                     | 大表性能好                                  |
| **图标/工具**  | Lucide / clsx / dayjs                            | 轻量                                        |
| **进程通信**   | Electron IPC（ipcMain/ipcRenderer） + 类型化封装 | 类型安全                                    |
| **打包发布**   | electron-builder                                 | 跨平台打包成熟                              |

### 1.3 主进程核心依赖（npm）

| 职责                   | 包                                            | 说明                                                         |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| DB——MySQL              | `mysql2`                                      | 原生 SQL，Promise API                                        |
| DB——PostgreSQL         | `pg`                                          | 原生 SQL，类型丰富                                           |
| DB——SQLite             | `better-sqlite3`                              | 同步 API，性能好（用于目标库 + 应用本地库）                  |
| Redis                  | `ioredis`                                     | cluster/sentinel 支持完整，主流选择                          |
| MCP 协议               | `@modelcontextprotocol/sdk`                   | **官方 TS SDK**，主力生态，stdio+Streamable HTTP+SSE         |
| HTTP/LLM               | `openai`（OpenAI 兼容）或 `undici` 直调       | 覆盖几乎所有国产/自托管模型                                  |
| 加密                   | Node 内置 `crypto`（AES-GCM + scrypt/argon2） | 凭据加密，无需额外依赖                                       |
| 凭据存储               | `keytar`                                      | macOS Keychain / Win Credential Vault / Linux Secret Service |
| SQL 解析（危险判定）   | `node-sql-parser`                             | 识别语句类型、提取 AST、判定 WHERE 缺失等                    |
| SQL 格式化             | `sql-formatter`                               | 多方言                                                       |
| 日志                   | `electron-log` + `pino`                       | 文件日志 + 结构化                                            |
| 配置                   | `electron-store` + `zod` 校验                 | 应用配置持久化                                               |
| 校验                   | `zod`                                         | IPC 参数、配置、外部输入统一校验                             |
| 本地库 ORM（仅应用库） | 用 `better-sqlite3` 原生                      | 应用库表少，不需要 ORM                                       |

> **关键选型说明**：
>
> - **DB 驱动全部原生**：这是 DB 工具，不是业务应用，必须能完整控制原生 SQL、获取列类型、执行 EXPLAIN、处理多结果集——ORM 反而是障碍。
> - **MCP 用官方 TS SDK**：这是降低本项目最大风险的关键决策。SDK 提供 `McpServer` 类，注册 tool/resource/prompt 极简，stdio 和 Streamable HTTP 传输开箱即用。
> - **`keytar`** 跨平台封装系统凭据存储，macOS 走 Keychain，Win/Linux 走系统服务；配合应用级主密码加密兜底（Linux 无密钥环时）。

### 1.4 待评估/可选

| 项                     | 备选                                      | 决策时机                   |
| ---------------------- | ----------------------------------------- | -------------------------- |
| Redis cluster 深度支持 | `ioredis` cluster 模式                    | M1 spike                   |
| LLM 多供应商抽象       | 是否引入 `litellm` 风格的统一层，还是手写 | M4（手写更可控，倾向手写） |
| 是否引入 i18n          | `react-i18next`                           | P1                         |

---

## 2. 分层架构与进程结构

### 2.1 Electron 进程模型

```
┌─────────────────────────────────────────────────────────────┐
│  Electron 应用                                                │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  渲染进程 (Renderer, React UI)                           │ │
│  │  连接管理 │ 对象树 │ SQL编辑器 │ 数据网格 │ AI对话/辅助    │ │
│  └────────────────────┬────────────────────────────────────┘ │
│                       │ IPC (ipcRenderer ↔ ipcMain)            │
│  ┌────────────────────┴────────────────────────────────────┐ │
│  │  主进程 (Main, Node.js)                                   │ │
│  │                                                           │ │
│  │  应用服务层：IPC handlers（连接/查询/AI/MCP/设置）          │ │
│  │       │                                                   │ │
│  │  核心领域层：DB驱动抽象 / LLM网关 / 权限安全 / 隐私脱敏      │ │
│  │       │                                                   │ │
│  │  基础设施层：本地库 / 凭据 / Schema缓存 / MCP Server / 审计 │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────┐             │ │
│  │  │  MCP Server（主进程内同进程，官方SDK）     │             │ │
│  │  │  - stdio 传输：可被 CLI agent spawn       │             │ │
│  │  │  - Streamable HTTP：localhost 暴露        │             │ │
│  │  └─────────────────────────────────────────┘             │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
        │                    │
        ▼                    ▼
   外部 DB / Redis       外部 LLM / Agent(Claude Code...)
```

### 2.2 分层职责与依赖规则

| 层                                    | 职责                                             | 依赖规则                                                     |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| **渲染进程**                          | UI、用户交互                                     | 只通过类型化 IPC 访问主进程，不直连 DB/LLM                   |
| **应用服务层**（主进程 IPC handlers） | 接收 IPC、编排领域层、DTO 转换、zod 校验入参     | 依赖核心层                                                   |
| **核心领域层**                        | 业务规则：查询执行、权限判定、LLM 调用、隐私裁剪 | **不依赖 Electron**，纯 TS，可独立测试，可被 MCP Server 复用 |
| **基础设施层**                        | 持久化、凭据、网络、协议                         | 实现核心层定义的接口                                         |

**关键约束**：

- 核心领域层（`src/main/domain/`）**不 import electron**——这样 MCP Server 和 GUI 共用同一套领域逻辑，保证「三条执行路径权限一致」。
- 类型定义（`src/shared/`）被主进程与渲染进程共享，IPC 全程类型安全。

### 2.3 三条执行路径统一入口（安全基石）

```
GUI 用户点执行 ──┐
AI 生成并执行  ──┼──→ SqlExecutor.execute(ctx, sql)
MCP 工具调用   ──┘           │
                             ├─ 1. 权限层判定（环境分级 / 只读 / 黑名单）
                             ├─ 2. 危险 SQL 识别（node-sql-parser）→ 待确认
                             ├─ 3. 影响行数预估
                             ├─ 4. 审计日志写入
                             └─ 5. DB 驱动层执行 → 返回结果
```

`ctx` 携带：调用来源（gui/ai/mcp）、连接 ID、提权状态、会话 ID。
**一套权限与审计逻辑覆盖三条路径**——这是整个架构的安全不变量。

---

## 3. 关键技术方案

### 3.1 DB 驱动抽象层

**目标**：上层统一接口，下层 4 种库各自实现。

**统一接口（TS 接口，仅示意）**：

- `listSchemas(): Promise<Schema[]>`
- `listTables(schema): Promise<Table[]>`
- `describeTable(table): Promise<TableMeta>`（列/类型/注释/索引/行数估算）
- `executeQuery(sql, opts): Promise<QueryResult>`（分页、超时、只读标记）
- `executeStatement(sql, opts): Promise<ExecResult>`（影响行数）
- `begin/commit/rollback()`（事务，P1）
- Redis 适配为类似语义（`listKeys` / `describeKey` / `get/set/del/ttl`）

**类型映射**：每种驱动维护「DB 类型 → 统一 `CellValue` 联合类型」映射表，前端只处理统一类型。

**连接池**：MySQL/PG 用各自驱动内置 pool；Redis 用 ioredis 内置；SQLite 同步 API。

**Schema 内省 SQL**：每种库写一套查询系统表/`information_schema` 的 SQL，结果映射到统一 `TableMeta`。这是工作量大头但非难点。

### 3.2 LLM 网关

**目标**：多 provider 可切换，统一 prompt 构造与调用接口。

**设计**：

- **统一接口**：`async chat(req: ChatRequest): Promise<ChatResponse>`，底层走 OpenAI 兼容 `/v1/chat/completions`（覆盖 DeepSeek/Qwen/Moonshot/Ollama 等）。
- **Provider 配置**：名称、Base URL、API Key、模型列表、默认模型。保存前测连通性。
- **第一版非流式**：P1 加流式（SSE 解析，`openai` SDK 原生支持）。
- **Prompt 模板集中管理**：在领域层维护 system prompt（含 Schema 注入、隐私裁剪），provider 不感知。
- **Token 计费**：响应 `usage` 写入本地库。

### 3.3 权限与安全（M9）落地方案

**环境分级权限矩阵**：

| 环境    | SELECT | DML        | DDL     | 危险语句         |
| ------- | ------ | ---------- | ------- | ---------------- |
| dev     | ✅     | ✅         | ✅      | 二次确认         |
| staging | ✅     | ✅         | ⚠️ 确认 | ⚠️ 确认          |
| prod    | ✅     | ❌（默认） | ❌      | ❌（需临时提权） |

**实现**：

- **SQL 解析**：`node-sql-parser` 解析为 AST，识别语句类型 + 危险模式（`DELETE`/`UPDATE` 无 `WHERE`、`DROP`/`TRUNCATE`）。
- **临时提权**：prod 临时开写，会话内有效 + 倒计时 + 审计。
- **二次确认**：弹窗显示 SQL + 预估影响行数；最高危（DROP/TRUNCATE/无 WHERE 的 DELETE/UPDATE）要求**手动输入关键词**确认。
- **解析失败保底**：解析不了的语句保守判为「需确认」。

### 3.4 隐私保护（M10）落地方案

**Schema-only 默认**：AI 调用时只注入 Schema（库名/表名/列名/类型/注释/索引/外键），**不注入任何数据行**。样本数据开关默认关。

**数据流向标记**：每次 AI 调用前 UI 提示「将向 <provider> 发送：Schema / Schema + 样本数据」。

**脱敏规则**（P1）：列级正则/类型规则，命中替换为 `***` 再发 LLM。

### 3.5 MCP Server（M7）落地方案 ⭐

**这是本项目风险最高、价值最大的模块，TS 版方案如下：**

**运行模型**：

- 主进程内启动一个 MCP Server 实例（用官方 `@modelcontextprotocol/sdk` 的 `McpServer`）。
- **stdio 传输**：Claude Code 等 CLI agent 通过 `command: "npx"` 或应用提供的可执行入口 spawn 子进程接入。
- **Streamable HTTP 传输**：应用起一个 localhost HTTP server（`http://127.0.0.1:<port>/mcp`），支持远程/常驻 agent 接入。
- **仅绑定 localhost**，不对外网。

**Tools 暴露**（用 SDK 的 `server.tool(name, schema, handler)` 注册）：

| Tool                          | 说明           | 权限                               |
| ----------------------------- | -------------- | ---------------------------------- |
| `list_databases`              | 列出连接下的库 | 只读                               |
| `list_tables`                 | 列出表/视图    | 只读                               |
| `describe_table`              | 表结构详情     | 只读                               |
| `execute_sql_readonly`        | 强制 SELECT    | 只读                               |
| `execute_sql`                 | 任意 SQL       | **经统一执行入口，受环境分级约束** |
| Redis: `keys/get/set/del/ttl` | Redis 操作     | 受环境分级                         |

**关键**：每个 tool 的 handler 内部调用 `SqlExecutor.execute(ctx, sql)`，与 GUI 走完全相同的权限/审计路径。

**配置引导**：UI 一键生成各 agent 的 MCP 配置：

- Claude Code：`mcpServers` JSON 片段（stdio 命令 或 HTTP URL）。
- OpenCode / Codex：对应配置格式。
- 附 stdio 启动命令和 SSE/HTTP 地址。

**待确认**（M5 spike 时定）：

- Streamable HTTP 端口的端口分配与冲突处理（可配置 + 自动选端口）。
- 多连接场景下，MCP Server 如何让 agent 指定连接（连接 ID 作为 tool 参数 vs 一个 Server 实例一个连接）。

### 3.6 凭据存储方案（M11）

**平台分流**（对应 PRD Q1 决策）：

| 平台        | 方案                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------ |
| **macOS**   | `keytar` → Keychain，按 service/account 存取                                                     |
| **Windows** | `keytar` → Credential Vault                                                                      |
| **Linux**   | 优先 `keytar` → Secret Service（GNOME Keyring/KWallet）；无密钥环环境则**主密码 + AES-GCM** 兜底 |

**主密码兜底**（Linux 无密钥环 / 用户主动启用）：scrypt 派生密钥 + AES-256-GCM 加密凭据，密文存本地 SQLite，主密码仅内存会话持有。

**统一抽象**：`CredentialStore` 接口，按平台/配置选择实现，上层无感。

### 3.7 本地存储

**单个应用级 SQLite 文件**（`better-sqlite3`）存放：

- 连接配置（敏感字段密文）
- 对话历史、SQL 历史、保存的查询
- Schema 缓存（带版本，过期重刷）
- 审计日志（只追加）
- Token / 费用统计

---

## 4. 前后端通信

### 4.1 IPC 模式

| 模式                             | 用途                                | 示例                                            |
| -------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `invoke` / `handle`（请求-响应） | 连库、执行查询、读对象              | `ipcRenderer.invoke('db:listTables', {connId})` |
| `WebContents.send`（事件推送）   | AI 响应、长查询进度、MCP 待确认通知 | `mainWindow.webContents.send('ai:token', ...)`  |

**类型化封装**：用 `src/shared/ipc.ts` 定义所有 channel 的请求/响应类型，主进程与渲染进程共享，编译期保证 IPC 类型安全。

### 4.2 AI 调用链路

```
渲染进程 → invoke('ai:chat', {connId, msg, history})
        → 主进程 LLM 网关
           → 调用外部 LLM（非流式第一版）
           → 返回结果 + usage
        ← 返回 {sql?, explanation?, usage}
（P1 流式：主进程边收边 send('ai:token')，渲染进程增量渲染）
```

---

## 5. 项目目录结构

```
dbclient/
├── docs/                       # PRD / TRD / 设计文档
├── src/
│   ├── shared/                 # 主进程与渲染进程共享
│   │   ├── types/              # 类型定义（连接/结果/AI/IPC 消息）
│   │   ├── ipc.ts              # IPC channel 定义 + 类型映射
│   │   └── constants.ts
│   ├── main/                   # Electron 主进程（Node 侧）
│   │   ├── index.ts            # 应用入口、窗口管理
│   │   ├── ipc/                # IPC handlers（应用服务层）
│   │   │   ├── connection.ts
│   │   │   ├── query.ts
│   │   │   ├── ai.ts
│   │   │   ├── mcp.ts
│   │   │   └── settings.ts
│   │   ├── domain/             # ★ 核心领域层（不 import electron）
│   │   │   ├── db/             # DB 驱动抽象 + 4 实现
│   │   │   │   ├── driver.ts   # 统一接口
│   │   │   │   ├── mysql.ts
│   │   │   │   ├── postgres.ts
│   │   │   │   ├── sqlite.ts
│   │   │   │   └── redis.ts
│   │   │   ├── llm/            # LLM 网关
│   │   │   ├── security/       # 权限/危险SQL/审计
│   │   │   ├── privacy/        # Schema裁剪/脱敏
│   │   │   └── executor.ts     # ★★ 统一执行入口
│   │   ├── infra/              # 基础设施层
│   │   │   ├── storage/        # 本地 SQLite
│   │   │   ├── credential/     # keytar / 主密码
│   │   │   ├── schema-cache.ts
│   │   │   └── audit.ts
│   │   └── mcp/                # MCP Server（复用 domain）
│   │       ├── server.ts       # McpServer 实例 + tools 注册
│   │       ├── transports.ts   # stdio / Streamable HTTP
│   │       └── tools/          # 各 tool 定义
│   ├── renderer/               # 渲染进程（React UI）
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── connections/
│   │   │   ├── workspace/      # SQL编辑器+结果+对话
│   │   │   └── settings/
│   │   ├── components/
│   │   │   ├── sql-editor/     # Monaco 封装
│   │   │   ├── data-grid/      # TanStack Table
│   │   │   ├── ai-chat/
│   │   │   └── object-tree/
│   │   ├── store/              # Zustand
│   │   └── api/                # ipcRenderer 封装（类型化）
│   └── preload/                # preload 脚本（contextBridge 暴露安全 API）
├── resources/                  # 应用图标等
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── tsconfig.json
└── README.md
```

**关键点**：

- `src/main/domain/` 是纯 TS，**不 import electron**，可独立单测，被 `mcp/` 复用——这是三条路径一致的基石。
- `src/shared/` 让 IPC 全程类型安全。
- `src/preload/` 用 contextBridge 暴露最小 API，渲染进程不直接访问 Node。

---

## 6. 工程化

### 6.1 代码质量

| 项        | 工具                                                                      |
| --------- | ------------------------------------------------------------------------- |
| Lint      | ESLint（typescript-eslint）+ Prettier                                     |
| 类型      | TypeScript strict，禁用 any                                               |
| 测试      | Vitest（单元）+ 核心领域层单测                                            |
| Git hooks | husky + lint-staged：提交前 lint+typecheck                                |
| 提交规范  | Conventional Commits                                                      |
| 安全      | electron 安全清单（contextIsolation、sandbox、CSP、禁用 nodeIntegration） |

### 6.2 跨平台构建

- **electron-builder** 出 macOS（dmg，Universal）/ Windows（nsis per-user + portable 免安装版）/ Linux（AppImage + deb）。
- Windows nsis 走 per-user 安装（装 `%LocalAppData%`，免 UAC），承载自动更新；portable 单独构建（`dist:win:portable`），不支持自动更新。
- **GitHub Actions** 矩阵构建，`electron-builder` 原生支持 CI 跨平台签名。
- macOS 自用先不签名；面向他人发布时再做公证。

### 6.3 自动更新（P2）

`electron-updater` + GitHub Releases 静态 manifest。

### 6.4 开源工程化

- **LICENSE**：MIT
- README：特性、截图、构建、**MCP 配置示例**（重点）、贡献指南
- Issue/PR 模板、CI badge

---

## 7. 风险与对策

| 风险                                      | 影响                             | 对策                                                             |
| ----------------------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| MCP stdio 与应用主进程同进程的 stdio 冲突 | agent spawn 模式下 stdout 被占用 | MCP stdio 用独立子进程模式（SDK 支持），或仅暴露 Streamable HTTP |
| Streamable HTTP 端口冲突                  | 多实例/端口被占                  | 可配置 + 自动选空闲端口，配置引导里回填实际端口                  |
| 大表数据网格性能                          | 卡顿                             | 虚拟滚动 + 后端分页 + 行数上限保护                               |
| `node-sql-parser` 对各方言支持边界        | 危险 SQL 漏判                    | 解析失败保守判「需确认」+ 关键字黑名单双保险                     |
| Electron 安装包大                         | 体积敏感用户不满                 | 文档说明；二期评估 Tauri 重打包（核心 domain 已是纯 TS，可迁移） |
| Electron 安全漏洞                         | 被攻击面                         | 严格遵守安全清单；渲染进程不开 nodeIntegration；CSP 严格         |

> **重要**：核心领域层是纯 TS、不依赖 Electron。这意味着**未来若想迁移到 Tauri 壳**，只需替换 main 层的 Electron 桥接，domain 可整体复用。当前选 Electron 不锁死未来路线。

---

## 8. 里程碑（技术交付物）

| 阶段              | 技术交付物                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **M0 骨架**       | electron-vite 工程跑通；主进程/渲染进程/preload 结构；本地 SQLite 初始化；shared 类型；CI |
| **M1 连接+浏览**  | DB 驱动抽象 + MySQL/PG/SQLite/Redis 实现；对象树 UI；凭据存储（keytar/主密码）            |
| **M2 SQL 编辑器** | Monaco 集成；执行/结果/EXPLAIN/导出/历史；数据网格虚拟滚动                                |
| **M3 权限安全**   | 环境分级；node-sql-parser 危险识别；统一执行入口；审计日志                                |
| **M4 AI 双模式**  | LLM 网关（OpenAI 兼容）；AI 对话；GUI 辅助；Schema 注入与裁剪                             |
| **M5 MCP Server** | 官方 TS SDK；stdio+Streamable HTTP；Tools 暴露；配置引导；复用统一执行入口                |
| **M6 打磨**       | 流式输出；脱敏；token 统计；自动更新；三平台打包发布                                      |

---

## 9. 待进一步细化的技术点

| #   | 问题                                                           | 决策时机               |
| --- | -------------------------------------------------------------- | ---------------------- |
| T1  | MCP stdio 是否需独立子进程（避免与应用 stdout 冲突）           | M5 spike               |
| T2  | Streamable HTTP 端口策略（固定/自动选/可配）                   | M5                     |
| T3  | 多连接场景：MCP Server 一个实例多连接 vs 一连接一实例          | M5                     |
| T4  | SQL 格式化方言覆盖（`sql-formatter` 对 Redis N/A，关系库够用） | M2                     |
| T5  | LLM 流式前端渲染（增量 markdown 渲染策略）                     | M6                     |
| T6  | 审计日志是否加密防篡改                                         | M3                     |
| T7  | 是否需要 worker 线程跑重查询（避免阻塞主进程）                 | M2（先不用，按需引入） |

---

## 附录：参考资料

- [Electron 官方文档](https://www.electronjs.org/docs)
- [electron-vite](https://electron-vite.org/)
- [MCP 官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP 传输规范（2025-11-25）](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [modelcontextprotocol 主站](https://modelcontextprotocol.io/)
- [mysql2](https://github.com/sidorares/node-mysql2) / [pg](https://node-postgres.com/) / [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) / [ioredis](https://github.com/redis/ioredis)
- [node-sql-parser](https://github.com/taozhi8833998/node-sql-parser)
- [keytar](https://github.com/atom/node-keytar)
