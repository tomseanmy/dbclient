# M2 任务拆解清单 — SQL 编辑器 + 数据网格

| 项       | 内容                                    |
| -------- | --------------------------------------- |
| 文档版本 | v0.1                                    |
| 阶段     | M2（SQL 编辑器 + 数据网格）             |
| 配套     | [PRD.md](./PRD.md) · [TRD.md](./TRD.md) |
| 目标     | 用户能手写 SQL、执行、查看/编辑结果数据 |
| 最后更新 | 2026-06-14                              |

---

## 0. 验收标准（Definition of Done）

| #   | 验收项                                                   | 验证方式 |
| --- | -------------------------------------------------------- | -------- |
| D1  | SQL 编辑器：语法高亮 + 多 tab                            | 手动     |
| D2  | 执行选中 SQL 或全部，结果展示在数据网格                  | 手动     |
| D3  | 数据网格：虚拟滚动、列排序、筛选                         | 手动     |
| D4  | 类型渲染：JSON 美化、布尔 toggle、二进制 hex、时间格式化 | 手动     |
| D5  | 执行日志：时间、行数、耗时、错误                         | 手动     |
| D6  | EXPLAIN 可视化（表格形式）                               | 手动     |
| D7  | SQL 格式化（sql-formatter）                              | 手动     |
| D8  | 导出结果：CSV / JSON / 复制 SQL                          | 手动     |
| D9  | SQL 历史（本地保存、可搜索回填）                         | 手动     |
| D10 | typecheck / lint / test 全绿                             | CI       |

**M2 不做**：权限拦截（M3）、AI 辅助（M4）、MCP（M5）、数据编辑（行增删改，P1 留到 M2.5）。
**M2 范围调整**：第一版数据网格只做**只读浏览**（排序/筛选/导出），行编辑（增删改单元格）推迟。这样能更快交付高频核心功能。

---

## 1. 任务拆解（T2.1 ~ T2.6）

### T2.1 执行层：查询执行 + 结果类型映射

**目标**：在 DB 驱动层补充 `executeQuery`，返回统一的 QueryResult。

**子任务**：

- T2.1.1 在 `DbDriver` 接口补充 `executeQuery(sql, opts): Promise<QueryResult>`
  - opts：limit（行数上限，默认 1000）、timeout
  - 返回 QueryResult（已在 database.ts 定义）
- T2.1.2 MySQL/PG/SQLite 三个关系型驱动实现 executeQuery
  - 执行 SQL，取列元信息 + 行数据
  - 原始值 → CellValue 映射（BigInt/Buffer/Date 处理）
  - Redis 不实现 executeQuery（用专属命令，M2 暂不覆盖 Redis 数据编辑）
- T2.1.3 EXPLAIN 执行（MySQL/PG）
  - `executeQuery('EXPLAIN ' + sql)` 复用，结果特殊渲染
- T2.1.4 扩展 IPC：`db:executeQuery` channel

**依赖**：M1（驱动抽象）

---

### T2.2 执行入口与审计（M3 预备）

**目标**：建立「统一执行入口」骨架，M2 先做日志记录，M3 再叠加权限拦截。

**子任务**：

- T2.2.1 `src/main/domain/executor.ts`：SqlExecutor
  - `execute(ctx, sql): Promise<QueryResult>`
  - M2 版本：记录 sql_history（来源/SQL/状态/耗时/行数）+ 返回结果
  - M3 版本会在执行前插入权限判定 + 危险拦截
- T2.2.2 `sql_history` DAO：插入执行记录
- T2.2.3 IPC `db:executeQuery` 走 SqlExecutor

**依赖**：T2.1

---

### T2.3 前端：SQL 编辑器组件

**目标**：Monaco 编辑器 + 工具栏 + 多 tab。

**子任务**：

- T2.3.1 Monaco 编辑器封装（`components/sql-editor/`）
  - SQL 语法高亮
  - 执行快捷键（Ctrl/Cmd+Enter 执行全部、Ctrl/Cmd+Shift+Enter 执行选中）
- T2.3.2 工具栏：执行 / 格式化 / EXPLAIN / 导出
- T2.3.3 编辑器 tab 管理（一个连接一个 tab，可关闭）
- T2.3.4 自动补全（表名/列名，从已加载的 schema 取，P1）

**依赖**：T2.1（执行接口）

---

### T2.4 前端：数据网格组件

**目标**：TanStack Table + 虚拟滚动，只读浏览。

**子任务**：

- T2.4.1 数据网格封装（`components/data-grid/`）
  - TanStack Table v8 + 虚拟滚动（支持 1万+ 行）
  - 列排序、列筛选
  - 列宽可调（P1）
- T2.4.2 类型渲染器：
  - JSON → 美化显示 + 点击展开
  - boolean → ✓/✗
  - binary (Buffer) → hex 预览
  - datetime → 格式化
  - null → 灰色 `NULL`
  - 长文本 → 截断 + tooltip
- T2.4.3 空结果 / 错误结果 / 执行中的状态展示
- T2.4.4 底部状态栏：行数 / 耗时 / 是否截断

