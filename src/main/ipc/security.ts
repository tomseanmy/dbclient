/**
 * security:* / connection:elevate / audit:* IPC handler
 */
import { registerHandler } from './registry'
import { checkSql, executeSql } from '@main/domain/executor'
import {
  elevate,
  revokeElevation,
  isElevated,
  elevationRemaining,
} from '@main/domain/security/policy'
import { auditLogDao } from '@main/infra/storage/audit-log-dao'
import { logger } from '@main/infra/logger'
import { tMain } from '@main/i18n'

export function registerSecurityHandlers(): void {
  // 预检：检查 SQL 安全性（不执行）
  registerHandler('db:checkSql', (_event, { connectionId, sql }) => {
    return checkSql({ connectionId, source: 'gui' }, sql)
  })

  // 确认后执行（用户已确认）
  registerHandler('db:confirmExecute', async (_event, { connectionId, sql, confirmedKeyword }) => {
    const check = checkSql({ connectionId, source: 'gui' }, sql)

    if (check.requireKeywordConfirm) {
      if (confirmedKeyword !== check.confirmKeyword) {
        const kw = check.confirmKeyword ?? 'CONFIRM'
        throw new Error(tMain('errors.security.keywordMismatch', { keyword: kw }))
      }
    }

    const outcome = await executeSql({ connectionId, source: 'gui' }, sql, undefined, true)
    if (outcome.kind === 'query') return outcome.result
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: 0,
      message: tMain('errors.db.rowsAffected', { count: outcome.rowsAffected }),
    }
  })

  // 临时提权
  registerHandler('connection:elevate', (_event, { connectionId }) => {
    logger.info('临时提权', { connectionId })
    const result = elevate(connectionId, 'gui')
    return {
      elevated: true,
      remainingMs: 30 * 60 * 1000,
      expiresAt: result.expiresAt,
    }
  })

  // 撤销提权
  registerHandler('connection:revokeElevation', (_event, { connectionId }) => {
    revokeElevation(connectionId)
    return { success: true }
  })

  // 查询提权状态
  registerHandler('connection:getElevation', (_event, { connectionId }) => {
    const elevated = isElevated(connectionId)
    const remaining = elevationRemaining(connectionId)
    return {
      elevated,
      remainingMs: remaining,
      expiresAt: elevated ? Date.now() + remaining : null,
    }
  })

  // 审计日志
  registerHandler('audit:list', (_event, { connectionId, limit }) => {
    return auditLogDao.list(connectionId, limit)
  })

  registerHandler('audit:search', (_event, { keyword, limit }) => {
    return auditLogDao.search(keyword, limit)
  })

  registerHandler('audit:clear', (_event, { connectionId }) => {
    auditLogDao.clear(connectionId)
    return { success: true }
  })
}
