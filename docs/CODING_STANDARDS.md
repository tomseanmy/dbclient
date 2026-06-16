# 编码规范（Coding Standards）

本规范是 AI DB Client 全体代码的**强制约束**。新增代码必须遵守，存量代码在重构时逐步对齐。
规范与现有架构保持一致，目的是：**类型安全、行为可预测、可独立测试、低重复**。

---

## 目录

1. [架构分层约束](#1-架构分层约束)
2. [IPC 契约约定](#2-ipc-契约约定)
3. [命名规范](#3-命名规范)
4. [错误处理规范](#4-错误处理规范)
5. [React 组件规范](#5-react-组件规范)
6. [TypeScript 规范](#6-typescript-规范)
7. [样式规范](#7-样式规范)
8. [安全约束](#8-安全约束)
9. [测试规范](#9-测试规范)
10. [Git 提交规范](#10-git-提交规范)

---

## 1. 架构分层约束

项目采用**严格单向依赖的四层结构**，依赖只能自上而下：

```
┌─────────────────────────────────────────────┐
│  Renderer（React UI）                         │
│    pages / components / hooks / store / lib  │
└──────────────────┬──────────────────────────┘
                   │ IPC（contextBridge）
┌──────────────────▼──────────────────────────┐
│  IPC 层   src/main/ipc/        薄编排，无业务 │
├─────────────────────────────────────────────┤
│  Domain 层 src/main/domain/   纯逻辑，不依赖  │
│              llm/ db/ security/ agent/        │ Electron/三方库
├─────────────────────────────────────────────┤
│  Infra 层  src/main/infra/    基础设施实现    │
│              storage/ credential/ logger      │
└─────────────────────────────────────────────┘
          ▲                  ▲
          │                  │
   ┌──────┴──────────────────┴──────┐
   │  Shared  src/shared/            │  双端共享的类型契约
   │          ipc.ts + types/*.ts    │  无实现，无运行时依赖
   └────────────────────────────────┘
```

### 1.1 分层规则

| 规则            | 说明                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| **单向依赖**    | `IPC → Domain → Infra`，反向 import 禁止。`Domain` 不得 import `electron` 或 `main/ipc`。                    |
| **Shared 双向** | `shared/` 被 main 与 renderer 共同依赖，但 `shared/` **不得反向依赖 main 或 renderer**。它只放类型与纯函数。 |
| **Domain 纯净** | `domain/` 不依赖 Electron API，可用 Node 内置（如 `fetch`、`AbortController`）。确保可独立单测。             |
| **三路径归一**  | GUI / AI / MCP 三条执行路径**必须共用 `domain/` 层**，尤其 SQL 执行必经 `domain/executor.ts`，保证权限一致。 |

### 1.2 目录职责

```
src/
├── shared/          # IPC 契约 + DTO 类型（无运行时实现）
│   ├── ipc.ts       #   唯一的 IPC 通道契约中心
│   └── types/       #   各领域 DTO（connection/llm/settings/...）
├── main/
│   ├── index.ts     # 主进程入口（窗口/菜单/生命周期）
│   ├── ipc/         # IPC handler（薄编排层，每域一文件）
│   ├── domain/      # 业务逻辑（可独立测试）
│   └── infra/       # 基础设施（DB/凭据/日志）
├── preload/         # contextBridge 安全桥（仅暴露白名单 API）
└── renderer/
    ├── App.tsx      # 根组件
    ├── pages/       # 顶层页面
    ├── components/  # 可复用组件（按功能分子目录）
    ├── hooks/       # 自定义 hooks（副作用封装）
    ├── store/       # zustand store（每域一文件）
    ├── lib/         # 纯工具函数（无 React 依赖）
    ├── api/         # window.api 薄封装 + 类型 re-export
    ├── config/      # 编辑器/补全等配置
    ├── services/    # 渲染层服务（通知等）
    └── styles/      # 全局样式
```

---

## 2. IPC 契约约定

### 2.1 契约驱动（编译期类型安全）

所有 IPC channel 的 `req`/`res` 类型**集中声明**在 `src/shared/ipc.ts` 的 `IpcContracts` 接口中。
渲染进程通过 preload 暴露的 `window.api` 调用，全程享受类型推导与编译期校验。

### 2.2 新增 channel 的三处同步（强制）

新增一个 IPC channel 时，**必须同步修改以下三处**，缺一不可：

1. **`src/shared/ipc.ts`** —— 在 `IpcContracts` 中添加 `{ req, res }` 条目。
2. **`src/preload/index.ts`** —— 在 `api` 白名单对象中添加对应转发行。
3. **`src/main/ipc/<域>.ts`** —— 注册 `registerHandler('channel', ...)`，并在 `registry.ts` 的 `registerAllHandlers` 中确保被调用。

> 这是契约驱动方案的固有维护成本。提交前必须确认三处一致。

### 2.3 请求-响应 vs 流式推送

| 模式            | 用法                                                                 | 示例                |
| --------------- | -------------------------------------------------------------------- | ------------------- |
| **请求-响应**   | `window.api['channel'](req)` → `Promise<res>`                        | `'db:executeQuery'` |
| **主→渲染推送** | `event.sender.send('channel', payload)` + `window.on('channel', cb)` | `'ai:streamDelta'`  |

**流式任务标准模式**：

- `invoke` handler **立即返回** `{ streamId, ok }`，不阻塞。
- 增量/完成/错误通过事件通道异步推送（`ai:streamDelta` / `ai:streamDone` / `ai:streamError`）。
- 推送事件用 `activeStreamId` 过滤，避免并发流串扰。
- 错误用 `void runXxx().catch(err => event.sender.send('channel:error', ...))` 推送，不阻塞 invoke 返回。

### 2.4 Handler 编写规范

- **薄编排**：handler 只做取参、调 domain/dao、记日志、返回。**业务逻辑放 `domain/`**。
- **注册用 `registerHandler`**（`ipc/registry.ts`），不要直接 `ipcMain.handle`，以确保类型校验与统一错误兜底。
- **幂等**：handler 注册只在启动时执行一次，不要重复注册。

---

## 3. 命名规范

| 对象          | 规范                               | 示例                                          |
| ------------- | ---------------------------------- | --------------------------------------------- |
| 文件          | `kebab-case.ts` / `kebab-case.tsx` | `llm-provider-dao.ts`、`agent-loop.ts`        |
| 组件          | `PascalCase`，文件名与组件名一致   | `AgentWorkspace.tsx` → `AgentWorkspace`       |
| 自定义 hook   | `useXxx`                           | `useStreamChat`、`useContextMenu`             |
| zustand store | `useXxxStore`，文件 `xxx.ts`       | `store/connections.ts` → `useConnectionStore` |
| 类型 / 接口   | `PascalCase`                       | `ConnectionConfig`、`IpcContracts`            |
| 常量          | `UPPER_SNAKE_CASE`                 | `MAX_ROUNDS`、`KV_DEFAULT_AGENT_MODEL`        |
| IPC channel   | `域:动作`，全小写                  | `'db:executeQuery'`、`'ai:streamDone'`        |
| 私有/内部函数 | `camelCase`，无需前缀              | `buildSchemaContext`                          |
| 未使用的参数  | 加 `_` 前缀（eslint 配置已忽略）   | `(_event, req)`                               |

**类型归属**：跨进程共享的 DTO 一律放 `src/shared/types/<域>.ts`；仅在主进程或渲染进程内部使用的类型就近定义。

---

## 4. 错误处理规范

### 4.1 三层错误处理

1. **registry 层（兜底）**：`registerHandler` 内部 try/catch，把异常序列化为 `[channel] message` 形式抛出，渲染进程 invoke 时 reject。所有 handler 异常都不会导致主进程崩溃。
2. **handler 层（结构化结果）**：对**预期内的失败**（如连接测试失败、SQL 安全拦截需确认），handler 应 `try/catch` 后返回**结构化结果**（`{ success, message }` 或特定错误类型），而不是抛错——让前端走正常 success 分支展示错误 UI。
3. **流式任务**：异步任务的错误通过事件通道推送（`ai:streamError` / `agent:error`），不阻塞 invoke 返回。

### 4.2 领域错误类

需要携带结构化信息的错误（如安全检查结果），定义在 `domain/` 层的错误类：

```ts
export class PermissionDeniedError extends Error {
  constructor(
    public readonly checkResult: SecurityCheckResult,
    public readonly sql: string,
  ) {
    super(checkResult.reason)
    this.name = 'PermissionDeniedError'
  }
}
```

- 必须 `super(message)`，并设置 `this.name`。
- 携带的字段必须是可序列化的（经 IPC 边界时不丢失）。

### 4.3 禁止静默吞错

**禁止**裸 `.catch(() => {})` 或空 `catch {}`。错误至少要：

- `logger.error(...)`（主进程），或
- `console.error(...)`（渲染进程），或
- 上报到 UI（`setError(msg)`）。

唯一例外：**明确不会失败的清理/卸载逻辑**（如取消订阅），需加注释说明为何忽略。

---

## 5. React 组件规范

### 5.1 组件范式

- **函数组件 + Hooks**，禁用 class 组件。
- 广泛使用 `useState` / `useEffect` / `useCallback` / `useMemo` / `useRef`。
- props 必须有显式 `interface XxxProps`。

### 5.2 文件大小

**单文件超 ~400 行必须拆分**。拆分方式：

- 多个子组件 → 移到 `components/<功能>/` 子目录，各自独立文件。
- 可复用副作用 → 提取到 `hooks/useXxx.ts`。
- 纯函数 → 提取到 `lib/`。

### 5.3 事件订阅（关键）

订阅主进程事件或 DOM 事件时，**必须返回取消订阅函数并在卸载时调用**：

```ts
useEffect(() => {
  const off = window.on('ai:streamDelta', handler)
  return off // ✅ 卸载时清理，避免内存泄漏
}, [])
```

### 5.4 状态管理

- **zustand**（每域一 store），用 selector 订阅局部状态避免重渲染：
  ```ts
  const mode = useWorkspaceStore((s) => s.mode) // ✅ 只订阅 mode
  ```
- 跨组件共享的状态放 store；组件局部状态用 `useState`。
- 命令式读取用 `useXxxStore.getState()`（在回调/异步中，避免闭包旧值）。

### 5.5 可复用逻辑提取

重复出现两次以上的逻辑**必须提取**为 hook 或 lib 函数：

- 流式订阅（`useStreamChat` / `useAgentStream`）
- 右键菜单关闭（`useContextMenu`）
- 数据导出（`lib/export.ts`）
- 格式化（`lib/format.ts`）

---

## 6. TypeScript 规范

### 6.1 严格模式（已启用）

`tsconfig.base.json` 已全开 strict，包括 `noUncheckedIndexedAccess`、`noImplicitOverride`、`noFallthroughCasesInSwitch`。**不得关闭这些选项**。

### 6.2 禁止项

| 禁止                  | 替代方案                                |
| --------------------- | --------------------------------------- |
| `any`                 | 用 `unknown` + 类型守卫，或具体类型     |
| `as` 断言（除非必要） | 用类型守卫窄化；必要断言需注释说明      |
| `!` 非空断言          | 显式判空：`if (!x) return` 或抛明确错误 |
| `@ts-ignore`          | 用 `@ts-expect-error` + 注释说明原因    |

**例外**：第三方库类型擦除（如 TanStack Table 的 `row.original`）必要时可用 `as`，但需注释。

### 6.3 枚举值校验范式

从外部（KV 存储、用户输入、IPC）读取枚举值时，**用"白名单包含判断"而非"逐个等值判断"**，避免遗漏新增值：

```ts
// ✅ 白名单：新增枚举值只需改一处
const VALID_THEMES: readonly ThemeMode[] = ['system', 'light', 'dark']
theme: VALID_THEMES.includes(kv.theme as ThemeMode) ? kv.theme : DEFAULT_SETTINGS.theme

// ❌ 等值判断：容易漏掉某个合法值
theme: kv.theme === 'light' || kv.theme === 'dark' ? kv.theme : DEFAULT_SETTINGS.theme
// （这里漏了 'system'，靠默认值兜底才碰巧正确）
```

### 6.4 类型定义

- 优先 `interface`（可扩展、可合并声明），联合/映射用 `type`。
- DTO 字段必须有 JSDoc 注释（鼠标悬停可见含义）。

---

## 7. 样式规范

### 7.1 当前方案

- **原生 CSS + CSS 变量主题**，BEM 风格 class 命名。
- 全局样式集中在 `src/renderer/styles/global.css`。
- 主题变量定义在 `:root`，平台分支用 `[data-platform="win32"]`，主题分支用 `[data-theme="..."]`。

### 7.2 规则

| 规则             | 说明                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **禁止重复定义** | 同一选择器 + 相同声明块不得重复出现（复制粘贴的冗余必须合并删除）。注：基础类与变体（`.ctx-item` vs `.ctx-item:hover`、`.type-badge` vs `.type-badge.type-string`）、以及 selector group 内的共享声明 + 单规则 override，属于合法的组织方式，不算重复。 |
| **class 命名**   | BEM：`.block__element--modifier`，或带领域前缀 `.agent-tool-card`。                                                                                                                                                                                     |
| **颜色用变量**   | 不硬编码颜色，用 `var(--bg)` / `var(--primary)` 等变量。                                                                                                                                                                                                |
| **新增样式**     | 优先就近（组件同目录 `.css`）或后续模块化方案；当前阶段仍集中维护。                                                                                                                                                                                     |

### 7.3 主题

- `:root` 定义暗色（默认）调色板。
- 浅色主题用 `[data-theme="light"]` 覆盖变量（**当前为半成品，待补全**）。
- 渲染进程在 `main.tsx` 同步写入 `data-platform`，在 `store/settings.ts` 写入 `data-theme`，避免首屏闪烁。

---

## 8. 安全约束

| 约束               | 说明                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **SQL 三路径归一** | 所有 SQL 执行（GUI / AI / MCP）必经 `domain/executor.ts` → `security/`（analyzer AST 分析 + policy 环境分级）。不得绕过。                  |
| **隐私优先**       | AI 调用默认只发 Schema 结构（`domain/privacy/schema-context.ts`），**不发数据行**。                                                        |
| **凭据不入库**     | 密码、API Key 走 `infra/credential/`（keytar 系统钥匙串），**不得写入 SQLite 或日志**。                                                    |
| **安全上下文**     | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，只通过 `contextBridge` 暴露白名单 API，**不暴露原始 `ipcRenderer`**。 |
| **危险 SQL 拦截**  | `analyzer` 解析失败时保守判 `dangerous`（宁可误拦）；`DELETE/UPDATE` 无 `WHERE` 判危险。                                                   |
| **审计日志**       | SQL 执行、连接提权等敏感操作记审计（`audit_log` 表）。                                                                                     |

---

## 9. 测试规范

- **框架**：Vitest（`environment: node`），配置 `vitest.config.ts`。
- **测试范围**：`domain/` 层（不依赖 Electron 的纯逻辑）必须有单测。`shared/` 的契约一致性有契约测试（`ipc.test.ts`）。
- **命名**：`<源文件>.test.ts`，与源文件同目录。
- **CI 强制**：`pnpm test` 在 CI 中必须通过。

现有测试覆盖：

- `src/shared/ipc.test.ts`（IPC 契约一致性）
- `src/main/domain/llm/extract-sql.test.ts`（SQL 抽取）
- `src/main/domain/security/analyzer.test.ts`（SQL 危险分析）
- `src/main/domain/security/policy.test.ts`（权限策略）

---

## 10. Git 提交规范

- **Commit message**：Conventional Commits（`commitlint` 强制），type 限 `feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert`。
- **pre-commit**：husky + lint-staged 自动 `eslint --fix` + `prettier --write`。
- **提交前自检**：
  ```bash
  pnpm typecheck && pnpm lint && pnpm test
  ```
- **分支**：在 `main` 上开发时先开分支再提交。

---

## 附录：代码质量检查清单（PR 自检）

- [ ] `pnpm typecheck` 通过（含 `noUncheckedIndexedAccess`）
- [ ] `pnpm lint` 通过（无 `any`、无未用变量、无裸 console.log）
- [ ] `pnpm test` 通过
- [ ] 新增 IPC channel 已三处同步（`ipc.ts` / `preload` / handler）
- [ ] 新增组件 < 400 行（否则拆分）
- [ ] 无裸 `.catch(() => {})`（错误已记录或上报）
- [ ] 无重复定义的 CSS selector
- [ ] 敏感信息（密码/API Key）未入库、未入日志
- [ ] SQL 执行未绕过 `security/` 层