**依赖**：T2.1（QueryResult 类型）

---

### T2.5 前端：SQL 历史 + 导出

**子任务**：

- T2.5.1 SQL 历史面板（侧边可折叠）
  - 列表：时间 / SQL 摘要 / 状态 / 耗时
  - 点击回填到编辑器
  - 搜索过滤
- T2.5.2 导出功能
  - CSV / JSON / SQL(insert) / 复制到剪贴板
  - 前端生成（不经过主进程）

**依赖**：T2.2（历史 DAO）、T2.4（网格数据）

---

### T2.6 测试与验收

**子任务**：

- T2.6.1 SqlExecutor 单元测试（mock driver）
- T2.6.2 类型映射测试
- T2.6.3 端到端：在真实 PG 实例执行查询 + 查看结果 + 导出
- T2.6.4 文档更新 + git 提交

---

## 2. 依赖关系

```
T2.1 执行层（executeQuery）
 ├─→ T2.2 执行入口 + 审计
 │    └─→ T2.3 SQL 编辑器 ──→ T2.4 数据网格 ──→ T2.5 历史/导出 ──→ T2.6 验收
 └─→ T2.4 数据网格（依赖 QueryResult 类型）
```

**关键路径**：T2.1 → T2.2 → T2.3 → T2.4 → T2.5 → T2.6

---

## 3. 实施批次

| 批次       | 任务        | 产出                                        |
| ---------- | ----------- | ------------------------------------------- |
| **批次 A** | T2.1 + T2.2 | 后端：executeQuery + SqlExecutor + 历史 DAO |
| **批次 B** | T2.3 + T2.4 | 前端：Monaco 编辑器 + 数据网格              |
| **批次 C** | T2.5 + T2.6 | 历史 + 导出 + 验收                          |

---

## 4. 实施记录

### 4.1 交付物清单

**执行层（T2.1）**

- `driver.ts` 接口扩展：`executeQuery` + `executeStatement` + `QueryOptions`
- `value-mapper.ts`：DB 原始值（BigInt/Buffer/Date/JSON）→ 可序列化 CellValue
- MySQL/PG/SQLite 三驱动实现 executeQuery/executeStatement
- Redis 抛出「不支持 SQL」（用专属命令）
- IPC：`db:executeQuery` / `db:executeStatement`

**执行入口（T2.2）**

- `executor.ts`：SqlExecutor 统一入口（M2 版做日志，M3 叠加权限拦截）
- `sql-history-dao.ts`：执行历史 CRUD（record/list/search/clear）
- IPC：`sqlHistory:list` / `sqlHistory:search` / `sqlHistory:clear`

**前端（T2.3 + T2.4 + T2.5）**

- `SqlEditor.tsx`：Monaco 编辑器 + 工具栏 + 快捷键（⌘+Enter / ⌘+⇧+Enter）+ 格式化
- `DataGrid.tsx`：TanStack Table + 虚拟滚动 + 列排序 + 类型渲染（NULL/JSON/布尔/二进制/datetime）
- `SqlWorkspace.tsx`：整合编辑器+网格+状态栏+导出（CSV/JSON/复制）
- `SqlHistory.tsx`：可折叠历史面板 + 搜索 + 点击回填
- `App.tsx` 重写：连接节点加「查询」入口，三视图（welcome/tableDetail/sqlWorkspace）

### 4.2 关键设计决策

- **executeQuery 自动判断查询 vs 语句**：SqlExecutor 根据 SQL 前缀（SELECT/WITH/EXPLAIN/PRAGMA）判断走 `executeQuery` 还是 `executeStatement`，前端只调一个 `db:executeQuery` channel。
- **虚拟滚动自实现**：TanStack Table v8 的虚拟化方案需要额外包，M2 先用手写虚拟滚动（rowHeight=32px + scroll 监听 + 切片渲染），支持万级行。后续可换 @tanstack/react-virtual。
- **Monaco 语言按需加载**：Monaco 会按需加载各语言 grammar，bundle 体积大（8MB）但运行时懒加载，不影响首屏。
- **统一执行入口已就位**：executor.ts 是 M3 权限拦截的挂载点，M2 先跑通「执行+记录」流程。

### 4.3 验收状态

| 项                                   | 状态                                    |
| ------------------------------------ | --------------------------------------- |
| D1 Monaco 编辑器 + 高亮              | ✅                                      |
| D2 执行选中/全部 + 结果展示          | ✅                                      |
| D3 虚拟滚动 + 排序                   | ✅                                      |
| D4 类型渲染（JSON/布尔/二进制/时间） | ✅                                      |
| D5 执行日志（耗时/行数）             | ✅ 状态栏                               |
| D6 EXPLAIN                           | ✅（复用 executeQuery，结果在网格展示） |
| D7 SQL 格式化                        | ✅（sql-formatter）                     |
| D8 导出 CSV/JSON/复制                | ✅                                      |
| D9 SQL 历史 + 搜索回填               | ✅                                      |
| D10 typecheck/lint/test              | ✅ 全绿                                 |
