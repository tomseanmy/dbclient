# M5 任务拆解清单 — 数据库迁移（结构 diff + 数据 diff + 跨库迁移）

| 项       | 内容                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| 文档版本 | v0.1                                                                                                         |
| 阶段     | M5（数据库迁移）                                                                                             |
| 配套     | [PRD.md](./PRD.md) · [TRD.md](./TRD.md)（§3.1 驱动抽象）· [CODING_STANDARDS.md](./CODING_STANDARDS.md)       |
| 目标     | 两维度迁移：①结构迁移（表 diff → DDL）；②数据迁移（PK diff / 全量替换）。独创：异构库迁移（MySQL↔PG↔SQLite） |
| 最后更新 | 2026-06-16                                                                                                   |

---

## 0. 验收标准（Definition of Done）

| #   | 验收项                                                                                                  | 验证方式      |
| --- | ------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | 选择「源连接.schema.表」与「目标连接.schema.表」，可生成结构 diff（新增/修改/删除列 + 索引/外键）       | 手动          |
| D2  | 结构 diff 渲染为可逐条勾选执行的 DDL（`ALTER TABLE ADD/DROP/MODIFY COLUMN`、`CREATE/DROP INDEX`）       | 手动 + 单测   |
| D3  | 数据迁移三种模式：①按 PK 增量（新增/删除，不做 update）；②全量替换（TRUNCATE+INSERT 或 DELETE+INSERT）  | 手动 + 单测   |
| D4  | 数据迁移**不实现 update**（明确产品边界，降低数据污染风险）                                             | 设计评审      |
| D5  | 跨库迁移：MySQL → PG、MySQL → SQLite、PG → SQLite 等组合，类型自动映射（基于 `UnifiedType`）            | 手动 + 单测   |
| D6  | 跨库类型映射不可逆场景明确告警（如 PG `jsonb`→SQLite 无原生 json；MySQL `enum`→PG 需建枚举或降级 text） | 手动          |
| D7  | 所有迁移 DDL/DML 默认只生成脚本，**不自动执行**；执行走 M3 安全层（危险确认 + 审计）                    | 手动 + 查审计 |
| D8  | 支持事务包裹（可配置「单语句事务 / 全量一个事务 / 无事务」），失败回滚                                  | 手动          |
| D9  | 大表数据迁移支持分批（batch size 可配）+ 进度反馈，避免长事务/锁表                                      | 手动          |
| D10 | 迁移任务可命名、可保存为「迁移方案」复用（含源/目标/表清单/选项）                                       | 手动          |
| D11 | 生成脚本可导出为 `.sql` 文件（目标库方言）                                                              | 手动          |
| D12 | 同库同表迁移同样可用（等价于 schema 演进工具，覆盖 80% 日常场景）                                       | 手动          |
| D13 | typecheck / lint / test 全绿                                                                            | CI            |
| D14 | 数据迁移**强制事务**：默认 `single`，大表可切 `perStatement`，**禁止 `none`**；任一失败必回滚           | 手动 + 单测   |
| D15 | 跨库 enum 统一降级 `TEXT`/`VARCHAR` + `CHECK` 约束，**不建真枚举**                                      | 单测          |
| D16 | 迁移方案可命名保存 / 列表 / 复用 / 删除（持久化到本地 SQLite）                                          | 手动 + 查库   |

**M5 不做**：反向同步（目标→源）、行级 update 迁移（产品边界）、视图/存储过程/触发器迁移（P1）、增量实时同步（P2）、Redis 迁移（数据模型差异大，P1 评估）。

---

## 1. 设计原则

### 1.1 核心洞察：复用已有统一元数据 IR

本项目 `TableMeta`（`src/shared/types/database.ts`）已是 **DB 无关的结构 IR**：`Column` 携带 `dataType`（原始）+ `unifiedType`（统一）+ `length/scale/nullable/...`。这是跨库迁移能成立的基石——

- 市面工具多在 **SQL 文本层 diff**（解析 `CREATE TABLE` 文本），因此只能同库；
- 本项目在 **统一 IR 层 diff**，源端任何库 → IR → 目标端任何库方言，天然跨库。

```
迁移引擎数据流

源端 TableMeta  ──┐
                  ├─→ StructureDiff（IR 层 diff）─→ DDL 生成器（目标方言）─→ ALTER/CREATE/DROP
目标端 TableMeta ─┘                                   │
                                                      └─→ M3 安全层 ─→ 执行
源端行流  ──────→ 类型转换器（unifiedType）─→ 目标方言 INSERT ─→ 分批执行
```

