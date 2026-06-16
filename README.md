# AI DB Client

> 开源的 AI 原生数据库工具 —— 可视化操作 + 自然语言对话 + Agent 自动化，三种用法共用一道安全闸门。

[![CI](https://github.com/tomseanmy/dbclient/actions/workflows/ci.yml/badge.svg)](https://github.com/tomseanmy/dbclient/actions/workflows/ci.yml)
[![Release](https://github.com/tomseanmy/dbclient/actions/workflows/release.yml/badge.svg)](https://github.com/tomseanmy/dbclient/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## ✨ 核心特性

- **AI 三态**：自然语言对话（NL2SQL / SQL 解释 / 优化建议）+ 流式响应 + Agent tool-calling 多步执行。AI 生成的 SQL 落入编辑器供你审阅，**执行前永远由你确认**。
- **数据库迁移**：结构 diff（建表 / 改列 / 索引 / 外键）+ 数据 diff + 跨库迁移，方言感知 DDL/DML，4 步向导，风险徽章（safe / caution / danger），计划可保存与导出。
- **隐私优先**：AI 调用默认只发送 Schema（表 / 列 / 类型 / 注释），不发送实际数据行。
- **环境分级权限**：dev / staging / prod 分级，prod 默认只读，危险 SQL（DROP / TRUNCATE / 缺 WHERE 的写操作）拦截并要求确认；支持 30 分钟临时提权，全过程审计留痕。
- **多数据库**：MySQL / PostgreSQL / SQLite / Redis（原生 SQL，无 ORM；Redis 支持 single / cluster）。
- **表结构编辑器**：列 / 索引 / 外键行内编辑，实时预览即将生成的 `ALTER` 语句（按方言差异化输出）。

## 🚧 当前状态

核心领域层（GUI / AI 两条执行路径共用）已基本成型：

- ✅ **连接管理**：增删改查、连通性测试、凭据经 OS 钥匙串存储（macOS Keychain / Win Credential Vault）
- ✅ **对象浏览**：库 / 表 / 列 / 类型 / 注释树形展示
- ✅ **数据查看与编辑**：表格化展示、分页、Excel 风格行内编辑（双击编辑、右键菜单、增删改行、CSV/JSON 导出）
- ✅ **SQL 工作台**：Monaco 编辑器、SQL 自动补全（表 / 列 / 别名 / 关键字）、格式化、执行、历史记录、保存查询
- ✅ **安全层**：node-sql-parser 解析 AST → 危险级别判定 → 环境分级权限矩阵 + 审计日志
- ✅ **AI 三态**：OpenAI 兼容 LLM 网关（DeepSeek / Qwen / Moonshot / Ollama），NL2SQL、流式对话、Agent tool-calling loop，token 用量记录，对话历史持久化
- ✅ **数据库迁移**：结构 + 数据 diff、方言感知脚本生成、4 步向导、计划保存与导出
- ✅ **表结构编辑器**：列 / 索引 / 外键行内编辑 + 实时 ALTER 预览
- ✅ **自动更新**：electron-updater，启动后台上台检查、就绪后提示重启
- 🚧 **MCP Server**：作为 MCP Server 暴露数据库能力供外部 Agent 调用 —— **规划中，尚未实现**
- 🚧 **其他 P1**：Redis sentinel 模式、可选发送前 N 行样本数据、列级 PII 脱敏、审计日志查看 UI、数据导入、亮色主题、英文界面

> 详见各里程碑任务清单（`docs/M{0..5}-tasks.md`）。

## 🛠 技术栈

| 层          | 技术                                                                  |
| ----------- | --------------------------------------------------------------------- |
| 应用框架    | Electron 42 + electron-vite                                           |
| 语言        | TypeScript（strict）                                                  |
| 前端        | React 18 + Vite                                                       |
| UI          | 原生 CSS 变量主题（macOS 暗岩灰 + 毛玻璃）+ lucide 图标               |
| 编辑器/表格 | Monaco Editor + TanStack Table                                        |
| 状态管理    | Zustand                                                               |
| 数据库驱动  | mysql2 / pg / better-sqlite3 / ioredis（原生 SQL，无 ORM）            |
| SQL 解析    | node-sql-parser（安全分析 + 迁移结构 diff）+ sql-formatter            |
| AI          | LLM 网关，OpenAI 兼容协议（DeepSeek / Qwen / Moonshot / Ollama）      |
| Agent       | tool-calling loop（listTables / describeTable / 只读查询 / 生成 SQL） |
| 自动更新    | electron-updater（GitHub Releases）                                   |
| 凭据存储    | keytar：macOS Keychain / Win Credential Vault                         |

## 📦 开发

### 环境要求

- Node.js ≥ 20
- pnpm ≥ 9
- macOS / Windows / Linux

### 安装与运行

```bash
pnpm install
pnpm dev          # 启动开发模式（含 HMR）
```

### 常用脚本

| 命令                | 说明                                        |
| ------------------- | ------------------------------------------- |
| `pnpm dev`          | 启动 Electron + Vite 开发模式               |
| `pnpm build`        | 构建主进程 + preload + 渲染进程             |
| `pnpm dist`         | 构建并打包当前平台安装包                    |
| `pnpm dist:mac`     | 打包 macOS 安装包                           |
| `pnpm dist:win`     | 打包 Windows 安装包                         |
| `pnpm dist:linux`   | 打包 Linux 安装包                           |
| `pnpm typecheck`    | TypeScript 类型检查（main + renderer）      |
| `pnpm lint`         | ESLint 检查                                 |
| `pnpm test`         | 运行单元测试（Vitest）                      |
| `pnpm format`       | Prettier 格式化                             |
| `pnpm format:check` | Prettier 格式检查（CI 用）                  |
| `pnpm rebuild`      | 重建 native 模块（better-sqlite3 / keytar） |

## 📁 项目结构

```
src/
├── shared/          # 主进程与渲染进程共享的类型契约（IPC、领域 DTO、迁移类型）
│   └── types/       #   connection / database / llm / security / agent / migration
├── main/            # Electron 主进程（Node 侧）
│   ├── ipc/         #   IPC handler（应用服务层）
│   ├── domain/      #   核心领域层（不依赖 Electron，纯逻辑）
│   │   ├── db/      #     驱动抽象 + mysql/pg/sqlite/redis 实现
│   │   ├── executor.ts    SQL 执行（走安全层）
│   │   ├── agent/  #     Agent tool-calling loop + 工具集
│   │   ├── llm/    #     LLM 网关 / prompt / SQL 抽取
│   │   ├── migration/ #   结构 diff / 数据 diff / 方言脚本 / 执行器
│   │   ├── privacy/ #     Schema-only 上下文构造
│   │   └── security/#     SQL 分析 + 环境分级权限
│   └── infra/       #   基础设施（本地库、凭据、日志）
├── preload/         # preload 脚本（contextBridge 安全桥）
└── renderer/        # 渲染进程（React UI）
    ├── components/  #   连接表单 / 对象树 / 数据表 / SQL 工作台
    │                #   / AI 对话 / Agent 工作区 / 迁移向导 / 表结构编辑器 …
    ├── pages/       #   连接管理 / 设置
    └── store/       #   Zustand store（connections / tabs / migration）
docs/                # PRD / TRD / M0–M5 任务清单
website/             # 落地页（GitHub Pages 部署）
```

> **核心领域层（`src/main/domain/`）不依赖 Electron**，可独立测试，被 GUI 和 AI 链路共用（MCP 接入后同样复用），保证「两条执行路径权限一致」。

## 📚 文档

- [产品需求文档（PRD）](./docs/PRD.md)
- [技术路线文档（TRD）](./docs/TRD.md)
- 里程碑任务拆解：[M0](./docs/M0-tasks.md) · [M1](./docs/M1-tasks.md) · [M2](./docs/M2-tasks.md) · [M3](./docs/M3-tasks.md) · [M4](./docs/M4-tasks.md) · [M5 迁移](./docs/M5-migration-tasks.md)

## 📄 License

[MIT](./LICENSE)
