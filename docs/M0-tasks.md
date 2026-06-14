# M0 任务拆解清单 — 工程骨架

| 项       | 内容                                                                |
| -------- | ------------------------------------------------------------------- |
| 文档版本 | v0.1                                                                |
| 阶段     | M0（骨架）                                                          |
| 配套     | [PRD.md](./PRD.md) · [TRD.md](./TRD.md)                             |
| 目标     | 跑通一个最小 Electron + React + TS 工程，具备后续所有模块的工程地基 |
| 最后更新 | 2026-06-14                                                          |

---

## 0. 验收标准（Definition of Done）

M0 完成后，必须满足以下**全部**条件：

| #   | 验收项                                                                               | 验证命令/方式     |
| --- | ------------------------------------------------------------------------------------ | ----------------- |
| D1  | `pnpm dev` 能起 Electron 窗口，渲染进程显示一个 Hello 页面（带「连接 DB 工具」占位） | 手动              |
| D2  | 修改前端代码触发 HMR，热更新生效                                                     | 手动              |
| D3  | `pnpm typecheck` 通过，0 错误                                                        | CI/local          |
| D4  | `pnpm lint` 通过，0 错误                                                             | CI/local          |
| D5  | `pnpm test` 通过（至少 1 个示例单测）                                                | CI/local          |
| D6  | 应用首次启动自动创建本地 SQLite 库，建好全部表                                       | 启动后检查日志    |
| D7  | IPC 通道打通：渲染进程调 `app:ping` 收到 `{ pong: 'pong', ts }`                      | DevTools console  |
| D8  | `pnpm build` 产出可运行的 macOS .app（本地，不签名）                                 | 打开产物          |
| D9  | Git 仓库已初始化，初始提交完成，主分支为 `main`                                      | `git log`         |
| D10 | CI（GitHub Actions）在 push 时自动跑 typecheck+lint+test                             | push 后看 Actions |

**M0 不做**：任何 DB 连接、AI、MCP、真实业务 UI。M0 只搭骨架。

---

## 1. 环境约定（已确认）

| 项             | 版本/工具                         | 说明                                |
| -------------- | --------------------------------- | ----------------------------------- |
| OS             | macOS arm64 (Apple Silicon)       | 主开发机                            |
| Node           | v24.16.0                          | 满足 Electron 30+ 要求              |
| 包管理         | **pnpm 10.17.0**                  | workspace 管理 main/renderer/shared |
| Git            | 2.51.0                            | 初始提交走 `main` 分支              |
| Docker         | 29.3.1                            | M1 起测试 DB 用，M0 不用            |
| 代码托管       | GitHub（暂未初始化，gh CLI 未装） | M0 可本地 git，远程留到 M0 末       |
| 包管理严格模式 | pnpm（不混用 yarn/npm）           | lockfile 入库                       |

---

## 2. 任务拆解（T0.1 ~ T0.7）

每个任务含：**目标 / 输入 / 输出 / 依赖 / 验证**。

### T0.1 项目骨架与目录结构

**目标**：建立 monorepo 目录与 pnpm workspace。

**子任务**：

- T0.1.1 `git init`，创建 `main` 分支
- T0.1.2 建目录骨架（对齐 TRD 第 5 章）：
  ```
  src/
    shared/          # 跨进程类型
    main/            # Electron 主进程
      ipc/
      domain/
      infra/
      mcp/
    renderer/        # React UI
    preload/         # contextBridge
  resources/         # 图标
  docs/              # 已有
  ```
- T0.1.3 初始化 `package.json`（根，私有包），`pnpm-workspace.yaml`（单包项目可不用 workspace，但保留 `shared` 作为内部模块路径）
- T0.1.4 安装核心运行时依赖：`electron`、`react`、`react-dom`、`better-sqlite3`、`electron-store`
- T0.1.5 安装开发依赖：`electron-vite`、`vite`、`typescript`、`@types/node`、`@types/react`、`@types/react-dom`