### 1.2 两种迁移维度正交解耦

| 维度     | 输入                              | 比对键                 | 输出                          | 动作集合                                 |
| -------- | --------------------------------- | ---------------------- | ----------------------------- | ---------------------------------------- |
| 结构迁移 | 源 `TableMeta` + 目标 `TableMeta` | 列名 / 索引名 / 外键名 | DDL（目标方言）               | ADD / MODIFY / DROP（列/索引/约束）      |
| 数据迁移 | 源行 + 目标行                     | 主键（PK）             | DML（目标方言 INSERT/DELETE） | INSERT（新增）/ DELETE（删除）/ 全量替换 |

两维度可独立勾选、独立执行；也可组合（先结构后数据）。

### 1.3 数据迁移的三种策略

| 策略       | 行为                                                       | 适用场景                   | update？       |
| ---------- | ---------------------------------------------------------- | -------------------------- | -------------- |
| 增量（PK） | 目标缺的 PK → INSERT；目标多的 PK → DELETE；PK 相同 → 跳过 | 双向收敛、保留目标既有修改 | ❌ 不做        |
| 全量替换   | 目标清空（TRUNCATE 或 DELETE）+ 源全量 INSERT              | 以源为准、目标可丢弃       | ❌（等价替换） |
| 仅新增     | 目标缺的 PK → INSERT；目标多的 PK → 保留不动               | 单向补数据、不破坏目标     | ❌ 不做        |

> **产品边界**：不做行级 `UPDATE`。理由——①避免覆盖目标侧人工修改；②diff 语义复杂（哪列算"改"）；③降低误操作。如需更新，引导用户走"全量替换"。

> **数据安全不变量**：数据迁移**强制事务**。默认 `single`（全量一个事务，失败整体回滚）；仅当单表数据量超过阈值（默认 10w 行）时，允许切换 `perStatement`（分批提交，单批失败即中止并标记）。**`useTransaction: 'none'` 对数据迁移一律拒绝**（结构迁移可选 none，因其本身多为 DDL 隐式提交）。fullReplace 默认走 `DELETE+INSERT` 而非 `TRUNCATE`（TRUNCATE 在 MySQL/PG 下无法事务回滚）。

### 1.4 安全不变量：复用 M3

迁移生成的 DDL/DML **不直接执行**，统一走 M3 安全层：

```
生成迁移脚本
  → 用户勾选要执行的语句
    → db:confirmExecute（M3：权限判定 / 危险确认 / 审计）
      → 事务包裹执行 ─→ 成功提交 / 失败回滚
```

- DROP/TRUNCATE 等危险语句强制二次确认；
- 数据迁移建议默认「先生成脚本预览」开关 ON；
- 全程记审计日志，含源/目标连接、表、行数、耗时。

---

## 2. 任务拆解

> 分 4 批次（A→D）递进：A 类型与抽象 → B 结构迁移 → C 数据迁移 → D 跨库 + UI。每批次结束 typecheck/lint/test 全绿。

### T5.1 迁移领域模型与抽象（批次 A）

**目标**：定义迁移相关的全部共享类型，建立方言生成器抽象。本批次纯类型+纯函数，无副作用，易测试。

**子任务**：

- **T5.1.1** 共享类型 `src/shared/types/migration.ts`
  - `MigrationTarget`：`{ connectionId, schema?, table }`（源/目标通用）
  - `StructureDiffItem`：判别联合
    - `{ kind: 'addColumn', column: Column }`
    - `{ kind: 'modifyColumn', column: Column, changes: Partial<Column> }`（记录改了哪些属性）
    - `{ kind: 'dropColumn', columnName: string }`
    - `{ kind: 'addIndex' | 'dropIndex', index: Index }`
    - `{ kind: 'addForeignKey' | 'dropForeignKey', fk: ForeignKey }`
    - `{ kind: 'createTable', tableMeta: TableMeta }`（目标表不存在）
    - `{ kind: 'dropTable', tableName: string }`（源表已删，可选）
  - `DataDiffItem`：
    - `{ kind: 'insert', pk: CellValue[], row: Record<string, CellValue> }`
    - `{ kind: 'delete', pk: CellValue[] }`
  - `DataStrategy`：`'incremental' | 'fullReplace' | 'insertOnly'`
  - `MigrationDialect`：`'mysql' | 'postgres' | 'sqlite'`（从 `ConnectionConfig['type']` 派生）
  - `GeneratedStatement`：`{ sql: string; kind: 'ddl'|'dml'; riskLevel: 'safe'|'caution'|'danger' }`
  - `MigrationPlan`：`{ id, name, source, target, dialect, structureItems[], dataItems?, options }`
  - `MigrationOptions`：`{ useTransaction: 'none'|'perStatement'|'single'; batchSize?: number; strategy: DataStrategy }`
  - `MigrationResult`：`{ success: boolean; applied: number; failed: number; durationMs: number; failedItems?: { index: number; sql: string; error: string }[] }`
  - `SavedMigrationPlan`：`MigrationPlan & { id: string; name: string; createdAt: string; updatedAt: string }`（持久化方案）
  - `TypeMappingWarning`：`{ column, fromType, toType, reason, severity: 'info'|'warn'|'error' }`

