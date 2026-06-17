/**
 * 权限判定器
 *
 * 结合环境标签 + SQL 分析结果 + 提权状态，给出最终 Decision。
 * 实现 PRD M9 的环境分级权限矩阵。
 */
import type { Environment } from '@shared/types/connection'
import type { SqlAnalysis } from './analyzer'
import { SECURITY_REASON } from '@shared/i18n/keys'

/** 权限判定结果 */
export type Decision = 'allow' | 'deny' | 'confirm_required'

/** 判定上下文 */
export interface PolicyContext {
  /** 连接的环境标签 */
  environment: Environment
  /** SQL 分析结果 */
  analysis: SqlAnalysis
  /** 是否已临时提权（prod 连接的会话级提权） */
  elevated: boolean
}

/** 判定输出 */
export interface PolicyResult {
  decision: Decision
  /** 判定原因（用于审计与用户提示） */
  reason: string
}

/**
 * 环境权限矩阵：
 *
 *          SELECT   DML      DDL      危险语句
 * dev      allow    allow    allow    confirm
 * staging  allow    allow    confirm  confirm
 * prod     allow    deny*    deny     deny
 *   (* prod 提权后：allow/confirm/confirm)
 */
export function decide(ctx: PolicyContext): PolicyResult {
  const { environment, analysis, elevated } = ctx
  const { dangerLevel, type } = analysis

  // 只读查询：任何环境都放行
  if (dangerLevel === 'safe' && type === 'query') {
    return { decision: 'allow', reason: SECURITY_REASON.readonly }
  }

  // 危险语句：任何环境都需确认
  if (dangerLevel === 'dangerous') {
    if (environment === 'dev') {
      return { decision: 'confirm_required', reason: SECURITY_REASON.dangerousNeedConfirm }
    }
    if (environment === 'staging') {
      return { decision: 'confirm_required', reason: SECURITY_REASON.dangerousNeedConfirm }
    }
    // prod：即使提权，危险操作仍需确认
    if (elevated) {
      return {
        decision: 'confirm_required',
        reason: SECURITY_REASON.dangerousNeedConfirmProdElevated,
      }
    }
    return { decision: 'deny', reason: SECURITY_REASON.prodDangerousDenied }
  }

  // 普通写操作（dangerLevel === 'write'）
  switch (environment) {
    case 'dev':
      return { decision: 'allow', reason: SECURITY_REASON.devWriteAllowed }
    case 'staging':
      if (type === 'ddl') {
        return { decision: 'confirm_required', reason: SECURITY_REASON.stagingDdlNeedConfirm }
      }
      return { decision: 'allow', reason: SECURITY_REASON.stagingDmlAllowed }
    case 'prod':
      if (elevated) {
        if (type === 'ddl') {
          return {
            decision: 'confirm_required',
            reason: SECURITY_REASON.prodElevatedDdlNeedConfirm,
          }
        }
        return { decision: 'allow', reason: SECURITY_REASON.prodElevatedWriteAllowed }
      }
      return { decision: 'deny', reason: SECURITY_REASON.prodWriteDenied }
  }
}

/** 临时提权状态管理（会话级，按连接 ID） */
const elevationState = new Map<string, { expiresAt: number; source: string }>()

/** 默认提权时长：30 分钟 */
const DEFAULT_ELEVATE_DURATION = 30 * 60 * 1000

/** 临时提权 */
export function elevate(
  connectionId: string,
  source: string,
  durationMs: number = DEFAULT_ELEVATE_DURATION,
): { expiresAt: number } {
  const expiresAt = Date.now() + durationMs
  elevationState.set(connectionId, { expiresAt, source })
  return { expiresAt }
}

/** 撤销提权 */
export function revokeElevation(connectionId: string): void {
  elevationState.delete(connectionId)
}

/** 检查是否已提权（自动过期） */
export function isElevated(connectionId: string): boolean {
  const state = elevationState.get(connectionId)
  if (!state) return false
  if (Date.now() > state.expiresAt) {
    elevationState.delete(connectionId)
    return false
  }
  return true
}

/** 获取提权剩余时间（毫秒），未提权返回 0 */
export function elevationRemaining(connectionId: string): number {
  const state = elevationState.get(connectionId)
  if (!state) return 0
  const remaining = state.expiresAt - Date.now()
  if (remaining <= 0) {
    elevationState.delete(connectionId)
    return 0
  }
  return remaining
}