**输出**：目录树 + `package.json` + 可被 TS 识别的 `tsconfig.json`（三份：base / main / renderer，见 T0.2）

**依赖**：无（M0 起点）

**验证**：`pnpm install` 成功；`ls src` 结构正确

---

### T0.2 代码规范基建

**目标**：建立统一的代码风格与类型约束，让后续所有代码「写出来就是规整的」。

**子任务**：

- T0.2.1 `tsconfig` 体系：
  - `tsconfig.base.json` — 共享配置（strict、`target: ES2022`、`moduleResolution: bundler`）
  - `tsconfig.json`（根，引用 main/renderer 配置）
  - `src/main/tsconfig.json` — Node 侧（types: node）
  - `src/renderer/tsconfig.json` — 浏览器侧（jsx、dom lib）
- T0.2.2 ESLint：`eslint` + `typescript-eslint` + `eslint-plugin-react` + `eslint-plugin-react-hooks`，规则集：
  - 启用 `@typescript-eslint/no-explicit-any` 为 error
  - 启用 `no-unused-vars`
  - React hooks 规则
  - main 进程禁用 DOM 全局，renderer 禁用 Node 全局（通过 env）
- T0.2.3 Prettier：统一缩进 2 空格、单引号、无分号（与社区主流 Electron 项目一致，最终风格可在 commit 前调）
- T0.2.4 husky + lint-staged：
  - `pre-commit` 跑 `lint-staged`（对暂存文件跑 prettier + eslint --fix）
  - `pre-push` 可选跑 typecheck
- T0.2.5 `commitlint`（Conventional Commits，type 限定：feat/fix/docs/chore/refactor/test/...）

**输出**：`{eslint,prettier}.config.*`、三份 tsconfig、`.husky/`、`commitlint.config.*`

**依赖**：T0.1

**验证**：故意写一个 `any`，`pnpm lint` 报错；写一段不规范代码，`git commit` 时被 prettier 修正

---

### T0.3 类型化 IPC + preload 安全桥

**目标**：建立「类型安全、渲染进程无 Node 访问」的 IPC 通信骨架。这是后续所有功能的通信基础。

**子任务**：

- T0.3.1 `src/shared/ipc.ts`：定义所有 channel 的类型契约
  ```ts
  // 形如：
  export const IPC = {
    'app:ping': { req: void; res: { pong: 'pong'; ts: number } },
    // 后续 db:* / ai:* / mcp:* 在此扩展
  } as const
  ```
  并导出 `IpcChannel` 联合类型、请求/响应映射类型
- T0.3.2 `src/preload/index.ts`：用 `contextBridge` 暴露**类型化** `window.api`
  - 仅暴露白名单 channel
  - `window.api.invoke('app:ping')` 返回 `Promise<IPC['app:ping']['res']>`
- T0.3.3 `src/main/ipc/registry.ts`：主进程侧 handler 注册器，提供类型化的 `registerHandler(channel, handler)` 工具
- T0.3.4 `src/main/ipc/app.ts`：实现第一个 handler `app:ping`
- T0.3.5 `src/renderer/api/index.ts`：渲染进程侧封装，对外暴露 `api.ping()`
- T0.3.6 Electron 安全设置（`tsconfig`/`BrowserWindow`）：
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
  - `webPreferences.preload` 指向 preload 产物
  - CSP 头（开发期适度放宽，生产严格）

**输出**：可被两端复用的 IPC 类型契约 + 安全 preload + 第一个 handler

**依赖**：T0.1, T0.2

**验证**：渲染进程 `await window.api.invoke('app:ping')` 返回正确结构；尝试在渲染进程 `import 'fs'` 会失败/被拦截

---

### T0.4 本地 SQLite 初始化与迁移

**目标**：应用首次启动自动建库建表，后续模块有地方存数据。

**子任务**：

