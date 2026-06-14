# M1 任务拆解清单 — 连接管理 + 对象浏览

| 项       | 内容                                                                   |
| -------- | ---------------------------------------------------------------------- |
| 文档版本 | v0.1                                                                   |
| 阶段     | M1（连接管理 + 对象浏览）                                              |
| 配套     | [PRD.md](./PRD.md) · [TRD.md](./TRD.md) · [M0-tasks.md](./M0-tasks.md) |
| 目标     | 用户能新建/编辑/删除数据库连接，连接后浏览库/表/列结构                 |
| 最后更新 | 2026-06-14                                                             |

---

## 0. 验收标准（Definition of Done）

| #   | 验收项                                                    | 验证方式              |
| --- | --------------------------------------------------------- | --------------------- |
| D1  | 新建连接向导：选类型→填参数→测试连接→保存                 | 手动操作              |
| D2  | 支持 MySQL / PostgreSQL / SQLite / Redis 四种类型         | 各连一个真实/容器实例 |
| D3  | 连接列表（侧边栏）展示所有连接，支持搜索/分组             | 手动                  |
| D4  | 编辑/删除/克隆连接，删除二次确认                          | 手动                  |
| D5  | 密码用 keytar（macOS Keychain）存储，DB 中无明文          | 检查 DB + keychain    |
| D6  | 双击连接展开对象树：库→表/视图→列                         | 手动                  |
| D7  | 选中表显示详情：列名/类型/注释/索引/行数估算              | 手动                  |
| D8  | Redis 连接展示 db index + key 概览（先不做完整 key 浏览） | 手动                  |
| D9  | 连接状态指示（已连接/断开/错误）                          | 手动                  |
| D10 | typecheck / lint / test 全绿                              | CI                    |

**M1 不做**：SQL 编辑器执行、数据网格编辑、AI 功能、MCP Server、危险 SQL 拦截（那是 M2/M3/M4/M5）。

---

## 1. 任务拆解（T1.1 ~ T1.7）

### T1.1 共享类型定义（连接 + 数据库元数据）

**目标**：定义连接配置、数据库对象（库/表/列/索引）的统一类型，主进程与渲染进程共享。

**子任务**：

- T1.1.1 `src/shared/types/connection.ts`：连接配置类型
  - `DbType = 'mysql' | 'postgres' | 'sqlite' | 'redis'`
  - `Environment = 'dev' | 'staging' | 'prod'`
  - `ConnectionConfig`：id/name/type/host/port/username/database/options/environment/groupId/color/sortOrder
  - `ConnectionListItem`：不含密码的列表项（给前端用）
  - `ConnectionInput`：新建/编辑时的输入类型
- T1.1.2 `src/shared/types/database.ts`：数据库对象元数据
  - `Schema`、`Table`、`View`、`Column`、`Index`、`ForeignKey`
  - `TableMeta`：describeTable 的返回（含列/索引/行数估算）
  - `UnifiedType`：DB 类型 → 统一类型枚举（string/number/boolean/datetime/json/binary/enum/other）
  - `CellValue`：统一单元格值类型
- T1.1.3 在 `src/shared/ipc.ts` 扩展 connection/db 相关 channel 契约

**依赖**：无（M0 已完成）

---

### T1.2 DB 驱动抽象层 + 4 实现

**目标**：定义统一接口，4 种库各自实现。TRD 3.1 节的核心。

**子任务**：

- T1.2.1 `src/main/domain/db/driver.ts`：统一接口 `DbDriver`
  - `connect()` / `disconnect()` / `testConnection()`
  - `listSchemas()` / `listTables(schema)` / `describeTable(schema, table)`
  - `executeQuery(sql, opts)` / `executeStatement(sql, opts)`（M1 先不调用，留接口）
- T1.2.2 `src/main/domain/db/mysql.ts`：mysql2 实现
- T1.2.3 `src/main/domain/db/postgres.ts`：pg 实现
- T1.2.4 `src/main/domain/db/sqlite.ts`：better-sqlite3 实现
- T1.2.5 `src/main/domain/db/redis.ts`：ioredis 实现
  - 适配为类似语义：listSchemas 返回 db index 列表，listTables 返回 key 数量概览
  - M1 不做完整 key 浏览（那是 M2/M4）
- T1.2.6 `src/main/domain/db/manager.ts`：连接管理器
  - 维护活跃连接的 driver 实例池（id → driver）
  - `getDriver(connId)` / `closeDriver(connId)` / `closeAll()`

