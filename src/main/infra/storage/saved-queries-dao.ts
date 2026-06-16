/**
 * 保存查询 DAO
 *
 * 表 saved_queries 已在 001_init.sql 建好（用户命名收藏的 SQL）。
 * 可关联到具体连接（connection_id），也可为空（通用查询）。
 * 写入由用户在编辑器/工作台主动「保存」触发。
 *
 * 类型从 shared/types/saved-query 引入，保证两端一致。
 */
import { getDb } from './db'
import type {
  SavedQueryRecord,
  SavedQueryInput,
  SavedQueryUpdatePatch,
} from '@shared/types/saved-query'

export type { SavedQueryRecord, SavedQueryInput, SavedQueryUpdatePatch }

interface SavedQueryRow {
  id: string
  name: string
  sql_text: string
  connection_id: string | null
  description: string | null
  created_at: string
  updated_at: string
}

function rowToRecord(row: SavedQueryRow): SavedQueryRecord {
  return {
    id: row.id,
    name: row.name,
    sqlText: row.sql_text,
    connectionId: row.connection_id,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 生成简易唯一 id（足够区分） */
function genId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const savedQueryDao = {
  /** 新建保存查询 */
  create(input: SavedQueryInput): SavedQueryRecord {
    const db = getDb()
    const id = genId()
    db.prepare(
      `INSERT INTO saved_queries (id, name, sql_text, connection_id, description)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, input.name, input.sqlText, input.connectionId ?? null, input.description ?? null)
    return this.get(id)!
  },

  /** 更新（名称/SQL/描述） */
  update(id: string, patch: SavedQueryUpdatePatch): void {
    const db = getDb()
    const sets: string[] = []
    const params: (string | null)[] = []
    if (patch.name !== undefined) {
      sets.push('name = ?')
      params.push(patch.name)
    }
    if (patch.sqlText !== undefined) {
      sets.push('sql_text = ?')
      params.push(patch.sqlText)
    }
    if (patch.description !== undefined) {
      sets.push('description = ?')
      params.push(patch.description)
    }
    if (sets.length === 0) return
    sets.push("updated_at = datetime('now')")
    params.push(id)
    db.prepare(`UPDATE saved_queries SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  },

  /** 按 id 查询 */
  get(id: string): SavedQueryRecord | null {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM saved_queries WHERE id = ?`).get(id) as
      | SavedQueryRow
      | undefined
    return row ? rowToRecord(row) : null
  },

  /** 查询列表（可按 connection 过滤） */
  list(connectionId?: string): SavedQueryRecord[] {
    const db = getDb()
    const rows = connectionId
      ? (db
          .prepare(
            `SELECT * FROM saved_queries
             WHERE connection_id = ? OR connection_id IS NULL
             ORDER BY updated_at DESC`,
          )
          .all(connectionId) as SavedQueryRow[])
      : (db
          .prepare(`SELECT * FROM saved_queries ORDER BY updated_at DESC`)
          .all() as SavedQueryRow[])
    return rows.map(rowToRecord)
  },

  /** 搜索（名称/SQL 文本） */
  search(keyword: string): SavedQueryRecord[] {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT * FROM saved_queries
         WHERE name LIKE ? OR sql_text LIKE ?
         ORDER BY updated_at DESC`,
      )
      .all(`%${keyword}%`, `%${keyword}%`) as SavedQueryRow[]
    return rows.map(rowToRecord)
  },

  /** 删除 */
  remove(id: string): void {
    const db = getDb()
    db.prepare(`DELETE FROM saved_queries WHERE id = ?`).run(id)
  },
}