- **T5.1.2** IPC 契约扩展 `src/shared/ipc.ts`
  - `migration:diffStructure`：`req: { source, target }` → `res: { items: StructureDiffItem[] }`
  - `migration:diffData`：`req: { source, target, strategy }` → `res: { items: DataDiffItem[]; totalRows }`
  - `migration:generateScript`：`req: { plan: MigrationPlan }` → `res: { statements: GeneratedStatement[]; warnings: TypeMappingWarning[] }`
  - `migration:execute`：`req: { plan, selectedStatements: number[] }` → `res: { success, applied, failed, durationMs }`（内部转 `db:confirmExecute`）
  - `migration:previewRows`：`req: { source, target, strategy, limit }` → 流式/分页预览将受影响的行
  - 持久化方案（D16）：
    - `migration:savePlan`：`req: { name, plan }` → `res: SavedMigrationPlan`
    - `migration:listPlans`：`req: void` → `res: SavedMigrationPlan[]`
    - `migration:getPlan`：`req: { id }` → `res: SavedMigrationPlan | null`
    - `migration:deletePlan`：`req: { id }` → `res: { success }`
  - preload 白名单同步（`src/preload/index.ts`）

- **T5.1.3** 方言 DDL 生成器抽象 `src/main/domain/migration/dialect/`
  - 接口 `DialectDdlGenerator`：
    - `createTable(meta: TableMeta): string`
    - `addColumn(table, column): string`
    - `modifyColumn(table, column, changes): string`
    - `dropColumn(table, columnName): string`
    - `addIndex(table, index) / dropIndex(table, indexName): string`
    - `addForeignKey(table, fk) / dropForeignKey(table, fkName): string`
    - `truncate(table) / deleteAll(table): string`
  - 各驱动一个实现：`mysql-ddl.ts` / `postgres-ddl.ts` / `sqlite-ddl.ts`
  - 工厂 `getDdlGenerator(dialect: MigrationDialect): DialectDdlGenerator`
  - **复用**：各驱动已有类型映射表（如 `postgres.ts` 的 `TYPE_MAPPINGS`），抽取为 `dialect/type-map.ts` 供生成器反向使用

- **T5.1.4** 跨库类型映射器 `src/main/domain/migration/type-mapper.ts`
  - `mapColumnForTarget(column: Column, targetDialect): { column: Column; warnings: TypeMappingWarning[] }`
  - 基于源 `unifiedType` → 目标方言首选类型（含 length/scale 推断）
  - 已知损失点登记到 `warnings`：
    - PG `jsonb`/`json` → SQLite：映射 `TEXT`，警告"无原生 JSON 约束"
    - **enum/枚举类型（MySQL `enum` / PG 自定义枚举）→ 目标任意库：统一降级 `TEXT`/`VARCHAR(n)` + `CHECK (col IN (...))` 约束**，**不建真枚举类型**（简单、可逆、跨库一致；PG 建真枚举需额外 DDL 且反向迁移复杂，P1 再评估）。enumValues 原值保留到列定义，用于生成 CHECK。
    - MySQL `datetime` → SQLite：`TEXT`（ISO8601）
    - PG `serial`/MySQL `auto_increment` → SQLite：`INTEGER PRIMARY KEY AUTOINCREMENT`
    - `binary`/`blob` 跨库长度限制差异
  - **单测**：覆盖 4 库 × 12 种 `unifiedType` 的正向映射 + 8 种损失场景

**产出**：类型完备、方言生成器可独立单测的骨架。

---

### T5.2 结构迁移引擎（批次 B）

**目标**：给定源/目标 `TableMeta`，产出结构 diff 与目标方言 DDL。

**子任务**：

