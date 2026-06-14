/**
 * SQL 执行历史 DAO
 *
 * 记录所有执行过的 SQL（含来源、状态、耗时），用于历史回溯与审计。
 * 写入由 SqlExecutor 调用。
 */
import { getDb } from './db'

export interface SqlHistoryRecord {
  id: number
  connectionId: string | null
  sqlText: string
  status: 'success' | 'error'
  durationMs: number | null
  rowsAffected: number | null
  errorMessage: string | null
  source: 'gui' | 'ai' | 'mcp'
  executedAt: string
}

interface SqlHistoryRow {
  id: number
  connection_id: string | null
  sql_text: string
  status: string
  duration_ms: number | null
  rows_affected: number | null
  error_message: string | null
  source: string
  executed_at: string
}

function rowToRecord(row: SqlHistoryRow): SqlHistoryRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    sqlText: row.sql_text,
    status: row.status as SqlHistoryRecord['status'],
    durationMs: row.duration_ms,
    rowsAffected: row.rows_affected,
    errorMessage: row.error_message,
    source: row.source as SqlHistoryRecord['source'],
    executedAt: row.executed_at,
  }
}

export const sqlHistoryDao = {
  /** 记录一次执行 */
  record(record: Omit<SqlHistoryRecord, 'id' | 'executedAt'>): void {
    const db = getDb()
    db.prepare(
      `INSERT INTO sql_history
        (connection_id, sql_text, status, duration_ms, rows_affected, error_message, source, executed_at)
       VALUES (@connection_id, @sql_text, @status, @duration_ms, @rows_affected, @error_message, @source, datetime('now'))`,
    ).run({
      connection_id: record.connectionId,
      sql_text: record.sqlText,
      status: record.status,
      duration_ms: record.durationMs,
      rows_affected: record.rowsAffected,
      error_message: record.errorMessage,
      source: record.source,
    })
  },

  /** 查询历史（分页） */
  list(connectionId?: string, limit = 100): SqlHistoryRecord[] {
    const db = getDb()
    const rows = connectionId
      ? (db
          .prepare(
            `SELECT * FROM sql_history WHERE connection_id = ? ORDER BY executed_at DESC LIMIT ?`,
          )
          .all(connectionId, limit) as SqlHistoryRow[])
      : (db
          .prepare(`SELECT * FROM sql_history ORDER BY executed_at DESC LIMIT ?`)
          .all(limit) as SqlHistoryRow[])
    return rows.map(rowToRecord)
  },

  /** 搜索历史 */
  search(keyword: string, limit = 50): SqlHistoryRecord[] {
    const db = getDb()
    const rows = db
      .prepare(`SELECT * FROM sql_history WHERE sql_text LIKE ? ORDER BY executed_at DESC LIMIT ?`)
      .all(`%${keyword}%`, limit) as SqlHistoryRow[]
    return rows.map(rowToRecord)
  },

  /** 清空历史 */
  clear(connectionId?: string): void {
    const db = getDb()
    if (connectionId) {
      db.prepare(`DELETE FROM sql_history WHERE connection_id = ?`).run(connectionId)
    } else {
      db.prepare(`DELETE FROM sql_history`).run()
    }
  },
}