- T0.4.1 确定库文件位置：`app.getPath('userData')/app.db`（跨平台规范位置）
- T0.4.2 设计 `src/main/infra/storage/schema.sql`（M0 阶段建**全部表结构**，即使空着，避免后续频繁迁移）：
  - `connections` — 连接配置（敏感字段密文，M0 留字段）
  - `saved_queries` — 保存的查询
  - `sql_history` — SQL 执行历史
  - `chat_history` — AI 对话历史
  - `schema_cache` — Schema 缓存（连接/库/表/版本/快照 JSON）
  - `audit_log` — 审计日志（只追加）
  - `llm_usage` — Token/费用统计
  - `app_meta` — 应用元信息（含 schema_version）
- T0.4.3 `src/main/infra/storage/db.ts`：
  - 单例 `getDb()`，`better-sqlite3`，`WAL` 模式
  - 启动时读 `app_meta.schema_version`，与代码版本比对，执行未跑过的迁移
- T0.4.4 简单迁移机制：`src/main/infra/storage/migrations/` 下放编号 SQL 文件（`001_init.sql` ...），用 `app_meta` 记录已执行版本。**不引入第三方迁移库**（M0 表少，自管即可）
- T0.4.5 在主进程 `app.whenReady()` 内调用 `initDb()`
- T0.4.6 基础 DAO 层约定：M0 只写 `app_meta` 的读写（验证库可写），其余表 DAO 留到对应模块

**输出**：应用启动自动建库；后续模块可直接写表

**依赖**：T0.1, T0.3（启动流程）

**验证**：删除 `app.db` → 启动应用 → 库文件重新生成 → 检查所有表存在；再次启动不重复建表

---

### T0.5 应用窗口与生命周期 + 日志

**目标**：建立稳定的窗口生命周期、结构化日志、统一错误处理。

**子任务**：

- T0.5.1 `src/main/index.ts`：`app.whenReady()` → 初始化日志 → 初始化 DB → 创建窗口 → 注册 IPC
- T0.5.2 窗口配置：1200×800 默认，最小 900×600，标题栏，devtools 在 dev 模式自动打开
- T0.5.3 单实例锁（`app.requestSingleInstanceLock()`）—— 防止多开导致本地库/MCP 端口冲突
- T0.5.4 `src/main/infra/logger.ts`：用 `electron-log` 写文件（`userData/logs/main.log`）+ 控制台；按级别（debug/info/warn/error）；日志文件轮转
- T0.5.5 全局错误兜底：
  - 主进程 `process.on('uncaughtException'/'unhandledRejection')` → 记日志 + 弹错误对话框（生产）
  - 渲染进程 `window.onerror` / `unhandledrejection` → 通过 IPC 上报主进程
- T0.5.6 macOS 行为：关闭窗口不退出（`activate` 重建窗口）；Cmd+Q 正常退出

**输出**：稳定的应用生命周期 + 可追溯的日志

**依赖**：T0.1, T0.2

**验证**：故意在 handler 里抛错 → 日志记录 + 不崩溃；查看 `userData/logs/main.log` 有内容

---

### T0.6 开源工程化（README / LICENSE / gitignore / CI）

**目标**：让仓库达到「能公开、能协作」的最低标准。

**子任务**：

- T0.6.1 `.gitignore`：`node_modules/`、`dist/`、`out/`、`*.log`、`.env*`、`coverage/`、`app.db`、`.DS_Store`、IDE 目录
- T0.6.2 `LICENSE`：MIT（对齐 PRD Q4 决策），署名 + 年份
- T0.6.3 `README.md`：
  - 项目一句话定位 + 三个核心特性（AI 双模式 / MCP Server / 环境分级权限）
  - 当前状态（M0，开发中）
  - 技术栈表
  - 开发环境要求 + `pnpm install` / `pnpm dev` / `pnpm build`
  - 项目结构说明（链接到 TRD）
  - 文档索引（PRD / TRD / 本文档）
  - License
- T0.6.4 `.github/workflows/ci.yml`：push/PR 触发，矩阵先只 macos-latest（主开发机），跑 `pnpm install --frozen-lockfile` + `typecheck` + `lint` + `test`
- T0.6.5 Issue / PR 模板（`.github/` 下，简版即可）
- T0.6.6（可选）`code Of conduct` / `CONTRIBUTING.md` — M0 可跳过