- **T5.2.1** 结构 diff 计算器 `src/main/domain/migration/structure-diff.ts`
  - `diffStructure(source: TableMeta, target: TableMeta): StructureDiffItem[]`
  - 列 diff：按列名 join，判定 add/drop；同名列逐属性比（`dataType` 经 `unifiedType` 归一后比，避免 `varchar(255)` vs `varchar(100)` 误报 modify）
  - "修改"判定阈值：`unifiedType` 变 / `nullable` 变 / `isPrimaryKey` 变 / 长度跨方言等价范围外 → 才算 modify；其余记 `TypeMappingWarning`
  - 索引 diff：按索引名 join（名称在不同库可能不同，提供"按列集合匹配"兜底选项）
  - 外键 diff：按 `(columns, referencesTable)` 元组匹配
  - 目标表不存在 → 整体 `createTable`
  - **单测**：12+ case（新增列、删列、改类型、改可空、加索引、同名索引列序差异、目标表缺失……）

- **T5.2.2** 结构 DDL 脚本生成器 `src/main/domain/migration/structure-script.ts`
  - `generateStructureScript(items: StructureDiffItem[], dialect, options): GeneratedStatement[]`
  - 依赖 T5.1.3 的 `DialectDdlGenerator`
  - 语句排序：先 DROP（外键/索引/列）→ 再 ADD/MODIFY（列）→ 最后 ADD（索引/外键），避免依赖冲突
  - 风险分级：`DROP`/`dropTable`/`truncate` → danger；`modifyColumn` → caution；其余 safe
  - **单测**：每种方言下，给定 diff 产出的 SQL 字符串快照测试

- **T5.2.3** 主进程 handler `src/main/ipc/migration.ts`
  - 注册 `migration:diffStructure`、`migration:generateScript`（结构部分）
  - 源/目标各取 driver → `describeTable` → 调 diff/script
  - 在 `src/main/index.ts` 启动时 `registerMigrationHandlers()`

**产出**：可通过 IPC 跑通"选两张表 → 拿到结构 diff → 生成 DDL 脚本"。

---

### T5.3 数据迁移引擎（批次 C）

**目标**：按 PK 或全量策略产出 DML，支持分批与进度。

**子任务**：

- **T5.3.1** PK 抽取与比对 `src/main/domain/migration/data-diff.ts`
  - `extractPrimaryKeys(meta: TableMeta): string[]`（列名）
  - `streamRowsByPk(driver, meta, { batchSize })`：游标式拉取源/目标行（避免大表全量入内存）
  - `diffData(sourceRows, targetRows, pkColumns, strategy): DataDiffItem[]`
    - incremental：PK 在源不在目标 → insert；在目标不在源 → delete；都在 → 跳过（**不 update**）
    - fullReplace：全部源行 → insert（前面补 truncate/deleteAll）；目标多余 PK → delete
    - insertOnly：仅 insert，不 delete
  - PK 比较需统一类型（如 MySQL `bigint` vs SQLite `INTEGER`，按 `unifiedType==='integer'` 归一数字比较）
  - **单测**：构造内存行集，覆盖三种策略 × PK 新增/删除/共存场景

- **T5.3.2** 数据 DML 生成器 `src/main/domain/migration/data-script.ts`
  - `generateDataScript(items: DataDiffItem[], meta: TableMeta, dialect, options): GeneratedStatement[]`
  - INSERT：值按目标方言转义（字符串引号、二进制 hex/bytea、NULL、布尔字面量差异）
  - 分批：每 `batchSize` 行合并为一条多值 INSERT（MySQL/PG 支持，SQLite 用多 VALUES）
  - 跨库值转换：源 driver 返回的 `CellValue` → 目标方言字面量（复用 T5.1.4 的 `type-mapper` 思路）
  - fullReplace 头部生成 `TRUNCATE`（PG/MySQL）或 `DELETE FROM`（SQLite 无 TRUNCATE 约束回滚）
  - **单测**：快照测试 INSERT/DELETE/TRUNCATE 各方言输出

- **T5.3.3** 大表分批与进度
  - 主进程 `migration:diffData` 支持 `onProgress` 推送（复用 IPC 事件机制，新增 `migration:progress` 事件）
  - 限制单次拉取行数（默认 5000），游标推进
  - 超时保护（复用 `QueryOptions.timeout`）

- **T5.3.4** 主进程 handler 扩展
  - `migration:diffData`、`migration:previewRows`、数据部分 `migration:generateScript`、`migration:execute`

