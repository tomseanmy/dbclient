/**
 * 数据 DML 脚本生成器
 *
 * 将 DataDiffItem[] 转成目标方言的 INSERT/DELETE 语句：
 * - INSERT：每 batchSize 行合并为一条多值 INSERT（MySQL/PG/SQLite 均支持 VALUES (...),(...)）
 * - DELETE：逐行（或按 PK 列表批量），保守起见逐条 DELETE WHERE pk=?
 * - fullReplace：头部生成清空语句（MySQL/PG: TRUNCATE；SQLite: DELETE FROM，事务安全 D2）
 *
 * 跨库值转换：复用方言生成器的 literal()，自动处理字符串/数字/布尔/二进制/JSON。
 */
import type { Column, TableMeta } from '@shared/types/database'
import type {
  DataDiffItem,
  DataStrategy,
  GeneratedStatement,
  MigrationDialect,
} from '@shared/types/migration'
import { getDialectGenerator } from './dialect'
import type { DialectGenerator } from './dialect'
import type { Row } from './data-diff'

/** 生成数据脚本所需的上下文 */
export interface DataScriptContext {
  /** 目标表结构（含列定义，决定 INSERT 列序与值转换） */
  targetMeta: TableMeta
  /** 目标方言 */
  dialect: MigrationDialect
  /** 数据迁移策略 */
  strategy: DataStrategy
  /** 每条 INSERT 合并的行数（默认 500） */
  batchSize?: number
  /** 目标表名（缺省取 targetMeta.name） */
  tableName?: string
}

/** 默认分批大小 */
const DEFAULT_BATCH = 500

/**
 * 生成数据迁移脚本。
 *
 * 顺序：fullReplace 时先 truncate/clear → inserts（分批）→ deletes
 */
export function generateDataScript(
  ctx: DataScriptContext,
  items: DataDiffItem[],
): GeneratedStatement[] {
  const gen = getDialectGenerator(ctx.dialect)
  const table = ctx.tableName ?? ctx.targetMeta.name
  const batch = ctx.batchSize ?? DEFAULT_BATCH
  const stmts: GeneratedStatement[] = []

  // fullReplace 头部清空（D2：SQLite 用 DELETE，可事务回滚）
  if (ctx.strategy === 'fullReplace') {
    stmts.push({ sql: gen.truncate(table), kind: 'dml', riskLevel: 'danger' })
  }

  // 列序：按 targetMeta.columns 顺序
  const columns = ctx.targetMeta.columns
  const colNames = columns.map((c) => c.name)

  // 分组：inserts / deletes
  const inserts = items.filter(
    (i): i is Extract<DataDiffItem, { kind: 'insert' }> => i.kind === 'insert',
  )
  const deletes = items.filter(
    (i): i is Extract<DataDiffItem, { kind: 'delete' }> => i.kind === 'delete',
  )

  // INSERT 分批
  for (let i = 0; i < inserts.length; i += batch) {
    const chunk = inserts.slice(i, i + batch)
    const sql = buildBatchInsert(
      gen,
      table,
      colNames,
      chunk.map((c) => c.row),
      columns,
    )
    stmts.push({ sql, kind: 'dml', riskLevel: 'caution' })
  }

  // DELETE（逐 PK，保守）
  const pkCols = columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
  for (const d of deletes) {
    const sql = buildDelete(gen, table, pkCols, d.pk)
    stmts.push({ sql, kind: 'dml', riskLevel: 'danger' })
  }

  return stmts
}

/** 构造多值 INSERT：INSERT INTO t (c1,c2) VALUES (v1,v2),(v3,v4) */
function buildBatchInsert(
  gen: DialectGenerator,
  table: string,
  colNames: string[],
  rows: Row[],
  columns: Column[],
): string {
  const colList = colNames.map((c) => gen.quoteIdentifier(c)).join(', ')
  const valueRows = rows.map((row) => {
    const vals = colNames.map((name) => {
      const col = columns.find((c) => c.name === name)
      return rowToLiteral(gen, row[name], col)
    })
    return `(${vals.join(', ')})`
  })
  return `INSERT INTO ${gen.quoteIdentifier(table)} (${colList}) VALUES\n  ${valueRows.join(',\n  ')}`
}

/** 行值 → 方言字面量；JSON 类型对象需 JSON.stringify */
function rowToLiteral(gen: DialectGenerator, value: unknown, col: Column | undefined): string {
  // JSON 类型：对象/数组转字符串字面量
  if (col?.unifiedType === 'json' && value !== null && typeof value === 'object') {
    return gen.literal(JSON.stringify(value))
  }
  return gen.literal(value)
}

/** 构造 DELETE：DELETE FROM t WHERE pk1=v1 AND pk2=v2 */
function buildDelete(
  gen: DialectGenerator,
  table: string,
  pkCols: string[],
  pkValues: unknown[],
): string {
  const conditions = pkCols.map((name, idx) => {
    const col = pkCols[idx]!
    const val = pkValues[idx]
    if (val === null || val === undefined) {
      return `${gen.quoteIdentifier(col!)} IS NULL`
    }
    return `${gen.quoteIdentifier(name)} = ${gen.literal(val)}`
  })
  return `DELETE FROM ${gen.quoteIdentifier(table)} WHERE ${conditions.join(' AND ')}`
}
