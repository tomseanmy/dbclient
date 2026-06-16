/**
 * 行拉取器
 *
 * 分页（OFFSET/LIMIT）从连接拉取表数据，避免大表全量入内存。
 * 支持进度回调（每批回调一次），供 IPC handler 推送 migration:progress 事件。
 *
 * 注意：OFFSET 在超大表上性能递减（深翻页问题）。M5 首版用 OFFSET 简单实现，
 * P1 可优化为游标分页（按 PK WHERE pk > last）。
 */
import type { DbDriver } from '../db/driver'
import type { Row } from './data-diff'

/** 进度回调 */
export interface FetchProgress {
  /** 已拉取行数 */
  processed: number
  /** 预估总行数（来自 TableMeta.estimatedRows，可能不准） */
  total: number
}

/** 分页拉取全部行 */
export async function fetchAllRows(
  driver: DbDriver,
  table: string,
  schema: string | undefined,
  options: { batchSize?: number; total?: number; onProgress?: (p: FetchProgress) => void } = {},
): Promise<Row[]> {
  const batchSize = options.batchSize ?? 5000
  const total = options.total
  const allRows: Row[] = []
  let offset = 0

  // 表引用（含 schema）
  const ref = schema ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table)

  while (true) {
    const sql = `SELECT * FROM ${ref} LIMIT ${batchSize} OFFSET ${offset}`
    const result = await driver.executeQuery(sql, { limit: batchSize })
    allRows.push(...(result.rows as Row[]))
    options.onProgress?.({ processed: allRows.length, total: total ?? allRows.length })

    // 不足一批 → 已到末尾
    if (result.rows.length < batchSize) break
    offset += batchSize

    // 安全阀：避免无 PK 表异常空结果导致死循环
    if (result.rows.length === 0) break
  }

  return allRows
}

/** 标识符引用（保守用双引号，多数方言兼容；MySQL 反引号更准但此处仅读，双引号在 MySQL 下需 ANSI_QUOTES） */
function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * 仅拉取 PK 列（用于轻量比对，减少内存与网络传输）。
 * 当只需要判断 insert/delete 而非完整行时使用。
 */
export async function fetchPkOnly(
  driver: DbDriver,
  table: string,
  schema: string | undefined,
  pkColumns: string[],
  options: { batchSize?: number; total?: number; onProgress?: (p: FetchProgress) => void } = {},
): Promise<Row[]> {
  const batchSize = options.batchSize ?? 5000
  const total = options.total
  const allRows: Row[] = []
  let offset = 0

  const colList = pkColumns.map(quoteIdent).join(', ')
  const ref = schema ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table)

  while (true) {
    const sql = `SELECT ${colList} FROM ${ref} LIMIT ${batchSize} OFFSET ${offset}`
    const result = await driver.executeQuery(sql, { limit: batchSize })
    allRows.push(...(result.rows as Row[]))
    options.onProgress?.({ processed: allRows.length, total: total ?? allRows.length })
    if (result.rows.length < batchSize) break
    offset += batchSize
    if (result.rows.length === 0) break
  }

  return allRows
}