**产出**：数据迁移三种策略可跑通，大表不爆内存。

---

### T5.4 跨库迁移 + 执行 + UI（批次 D）

**目标**：打通异构库组合，落地可视化操作界面，接入 M3 安全执行。

**子任务**：

- **T5.4.1** 跨库集成验证（基于 T5.1-T5.3 已具备能力）
  - 端到端组合矩阵测试（手动 + 冒烟脚本）：
    - MySQL → PG（结构 + 数据）
    - MySQL → SQLite
    - PG → SQLite
    - PG → MySQL（注意 enum/json 反向）
    - 同库同表演进（MySQL→MySQL，等价 schema 工具）
  - 类型映射告警在 UI 显式呈现，用户确认后继续
  - 不支持组合（如涉及 Redis）明确报错并引导

- **T5.4.2** 执行引擎 `src/main/domain/migration/executor.ts`
  - `executeMigration(plan, selectedIndexes, options): Promise<MigrationResult>`
  - **事务安全守卫（D14）**：
    - 入口校验：若 plan 含任何数据迁移项（DML）且 `options.useTransaction === 'none'` → **直接拒绝并报错**，不执行
    - 数据迁移默认 `single`；仅当选中 DML 涉及行数 > 阈值（默认 10w）时允许 UI 切 `perStatement`
    - 结构迁移（纯 DDL）允许 `none`，因多数库 DDL 隐式提交，事务意义有限
  - 事务策略实现：
    - `single`：`BEGIN` → 逐条执行 → 全成功 `COMMIT` / 任一失败 `ROLLBACK`，返回已回滚（applied=0）
    - `perStatement`：每批 `BEGIN`/`COMMIT`，单批失败即中止后续，已提交批不可回滚（结果中标记 failedItems）
  - 每条语句执行前过 M3 `db:confirmExecute`（危险语句强制确认）
  - 审计：每次执行写审计日志（源/目标连接、表、行数、耗时、状态、事务策略）
  - **单测**：mock driver，覆盖 single 成功/失败回滚、perStatement 部分成功、none+DML 被拒绝三条路径

- **T5.4.3** 渲染层 `src/renderer/components/migration/`
  - `MigrationWizard.tsx`：向导（选源 → 选目标 → 选维度 → 预览 → 执行）
  - `SourceTargetPicker.tsx`：双连接 + schema + 表选择器（复用现有连接/表树组件）
  - `StructureDiffPanel.tsx`：diff 列表（按 add/modify/drop 分组，可勾选），每项展示"源 vs 目标"对比
  - `DataDiffPanel.tsx`：策略选择 + 受影响行数 + 预览前 N 行
  - `ScriptPreview.tsx`：生成的 SQL（目标方言），可编辑、可导出 `.sql`，按风险着色
  - `TypeWarningList.tsx`：跨库类型映射告警
  - 状态管理 `src/renderer/store/migration.ts`（pinia/zustand 风格，参考现有 store）
  - API 封装 `src/renderer/api/migration.ts`

- **T5.4.4** 迁移方案持久化（D16，必做）
  - IPC：`migration:savePlan` / `listPlans` / `getPlan` / `deletePlan`（T5.1.2 已声明）
  - 存储层 `src/main/infra/storage/migration-plan-dao.ts`：本地 SQLite，复用现有 DAO 模式（参考 `connections-dao.ts`）
  - 表结构 `migration_plans`：`{ id, name, source_conn, target_conn, plan_json, created_at, updated_at }`
    - `plan_json` 存 `MigrationPlan` 全量（源/目标连接引用、表清单、维度、options、warnings）
    - **不存任何数据行**，仅存配置
  - 渲染层：向导内「保存方案」入口 + 独立「迁移方案」列表页（加载/复用/删除/重命名）
  - 复用时重新 diff（源/目标结构可能已变），不复用历史 diff 结果

- **T5.4.5** 入口与权限
  - 主界面入口（DatabaseDetail 或导航新增"迁移"Tab）
  - 跨连接操作需两端连接均处于已连接状态，否则引导连接

**产出**：完整可用的迁移功能，含跨库、预览、执行、审计。

---

## 3. 依赖与里程碑

```
M3 安全层（已就绪：confirmExecute / 审计 / 权限）
   └── T5.4.2 执行引擎复用

M1/M2 驱动抽象（已就绪：TableMeta / UnifiedType / 4 驱动）
   └── T5.1.3 方言生成器复用类型映射表
   └── T5.3.1 数据 diff 复用 driver.executeQuery

批次依赖：
A (T5.1)  ──→  B (T5.2)  ──┐
              C (T5.3)  ──┼──→  D (T5.4)
                            │
B、C 可并行（不同人/不同分支）
```

