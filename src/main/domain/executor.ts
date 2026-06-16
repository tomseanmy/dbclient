/**
 * SQL 统一执行入口
 *
 * 三条路径（GUI / AI / MCP）的唯一入口。
 * M3：执行前插入安全检查层（环境权限 + 危险 SQL 拦截）。
 *
 * 流程：
 *   1. 安全分析（analyzer）
 *   2. 权限判定（policy）
 *   3a. deny → 记审计，抛 PermissionDeniedError
 *   3b. confirm_required → 记审计，抛 ConfirmationRequiredError（前端弹窗）
 *   3c. allow → 执行 + 记审计 + 记历史
 */
import type { QueryResult } from '@shared/types/database'
import type { QueryOptions } from './db/driver'
import { getDriver, getRedisDriver } from './db/manager'
import { analyzeSqlBatch } from './security/analyzer'
import { decide, isElevated } from './security/policy'
import { sqlHistoryDao } from '@main/infra/storage/sql-history-dao'
import { auditLogDao } from '@main/infra/storage/audit-log-dao'
import { invalidateSchemaCache } from './privacy/schema-context'
import { connectionsDao } from '@main/infra/storage/connections-dao'
import { logger } from '@main/infra/logger'
import type { SecurityCheckResult } from '@shared/types/security'

/** 执行上下文 */
export interface ExecuteContext {
  connectionId: string
  source: 'gui' | 'ai' | 'mcp'
}

/** 执行结果 */
export type ExecuteOutcome =
  | { kind: 'query'; result: QueryResult }
  | { kind: 'statement'; rowsAffected: number }

/** 需要确认的错误（前端据此弹窗） */
export class ConfirmationRequiredError extends Error {
  constructor(
    public readonly checkResult: SecurityCheckResult,
    public readonly sql: string,
  ) {
    super(checkResult.reason)
    this.name = 'ConfirmationRequiredError'
  }
}

/** 权限拒绝错误 */
export class PermissionDeniedError extends Error {
  constructor(
    public readonly checkResult: SecurityCheckResult,
    public readonly sql: string,
  ) {
    super(checkResult.reason)
    this.name = 'PermissionDeniedError'
  }
}

/** 判断 SQL 是否为查询（返回行） */
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

/**
 * 执行安全检查（不执行 SQL）。
 * 用于「预检」——前端先调此接口，根据结果决定是否弹确认。
 */
export function checkSql(ctx: ExecuteContext, sql: string): SecurityCheckResult {
  const conn = connectionsDao.get(ctx.connectionId)
  const environment = conn?.environment ?? 'dev'
  const elevated = isElevated(ctx.connectionId)

  const analysis = analyzeSqlBatch(sql)
  const policyResult = decide({ environment, analysis, elevated })

  const requireKeywordConfirm =
    analysis.dangerLevel === 'dangerous' &&
    analysis.reasons.some((r) => r.includes('DROP') || r.includes('TRUNCATE'))

  // 提取需要确认的关键词
  let confirmKeyword: string | undefined
  if (requireKeywordConfirm) {
    const match = analysis.reasons.find((r) => r.includes('DROP') || r.includes('TRUNCATE'))
    confirmKeyword = match?.includes('DROP') ? 'DROP' : 'TRUNCATE'
  }

  return {
    allowed: policyResult.decision === 'allow',
    confirmRequired: policyResult.decision === 'confirm_required',
    denied: policyResult.decision === 'deny',
    reason: policyResult.reason,
    analysis: {
      type: analysis.type,
      dangerLevel: analysis.dangerLevel,
      reasons: analysis.reasons,
      tables: analysis.tables,
    },
    riskLevel: analysis.dangerLevel,
    requireKeywordConfirm,
    confirmKeyword,
    canElevate: environment === 'prod' && !elevated,
  }
}

/**
 * 执行 SQL（经安全检查）。
 * @param confirmed 用户已确认（对于 confirm_required 的操作）
 */
export async function executeSql(
  ctx: ExecuteContext,
  sql: string,
  opts?: QueryOptions,
  confirmed = false,
): Promise<ExecuteOutcome> {
  const start = Date.now()
  const check = checkSql(ctx, sql)

  // 记录审计（无论结果如何）
  const recordAudit = (decision: 'allow' | 'deny' | 'confirm_required') => {
    auditLogDao.record({
      source: ctx.source,
      connectionId: ctx.connectionId,
      action: check.analysis.type,
      detail: sql.slice(0, 500),
      decision,
      riskLevel: check.riskLevel,
    })
  }

  // 权限拒绝
  if (check.denied) {
    recordAudit('deny')
    throw new PermissionDeniedError(check, sql)
  }

  // 需要确认但未确认
  if (check.confirmRequired && !confirmed) {
    recordAudit('confirm_required')
    throw new ConfirmationRequiredError(check, sql)
  }

  // 允许执行
  recordAudit('allow')

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

    // 非 query 语句（DDL/DML）会改变结构或数据，失效 schema 缓存避免 AI 用到旧结构
    if (!isQuerySql(sql)) {
      invalidateSchemaCache(ctx.connectionId)
    }

    return outcome
  } catch (err) {
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

/** Redis 概览（绕过 SQL 执行入口） */
export async function getRedisOverviewData(connectionId: string) {
  return getRedisDriver(connectionId).getRedisOverview()
}