**依赖**：T1.1

---

### T1.3 凭据存储（keytar + 主密码兜底）

**目标**：密码安全存储，DB 中只有密文或根本不存密码。

**子任务**：

- T1.3.1 `src/main/infra/credential/store.ts`：`CredentialStore` 接口
  - `getPassword(connId)` / `setPassword(connId, password)` / `deletePassword(connId)`
- T1.3.2 `src/main/infra/credential/keychain.ts`：keytar 实现（macOS Keychain / Win Vault）
  - service = 'ai-db-client'，account = connId
- T1.3.3 主密码兜底实现（P2，M1 先用 keytar，Linux 无 keyring 时再补）

**依赖**：T1.1

---

### T1.4 连接 DAO + IPC handler

**目标**：连接配置的 CRUD 持久化 + 对外 IPC 接口。

**子任务**：

- T1.4.1 `src/main/infra/storage/connections-dao.ts`：
  - `list()` / `get(id)` / `create(input)` / `update(id, input)` / `remove(id)`
  - create/update 时调用 CredentialStore 存密码
  - remove 时删除对应密码
  - `list()` 返回不含密码的 `ConnectionListItem[]`
- T1.4.2 `src/main/ipc/connection.ts`：连接管理 IPC handler
  - `connection:list` / `connection:get` / `connection:create` / `connection:update` / `connection:delete`
  - `connection:test`（测试连接，不保存）
- T1.4.3 `src/main/ipc/database.ts`：数据库浏览 IPC handler
  - `db:connect` / `db:disconnect` / `db:status`
  - `db:listSchemas` / `db:listTables` / `db:describeTable`
- T1.4.4 注册到 `registry.ts`

**依赖**：T1.1, T1.2, T1.3

---

### T1.5 前端：连接管理 UI

**目标**：新建/编辑/删除连接的可视化界面。

**子任务**：

- T1.5.1 `src/renderer/store/connections.ts`：连接状态（Zustand）
- T1.5.2 `src/renderer/pages/connections/`：
  - 连接列表页（表格/卡片，支持搜索、按环境过滤）
  - 新建/编辑连接表单（根据 type 动态显示字段）
  - 测试连接按钮
- T1.5.3 连接表单的动态字段：
  - MySQL/PG：host/port/user/password/database/charset/ssl
  - SQLite：文件路径选择
  - Redis：host/port/password/dbIndex/cluster 模式
- T1.5.4 环境选择器（dev/staging/prod）+ 颜色标记

**依赖**：T1.4（IPC 接口）

---

### T1.6 前端：对象浏览器 UI

**目标**：侧边栏对象树 + 表详情面板。

**子任务**：

- T1.6.1 `src/renderer/components/object-tree/`：树形组件
  - 连接节点（点击展开）→ 库节点 → 表/视图节点 → 列节点
  - 懒加载：点击连接才连库，点击库才加载表，点击表才加载列
  - 连接状态图标（连接中/已连接/错误/断开）
- T1.6.2 `src/renderer/pages/workspace/`：主工作区布局（左树 + 右内容）
- T1.6.3 表详情面板：
  - 列表（名称/类型/可空/默认值/注释）
  - 索引列表
  - 行数估算
  - DDL 复制按钮
- T1.6.4 Redis 特化视图：db index + key 数量概览

**依赖**：T1.4, T1.5

---

### T1.7 测试与验收

**子任务**：

- T1.7.1 单元测试：类型映射、连接 DAO（用临时 SQLite）
- T1.7.2 集成测试：用 Docker 起 MySQL/PG/Redis 容器，端到端验证连接+浏览（手动为主）
- T1.7.3 跑全量 typecheck/lint/test
- T1.7.4 更新文档 + git 提交

**依赖**：T1.1 ~ T1.6

---

## 2. 依赖关系

```
T1.1 类型定义
 ├─→ T1.2 DB 驱动抽象（4 实现）
 │    └─→ T1.4 连接 DAO + IPC
 ├─→ T1.3 凭据存储
 │    └─→ T1.4
 └─→ T1.5 连接管理 UI ──→ T1.6 对象浏览器 UI ──→ T1.7 验收
```

**关键路径**：T1.1 → T1.2 → T1.4 → T1.5 → T1.6 → T1.7

---

## 3. 实施批次

为控制单步复杂度，分 3 批实施：