| 批次 | 工作量预估                             | 可并行    | 阻塞下游 |
| ---- | -------------------------------------- | --------- | -------- |
| A    | 2-3 天                                 | -         | B/C/D    |
| B    | 3-4 天                                 | 与 C 并行 | D        |
| C    | 3-4 天                                 | 与 B 并行 | D        |
| D    | 4-5 天                                 | -         | -        |
| 合计 | 约 3 周（1 人）/ 2 周（2 人 B/C 并行） |           |          |

---

## 4. 风险与决策点

| #   | 风险/决策                                                               | 应对                                                                                       |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R1  | 跨库类型损失不可逆（如 PG `jsonb` 索引能力丢失）                        | UI 强提示，需用户二次确认；记录到迁移方案的 warnings，可回溯                               |
| R2  | 索引/外键在不同库命名规则不同，diff 可能误报                            | 提供"按列集合匹配"兜底；首版以名称为主，列匹配为可选开关                                   |
| R3  | 大表数据迁移内存/锁表风险                                               | 强制分批 + 游标；fullReplace 默认建议用 DELETE+INSERT 而非 TRUNCATE（可回滚）              |
| R4  | 自增列跨库语义差异（MySQL AUTO_INCREMENT vs PG SERIAL vs SQLite ROWID） | 迁移时显式列出不带自增属性的数据列，由用户决定是否保留源 ID                                |
| R5  | 时区/时间精度跨库（MySQL datetime vs PG timestamptz vs SQLite text）    | 统一转 ISO8601 字符串传输；告警精度损失                                                    |
| R6  | 产品边界"不做 update"可能被用户反复提需求                               | 文档与 UI 明确标注，引导"全量替换"或"删后重建"；P1 再评估                                  |
| D1  | 跨库 enum：PG 建真枚举 vs 降级 TEXT+CHECK？                             | **已定 ✅ 统一降级 `TEXT`/`VARCHAR(n)` + `CHECK`**（简单、可逆、跨库一致；不建真枚举）     |
| D2  | 数据迁移默认是否开事务？                                                | **已定 ✅ 强制事务**：默认 `single`，仅大表（>10w 行）允许 `perStatement`，**禁止 `none`** |
| D3  | 迁移方案是否持久化？                                                    | **已定 ✅ 必做**：本地 SQLite 持久化（`migration_plans` 表），T5.4.4 落地                  |

---

## 5. 非目标（明确不做）

- ❌ 行级 UPDATE 迁移（产品边界，见 1.3）
- ❌ 反向同步（目标 → 源）
- ❌ 视图 / 存储过程 / 触发器 / 函数迁移（P1）
- ❌ 实时增量同步 / CDC（P2）
- ❌ Redis 迁移（KV 模型与关系模型差异大，P1 专项评估）
- ❌ 自动 schema 重命名检测（列改名识别，P1）
- ❌ 迁移回滚脚本自动生成（P1，配合事务回滚已足够）

---

## 6. 测试矩阵（关键覆盖）

| 场景                             | 维度      | 单测 | 集成 | 手动 |
| -------------------------------- | --------- | ---- | ---- | ---- |
| 同库新增列                       | 结构      | ✅   | ✅   | ✅   |
| 同库改列类型                     | 结构      | ✅   | ✅   | ✅   |
| 跨库 MySQL→PG 全表新建           | 结构+数据 | -    | ✅   | ✅   |
| 跨库 PG→SQLite 类型降级告警      | 结构      | ✅   | -    | ✅   |
| 数据增量（PK 新增+删除）         | 数据      | ✅   | ✅   | ✅   |
| 数据全量替换                     | 数据      | ✅   | ✅   | ✅   |
| 大表分批（10w 行）               | 数据      | -    | ✅   | ✅   |
| single 事务中途失败回滚          | 执行      | ✅   | ✅   | ✅   |
| perStatement 部分成功中止        | 执行      | ✅   | ✅   | ✅   |
| DML + useTransaction=none 被拒绝 | 执行      | ✅   | -    | ✅   |
| enum 跨库降级 TEXT+CHECK         | 结构      | ✅   | ✅   | ✅   |
| 危险语句二次确认                 | 安全      | -    | -    | ✅   |
| 迁移方案保存/列表/复用/删除      | 持久化    | ✅   | ✅   | ✅   |
