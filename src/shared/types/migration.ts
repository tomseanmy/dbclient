/**
 * 数据库迁移相关类型（主进程与渲染进程共享）
 *
 * 两维度迁移：
 * ① 结构迁移：源/目标 TableMeta diff → 目标方言 DDL（ADD/MODIFY/DROP）
 * ② 数据迁移：源/目标行按 PK diff → 目标方言 DML（INSERT/DELETE，不做 UPDATE）
 * ③ 跨库迁移：基于 UnifiedType 统一 IR，源端任意库 → 目标任意方言
 *
 * 设计依据见 docs/M5-migration-tasks.md。
 */
import type { CellValue, Column, ForeignKey, Index, TableMeta } from './database'
import type { DbType } from './connection'

/** 迁移源 / 目标的定位（连接 + schema + 表） */
export interface MigrationTarget {
  connectionId: string
  schema?: string
  table: string
}

// ===== 结构迁移 diff 项（判别联合）=====

export type StructureDiffItem =
  | { kind: 'createTable'; tableMeta: TableMeta }
  | { kind: 'dropTable'; tableName: string }
  | { kind: 'addColumn'; column: Column }
  | { kind: 'modifyColumn'; column: Column; changes: Partial<Column> }
  | { kind: 'dropColumn'; columnName: string }
  | { kind: 'addIndex'; index: Index }
  | { kind: 'dropIndex'; indexName: string }
  | { kind: 'addForeignKey'; fk: ForeignKey }
  | { kind: 'dropForeignKey'; fkName: string }

// ===== 数据迁移 =====

/** 数据迁移策略（D3 决策：不做 UPDATE） */
export type DataStrategy = 'incremental' | 'fullReplace' | 'insertOnly'

/** 单条数据 diff 项（仅 INSERT / DELETE，无 UPDATE） */
export type DataDiffItem =
  | { kind: 'insert'; pk: CellValue[]; row: Record<string, CellValue> }
  | { kind: 'delete'; pk: CellValue[] }

// ===== 事务策略（D2 决策：数据迁移强制事务）=====

export type TransactionStrategy = 'none' | 'perStatement' | 'single'

// ===== 方言 =====

/** 迁移目标方言（从 DbType 派生，Redis 不参与关系迁移） */
export type MigrationDialect = Extract<DbType, 'mysql' | 'postgres' | 'sqlite'>

// ===== 类型映射告警 =====

export type WarningSeverity = 'info' | 'warn' | 'error'

/** 跨库类型映射的损失点告警（D1 决策：enum 降级 TEXT+CHECK） */
export interface TypeMappingWarning {
  /** 受影响的列名 */
  column: string
  /** 源原始类型 */
  fromType: string
  /** 目标方言类型 */
  toType: string
  /** 告警原因 */
  reason: string
  severity: WarningSeverity
}

// ===== 迁移选项与方案 =====

export interface MigrationOptions {
  /** 事务策略；数据迁移强制 'single' 或 'perStatement'，'none' 对含 DML 的方案被拒绝 */
  useTransaction: TransactionStrategy
  /** 数据迁移分批行数（默认 5000） */
  batchSize?: number
  /** 数据迁移策略 */
  strategy: DataStrategy
}

/** 生成的单条语句 */
export interface GeneratedStatement {
  /** SQL 文本（目标方言） */
  sql: string
  /** DDL 还是 DML */
  kind: 'ddl' | 'dml'
  /** 风险等级：DROP/TRUNCATE=danger，MODIFY=caution，其余 safe */
  riskLevel: 'safe' | 'caution' | 'danger'
}

/** 迁移方案（一次迁移任务的完整配置，可持久化） */
export interface MigrationPlan {
  /** 源端定位 */
  source: MigrationTarget
  /** 目标端定位 */
  target: MigrationTarget
  /** 目标方言（决定 DDL/DML 生成） */
  dialect: MigrationDialect
  /** 结构 diff 项（可空，纯数据迁移时为空） */
  structureItems: StructureDiffItem[]
  /** 数据 diff 项（可空，纯结构迁移时为空） */
  dataItems?: DataDiffItem[]
  /** 迁移选项 */
  options: MigrationOptions
  /** 跨库类型映射告警（生成脚本时填充） */
  warnings?: TypeMappingWarning[]
}

// ===== 持久化（D3 决策：必做）=====

/** 已持久化的迁移方案（带 id 与时间戳） */
export interface SavedMigrationPlan extends MigrationPlan {
  id: string
  /** 方案名称（用户可读） */
  name: string
  createdAt: string
  updatedAt: string
}

/** 新建/更新方案的输入（更新时携带 id，新建时省略） */
export type SavedMigrationPlanInput = MigrationPlan & { name: string; id?: string }

// ===== 执行结果 =====

/** 单条失败项详情 */
export interface MigrationFailedItem {
  /** 在 statements 中的下标 */
  index: number
  sql: string
  error: string
}

/** 迁移执行结果 */
export interface MigrationResult {
  success: boolean
  /** 成功执行的语句数 */
  applied: number
  /** 失败的语句数 */
  failed: number
  /** 耗时（毫秒） */
  durationMs: number
  /** 失败项明细（perStatement 模式下可能部分成功） */
  failedItems?: MigrationFailedItem[]
}
