/**
 * 审计日志 DAO
 *
 * 记录所有权限判定与写操作，可追溯。
 * 基于 M0 已建的 audit_log 表。
 */
import { getDb } from './db'

export interface AuditLogRecord {
  id: number
  source: 'gui' | 'ai' | 'mcp'
  connectionId: string | null
  action: string
  detail: string | null
  decision: 'allow' | 'deny' | 'confirm_required'
  rowsAffected: number | null
  riskLevel: string | null
  createdAt: string
}

interface AuditLogRow {
  id: number
  source: string
  connection_id: string | null
  action: string
  detail: string | null
  decision: string
  rows_affected: number | null
  risk_level: string | null
  created_at: string
}

function rowToRecord(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    source: row.source as AuditLogRecord['source'],
    connectionId: row.connection_id,
    action: row.action,
    detail: row.detail,
    decision: row.decision as AuditLogRecord['decision'],
    rowsAffected: row.rows_affected,
    riskLevel: row.risk_level,
    createdAt: row.created_at,
  }
}

export interface AuditLogInput {
  source: 'gui' | 'ai' | 'mcp'
  connectionId: string | null
  action: string
  detail?: string | null
  decision: 'allow' | 'deny' | 'confirm_required'
  rowsAffected?: number | null
  riskLevel?: string | null
}

export const auditLogDao = {
  /** 记录审计日志 */
  record(input: AuditLogInput): void {
    const db = getDb()
    db.prepare(
      `INSERT INTO audit_log
        (source, connection_id, action, detail, decision, rows_affected, risk_level, created_at)
       VALUES
        (@source, @connection_id, @action, @detail, @decision, @rows_affected, @risk_level, datetime('now'))`,
    ).run({
      source: input.source,
      connection_id: input.connectionId,
      action: input.action,
      detail: input.detail ?? null,
      decision: input.decision,
      rows_affected: input.rowsAffected ?? null,
      risk_level: input.riskLevel ?? null,
    })
  },

  /** 查询审计日志（分页，可按连接过滤） */
  list(connectionId?: string, limit = 100): AuditLogRecord[] {
    const db = getDb()
    const rows = connectionId
      ? (db
          .prepare(
            `SELECT * FROM audit_log WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(connectionId, limit) as AuditLogRow[])
      : (db
          .prepare(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`)
          .all(limit) as AuditLogRow[])
    return rows.map(rowToRecord)
  },

  /** 搜索审计日志 */
  search(keyword: string, limit = 50): AuditLogRecord[] {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT * FROM audit_log WHERE action LIKE ? OR detail LIKE ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(`%${keyword}%`, `%${keyword}%`, limit) as AuditLogRow[]
    return rows.map(rowToRecord)
  },

  /** 清空审计日志 */
  clear(connectionId?: string): void {
    const db = getDb()
    if (connectionId) {
      db.prepare(`DELETE FROM audit_log WHERE connection_id = ?`).run(connectionId)
    } else {
      db.prepare(`DELETE FROM audit_log`).run()
    }
  },
}