**输出**：可公开的仓库

**依赖**：T0.1 ~ T0.5（README 要引用实际命令）

**验证**：本地 `git status` 干净；push 到 GitHub 后 CI 绿（远程仓库创建留到 M0 末）

---

### T0.7 整体验收

**目标**：按 §0 的 D1–D10 逐项验收。

**子任务**：

- T0.7.1 跑一遍 D1–D10 全部检查
- T0.7.2 修复发现的问题
- T0.7.3 （可选）创建 GitHub 远程仓库并首次推送
- T0.7.4 打 tag `v0.1.0-m0`，M0 收尾

**输出**：通过全部验收项的 M0 工程骨架

**依赖**：T0.1 ~ T0.6

---

## 3. 依赖关系图

```
T0.1 骨架
 ├─→ T0.2 规范
 │    └─→ T0.3 IPC (依赖 tsconfig)
 │         └─→ T0.4 SQLite (依赖启动流程来自 T0.3/T0.5)
 │              └─→ T0.6 开源化 (依赖实际命令)
 │                   └─→ T0.7 验收
 └─→ T0.5 窗口/日志 (依赖 T0.1/T0.2)
```

**关键路径**：T0.1 → T0.2 → T0.3 → T0.4 → T0.7

T0.5 和 T0.6 可与 T0.3/T0.4 并行。

---

## 4. M0 产出物清单（交付物）

- [ ] 可运行的 Electron + React 工程（`pnpm dev`）
- [ ] 三份 tsconfig + eslint + prettier + husky + commitlint
- [ ] 类型化 IPC 骨架 + preload + `app:ping`
- [ ] 本地 SQLite 自动建库 + 8 张表 + 迁移机制
- [ ] 窗口生命周期 + 日志 + 错误兜底
- [ ] README + LICENSE + .gitignore + CI
- [ ] 通过 D1–D10 全部验收

---

## 5. 风险与备注

| #   | 风险                                                             | 对策                                                                  |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| R1  | `better-sqlite3` 是 native 模块，需与 Electron 的 ABI 匹配       | 用 `@electron/rebuild` 或 `electron-vite` 内置重建；M0 验证通过即锁定 |
| R2  | Electron 安全配置（CSP/contextIsolation）在 dev 模式下可能阻 HMR | dev 用宽松 CSP，prod 严格；在 vite 配置里区分                         |
| R3  | preload 与 renderer 的类型共享（`window.api` 类型）易出错        | 在 `shared/` 定义类型，renderer 全局声明引用                          |
| R4  | `pnpm` 对 native 模块的依赖提升可能与 npm 不同                   | 用 `pnpm` 跑 `rebuild`；如遇坑切 `node-linker=hoisted`                |

> M0 是地基，宁可慢一点把规范和类型打扎实。后续 6 个模块（M1–M6）都建立在这套骨架上。

---

## 6. M0 之后（衔接 M1）

M0 完成后，M1（连接管理 + 对象浏览）将直接复用：

- IPC 骨架 → 新增 `connection:*` / `db:*` channel
- SQLite 库 → 写 `connections` 表 DAO
- 凭据存储抽象 → `src/main/infra/credential/`（keytar + 主密码兜底）
- DB 驱动抽象 → `src/main/domain/db/`（4 实现）

---

## 7. 实施记录（踩坑与最终版本矩阵）

M0 实施过程中踩了若干版本兼容和环境相关的坑，记录如下供后续参考。

### 7.1 最终锁定的版本矩阵

