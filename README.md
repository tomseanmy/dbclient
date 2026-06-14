# AI DB Client

> 开源的 AI 原生数据库工具 —— 可视化操作 + 自然语言对话双模式，内置 MCP Server 供外部 Agent 调用。

[![CI](https://github.com/tomsean/ai-db-client/actions/workflows/ci.yml/badge.svg)](https://github.com/tomsean/ai-db-client/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## ✨ 核心特性

- **AI 双模式**：自然语言对话 + GUI 内 AI 辅助按钮，二者并重
- **MCP Server 内嵌**：作为 MCP Server 暴露数据库能力，Claude Code / Codex / OpenCode 可直接调用
- **环境分级权限**：dev / staging / prod 分级，prod 默认只读，危险 SQL 拦截
- **隐私优先**：AI 调用默认只发送 Schema，不发送实际数据行
- **多数据库**：MySQL / PostgreSQL / SQLite / Redis（第一版）
- **多连接多标签**：同时管理多个连接，多 tab 切换

## 🚧 当前状态

**M0 工程骨架已完成。** 正在开发 M1（连接管理 + 对象浏览）。

## 🛠 技术栈

| 层         | 技术                                                       |
| ---------- | ---------------------------------------------------------- |
| 应用框架   | Electron 31                                                |
| 语言       | TypeScript（strict）                                       |
| 前端       | React 18 + Vite                                            |
| UI         | Shadcn UI + Tailwind CSS（规划）                           |
| 数据库驱动 | mysql2 / pg / better-sqlite3 / ioredis（原生 SQL，无 ORM） |
| MCP        | `@modelcontextprotocol/sdk` 官方 TS SDK                    |
| 凭据存储   | macOS Keychain / Win Credential Vault / 主密码加密         |

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

| 命令             | 说明                                                         |
| ---------------- | ------------------------------------------------------------ |
| `pnpm dev`       | 启动 Electron + Vite 开发模式                                |
| `pnpm build`     | 构建主进程 + preload + 渲染进程                              |
| `pnpm typecheck` | TypeScript 类型检查（main + renderer）                       |
| `pnpm lint`      | ESLint 检查                                                  |
| `pnpm test`      | 运行单元测试（Vitest）                                       |
| `pnpm format`    | Prettier 格式化                                              |
| `pnpm rebuild`   | 重建 better-sqlite3 native 模块（切换 Node/Electron 版本后） |

## 📁 项目结构

```
src/
├── shared/          # 主进程与渲染进程共享的类型契约（IPC 等）
├── main/            # Electron 主进程（Node 侧）
│   ├── ipc/         # IPC handler（应用服务层）
│   ├── domain/      # 核心领域层（不依赖 Electron，纯逻辑）
│   ├── infra/       # 基础设施（本地库、凭据、日志）
│   └── mcp/         # MCP Server
├── preload/         # preload 脚本（contextBridge 安全桥）
└── renderer/        # 渲染进程（React UI）
docs/                # PRD / TRD / 任务清单
```

> **核心领域层（`src/main/domain/`）不依赖 Electron**，可独立测试，被 GUI 和 MCP Server 共用，保证「三条执行路径（GUI / AI / MCP）权限一致」。

## 📚 文档

- [产品需求文档（PRD）](./docs/PRD.md)
- [技术路线文档（TRD）](./docs/TRD.md)
- [M0 任务拆解清单](./docs/M0-tasks.md)

## 📄 License

[MIT](./LICENSE)
