/**
 * 安全相关共享类型（主进程与渲染进程共享）
 */
/** 安全检查结果（传给前端用于确认弹窗） */
export interface SecurityCheckResult {
  /** 是否允许直接执行 */
  allowed: boolean
  /** 是否需要确认 */
  confirmRequired: boolean
  /** 是否被拒绝 */
  denied: boolean
  /** 拒绝/确认原因 */
  reason: string
  /** SQL 分析摘要 */
  analysis: {
    type: string
    dangerLevel: string
    reasons: string[]
    tables: string[]
  }
  /** 风险级别（用于审计与 UI 标识） */
  riskLevel: string
  /** 是否需要输入关键词确认（最高危） */
  requireKeywordConfirm: boolean
  /** 需要输入的关键词（如 DROP） */
  confirmKeyword?: string
  /** 是否可通过临时提权绕过 */
  canElevate: boolean
}

/** 提权状态 */
export interface ElevationStatus {
  elevated: boolean
  /** 剩余毫秒 */
  remainingMs: number
  /** 过期时间戳 */
  expiresAt: number | null
}

/** 审计日志记录（给前端展示用） */
export interface AuditLogItem {
  id: number
  source: string
  connectionId: string | null
  action: string
  detail: string | null
  decision: string
  rowsAffected: number | null
  riskLevel: string | null
  createdAt: string
}