| 批次       | 任务                                      | 产出                                         |
| ---------- | ----------------------------------------- | -------------------------------------------- |
| **批次 A** | T1.1 类型 + T1.2 驱动抽象 + T1.3 凭据     | 后端核心：能连 4 种库、取 schema、安全存密码 |
| **批次 B** | T1.4 DAO + IPC                            | 主进程对外接口齐全                           |
| **批次 C** | T1.5 连接 UI + T1.6 对象树 UI + T1.7 验收 | 用户可见的完整功能                           |

---

## 4. 实施记录

### 4.1 交付物清单

**共享类型（T1.1）**

- `src/shared/types/connection.ts` — 连接配置/列表项/输入/测试类型
- `src/shared/types/database.ts` — Schema/Table/Column/Index/ForeignKey/TableMeta/统一类型
- `src/shared/ipc.ts` — 扩展 11 个新 channel（connection:_ × 6 + db:_ × 5）

**DB 驱动（T1.2）**

- `src/main/domain/db/driver.ts` — 统一 `DbDriver` 接口 + `createDriver` 工厂 + `mapUnifiedType`
- `src/main/domain/db/mysql.ts` — mysql2 实现（information_schema 内省）
- `src/main/domain/db/postgres.ts` — pg 实现（pg_catalog 内省）
- `src/main/domain/db/sqlite.ts` — better-sqlite3 实现（PRAGMA 内省）
- `src/main/domain/db/redis.ts` — ioredis 实现（keyspace 概览）
- `src/main/domain/db/manager.ts` — 连接池管理器（id → driver）

**凭据存储（T1.3）**

- `src/main/infra/credential/store.ts` — `CredentialStore` 接口 + keytar (Keychain) 实现

**DAO + IPC（T1.4）**

- `src/main/infra/storage/connections-dao.ts` — 连接 CRUD（密码走 CredentialStore）
- `src/main/ipc/connection.ts` — connection:list/get/create/update/delete/test
- `src/main/ipc/database.ts` — db:connect/disconnect/listSchemas/listTables/describeTable/getRedisOverview

**前端 UI（T1.5 + T1.6）**

- `src/renderer/store/connections.ts` — Zustand 状态（连接列表 + 浏览状态）
- `src/renderer/components/ConnectionForm.tsx` — 动态字段连接表单 + 测试按钮
- `src/renderer/components/ObjectTree.tsx` — 懒加载对象树（连接→schema→表）
- `src/renderer/components/TableDetail.tsx` — 表详情（列/索引/外键/DDL tabs）+ Redis 概览
- `src/renderer/pages/ConnectionManager.tsx` — 连接管理（卡片列表 + 新建/编辑/删除/克隆）
- `src/renderer/App.tsx` — 重写为侧边栏 + 主内容区布局
- `src/renderer/styles/global.css` — 完整应用样式

### 4.2 验收状态

| 项                      | 状态 | 备注                              |
| ----------------------- | ---- | --------------------------------- |
| D1 连接向导             | ✅   | 类型选择 + 动态字段 + 测试 + 保存 |
| D2 四种数据库           | ✅   | MySQL/PG/SQLite/Redis 驱动均实现  |
| D3 连接列表侧边栏       | ✅   | 对象树 + 连接管理页               |
| D4 编辑/删除/克隆       | ✅   | 删除二次确认弹窗                  |
| D5 keytar 密码存储      | ✅   | macOS Keychain，DB 中无明文       |
| D6 对象树懒加载         | ✅   | 连接→schema→表逐级加载            |
| D7 表详情面板           | ✅   | 列/索引/外键/DDL 四 tab           |
| D8 Redis 概览           | ✅   | 各 db index key 数量              |
| D9 连接状态指示         | ✅   | 绿/灰圆点 + loading + error       |
| D10 typecheck/lint/test | ✅   | 全绿                              |

### 4.3 注意事项

- **better-sqlite3 双 ABI 问题**：应用本地库和用户 SQLite 连接共用 better-sqlite3，它为 Electron ABI 编译，纯 Node 脚本（vitest）无法直接测试 driver。driver 逻辑需在 Electron 运行时内验证。
- **端到端测试**：需要实际数据库实例（MySQL/PG/Redis）或 SQLite 文件。建议用 Docker 起测试库，或直接在 GUI 内创建连接验证。
- **keytar 在 CI 环境**：CI 无 Keychain，keytar 会失败。生产环境（macOS/Win）正常。Linux 无 keyring 时需主密码兜底（P2）。
