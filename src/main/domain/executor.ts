/**
 * SQL 统一执行入口
 *
 * 这是「三条执行路径」（GUI / AI / MCP）的安全不变量。
 * M2 版本：执行 SQL + 记录历史。
 * M3 版本会在执行前插入：权限判定 + 危险 SQL 拦截 + 影响行数预估。
 *
 * 所有路径都必须经过此入口，确保审计日志完整。
 */
import type { QueryResult } from '@shared/types/database'
import type { QueryOptions } from './db/driver'
import { getDriver, getRedisDriver } from './db/manager'
import { sqlHistoryDao } from '@main/infra/storage/sql-history-dao'
import { logger } from '@main/infra/logger'

/** 执行上下文：标识调用来源与目标连接 */
export interface ExecuteContext {
  connectionId: string
  /** 调用来源（决定审计记录与未来权限策略） */
  source: 'gui' | 'ai' | 'mcp'
}

/** 执行结果：查询返回 QueryResult，语句返回影响行数 */
export type ExecuteOutcome =
  | { kind: 'query'; result: QueryResult }
  | { kind: 'statement'; rowsAffected: number }

/**
 * 判断 SQL 是查询（返回行）还是语句（返回影响行数）。
 * 简单启发式：以 SELECT/WITH/EXPLAIN/SHOW/DESCRIBE 开头为查询。
 */
function isQuerySql(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase()
  return (
    trimmed.startsWith('SELECT') ||
    trimmed.startsWith('WITH') ||
    trimmed.startsWith('EXPLAIN') ||
    trimmed.startsWith('SHOW') ||
    trimmed.startsWith('DESCRIBE') ||
    trimmed.startsWith('PRAGMA')
  )
}

/** 执行 SQL 的统一入口 */
export async function executeSql(
  ctx: ExecuteContext,
  sql: string,
  opts?: QueryOptions,
): Promise<ExecuteOutcome> {
  const start = Date.now()
  const driver = getDriver(ctx.connectionId)

  try {
    let outcome: ExecuteOutcome
    if (isQuerySql(sql)) {
      const result = await driver.executeQuery(sql, opts)
      outcome = { kind: 'query', result }
    } else {
      const { rowsAffected } = await driver.executeStatement(sql, opts)
      outcome = { kind: 'statement', rowsAffected }
    }

    // 记录成功历史
    const durationMs = Date.now() - start
    sqlHistoryDao.record({
      connectionId: ctx.connectionId,
      sqlText: sql,
      status: 'success',
      durationMs,
      rowsAffected: outcome.kind === 'statement' ? outcome.rowsAffected : outcome.result.rowCount,
      errorMessage: null,
      source: ctx.source,
    })

    return outcome
  } catch (err) {
    // 记录失败历史
    const durationMs = Date.now() - start
    const errorMessage = err instanceof Error ? err.message : String(err)
    sqlHistoryDao.record({
      connectionId: ctx.connectionId,
      sqlText: sql,
      status: 'error',
      durationMs,
      rowsAffected: null,
      errorMessage,
      source: ctx.source,
    })
    logger.warn('SQL 执行失败', { sql: sql.slice(0, 100), error: errorMessage })
    throw err
  }
}

/** 获取 Redis 概览（Redis 专属，绕过 SQL 执行入口） */
export async function getRedisOverviewData(connectionId: string) {
  return getRedisDriver(connectionId).getRedisOverview()
}