| 依赖                 | 锁定版本     | 原因                                                                |
| -------------------- | ------------ | ------------------------------------------------------------------- |
| electron             | **^42.4.0**  | 开发机为 macOS 27 (Tahoe)，Electron 31 的 Chromium 不支持，必须 42+ |
| electron-vite        | **^3.1.0**   | 与 vite 5 配套；v5+ 要求 vite 6/8，生态未跟上                       |
| vite                 | **^5.4.21**  | electron-vite 3 + plugin-react 4 的稳定基线                         |
| @vitejs/plugin-react | **^4.7.0**   | v6 要求 vite 6+，与 vite 5 不兼容                                   |
| vitest               | **^2.1.9**   | v4 要求 vite 6+（访问 `vite/module-runner`），vite 5 下用 v2        |
| typescript-eslint    | **^8**       | 与 eslint 9 配套                                                    |
| eslint               | **^9.39.4**  | v10 与 eslint-plugin-react 不兼容（context API 变更）               |
| better-sqlite3       | **^12.10.1** | 切换 electron 版本后需 `pnpm rebuild` 重编译                        |

### 7.2 关键坑与对策

#### 坑 1：`ELECTRON_RUN_AS_NODE=1` 导致 Electron 以纯 Node 模式运行

**现象**：`require('electron')` 返回路径字符串而非 API 对象，`app` 为 undefined。

**根因**：开发环境（ZCode 等 Electron 宿主）注入了 `ELECTRON_RUN_AS_NODE=1`，该变量让 Electron 进程完全跳过 Framework 加载，退化为纯 Node。

**对策**：所有启动 electron 的 npm script 用 `cross-env ELECTRON_RUN_AS_NODE=` 显式清空：

```json
"dev": "cross-env ELECTRON_RUN_AS_NODE= electron-vite dev"
```

#### 坑 2：extract-zip 无法正确解压 macOS Electron.app

**现象**：electron 的 postinstall 用 extract-zip 解压，但 macOS app bundle 内的符号链接被破坏，导致 Framework 加载失败、`electron --version` 返回 Node 版本。

**根因**：extract-zip 对 macOS 符号链接和资源 fork 支持不完整。

**对策**：

- 开发环境首次安装后若二进制损坏，手动用 `ditto -x -k <zip> <dest>` 解压（macOS 原生，正确处理符号链接）
- 再用 `codesign --force --deep --sign -` 重新 ad-hoc 签名
- 已通过 onlyBuiltDependencies + 升级到 electron 42 缓解；CI 上通常无此问题

#### 坑 3：`"type": "module"` 与 Electron 主进程入口冲突

**现象**：Electron 31/42 主进程加载 `.js` 入口时，因项目 `"type": "module"` 走 ESM 加载链路，与 CJS 依赖（electron-log、better-sqlite3）互操作失败。

**对策**：移除根 `package.json` 的 `"type": "module"`；ESM 配置文件（eslint/commitlint）改用 `.mjs` 后缀；main/preload 产物输出为 CJS（`format: 'cjs'`）。renderer 仍走 vite ESM 不受影响。

#### 坑 4：migrations SQL 文件路径在 dev/build 下不一致

**现象**：`__dirname` 在 dev 模式指向产物目录 `out/main/`，SQL 文件在源码目录，找不到。

**对策**：用 vite 的 `import.meta.glob('./migrations/*.sql', { query: 'raw', eager: true })` 在编译期内联 SQL 文本，dev/build 行为一致。

### 7.3 验收结果

M0 全部验收项（D1–D10）状态：

| 项             | 状态 | 备注                              |
| -------------- | ---- | --------------------------------- |
| D1 dev 启动    | ✅   | Electron 窗口正常显示             |
| D2 HMR         | ✅   | vite dev server + electron-vite   |
| D3 typecheck   | ✅   | main + renderer 均 0 错误         |
| D4 lint        | ✅   | eslint 0 错误                     |
| D5 test        | ✅   | 3 个 IPC 契约测试通过             |
| D6 SQLite 建表 | ✅   | 9 张业务表 + app_meta             |
| D7 IPC 连通    | ✅   | `app:ping` / `app:getInfo` 可调   |
| D8 build 产物  | ✅   | main/preload/renderer 三段产出    |
| D9 git 初始化  | ✅   | main 分支                         |
| D10 CI         | ✅   | workflow 已配置（待远程仓库验证） |
