# AI DB Client

> 开源的 AI 原生数据库工具 —— 可视化操作 + 自然语言对话双模式，内置 MCP Server 供外部 Agent 调用。

[![CI](https://github.com/tomseanmy/dbclient/actions/workflows/ci.yml/badge.svg)](https://github.com/tomseanmy/dbclient/actions/workflows/ci.yml)
[![Release](https://github.com/tomseanmy/dbclient/actions/workflows/release.yml/badge.svg)](https://github.com/tomseanmy/dbclient/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## ✨ 核心特性

- **AI 双模式**：自然语言对话（NL2SQL / SQL 解释 / 优化建议）+ GUI 内 AI 辅助按钮，二者并重
- **环境分级权限**：dev / staging / prod 分级，prod 默认只读，危险 SQL（DROP / TRUNCATE 等）拦截并要求确认
- **隐私优先**：AI 调用默认只发送 Schema（表/列/类型/注释），不发送实际数据行
- **多数据库**：MySQL / PostgreSQL / SQLite / Redis（原生 SQL，无 ORM；Redis 支持 single / cluster / sentinel）
- **多连接多标签**：同时管理多个连接，多 tab 切换查询与浏览
- **MCP Server 内嵌**（🚧 规划中）：作为 MCP Server 暴露数据库能力，供 Claude Code / Codex / OpenCode 调用

## 🚧 当前状态

核心领域层（GUI / AI / MCP 三条执行路径共用）已基本成型：

- ✅ **连接管理**：增删改查、连通性测试、凭据经 Keychain 存储
- ✅ **对象浏览**：库 / 表 / 列 / 类型 / 注释树形展示
- ✅ **数据查看**：表格化展示、分页、行内编辑（in progress）
- ✅ **SQL 工作台**：Monaco 编辑器、格式化、执行、历史记录
- ✅ **安全层**：node-sql-parser 解析 AST → 危险级别判定 → 环境分级权限矩阵 + 审计日志
- ✅ **AI 双模式**：多 provider LLM 网关（OpenAI 兼容）、NL2SQL 生成后需用户确认执行、token 用量记录
- 🚧 **MCP Server**：目录已搭骨架，工具待实现
- 🚧 **流式输出 / 对话历史持久化 / 样本数据发送**：列为 P1

> 详见各里程碑任务清单（`docs/M{0..4}-tasks.md`）。

## 🛠 技术栈

| 层          | 技术                                                             |
| ----------- | ---------------------------------------------------------------- |
| 应用框架    | Electron 42 + electron-vite                                      |
| 语言        | TypeScript（strict）                                             |
| 前端        | React 18 + Vite                                                  |
| UI          | 原生 CSS 变量主题（macOS 暗岩灰 + 毛玻璃）+ lucide 图标          |
| 编辑器/表格 | Monaco Editor + TanStack Table                                   |
| 状态管理    | Zustand                                                          |
| 数据库驱动  | mysql2 / pg / better-sqlite3 / ioredis（原生 SQL，无 ORM）       |
| SQL 解析    | node-sql-parser（安全分析）+ sql-formatter                       |
| AI          | LLM 网关，OpenAI 兼容协议（DeepSeek / Qwen / Moonshot / Ollama） |
| MCP         | `@modelcontextprotocol/sdk` 官方 TS SDK（规划中）                |
| 凭据存储    | keytar：macOS Keychain / Win Credential Vault                    |

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
├── shared/          # 主进程与渲染进程共享的类型契约（IPC、领域 DTO）
│   └── types/       #   connection / database / llm / security
├── main/            # Electron 主进程（Node 侧）
│   ├── ipc/         #   IPC handler（应用服务层）
│   ├── domain/      #   核心领域层（不依赖 Electron，纯逻辑）
│   │   ├── db/      #     驱动抽象 + mysql/pg/sqlite/redis 实现
│   │   ├── executor.ts    SQL 执行（走安全层）
│   │   ├── llm/     #     LLM 网关 / prompt / SQL 抽取
│   │   ├── privacy/ #     Schema-only 上下文构造
│   │   └── security/#     SQL 分析 + 环境分级权限
│   ├── infra/       #   基础设施（本地库、凭据、日志）
│   └── mcp/         #   MCP Server（骨架，工具待实现）
├── preload/         # preload 脚本（contextBridge 安全桥）
└── renderer/        # 渲染进程（React UI）
    ├── components/  #   连接表单 / 对象树 / 数据表 / SQL 工作台 / AI 面板 …
    ├── pages/       #   连接管理 / 设置
    └── store/       #   Zustand store（connections / tabs）
docs/                # PRD / TRD / M0–M4 任务清单
website/             # 落地页（GitHub Pages 部署）
```

> **核心领域层（`src/main/domain/`）不依赖 Electron**，可独立测试，被 GUI 和 AI 链路共用（MCP 接入后同样复用），保证「三条执行路径权限一致」。

## 📚 文档

- [产品需求文档（PRD）](./docs/PRD.md)
- [技术路线文档（TRD）](./docs/TRD.md)
- 里程碑任务拆解：[M0](./docs/M0-tasks.md) · [M1](./docs/M1-tasks.md) · [M2](./docs/M2-tasks.md) · [M3](./docs/M3-tasks.md) · [M4](./docs/M4-tasks.md)

## 📄 License

[MIT](./LICENSE)
