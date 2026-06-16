/**
 * AI 对话会话 DAO
 *
 * - chat_sessions：会话元信息（标题、关联连接、时间）
 * - chat_history（001_init.sql 已建）：会话内的逐条消息
 *
 * 设计：一个会话由 N 条消息组成。前端按 sessionId 维护对话，
 * 每轮结束 append 消息到 chat_history；会话元信息在首条消息时创建。
 */
import { getDb } from './db'
import type { ChatSession, ChatMessageRecord, ChatSessionInput } from '@shared/types/chat-session'

interface SessionRow {
  id: string
  title: string
  connection_id: string | null
  schema_name: string | null
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: number
  session_id: string
  connection_id: string | null
  role: string
  content: string
  sql_text: string | null
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  created_at: string
}

function rowToSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    connectionId: row.connection_id,
    schemaName: row.schema_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToMessage(row: MessageRow): ChatMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    connectionId: row.connection_id,
    role: row.role as ChatMessageRecord['role'],
    content: row.content,
    sqlText: row.sql_text,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
  }
}

/** 单条消息输入（append 用） */
export interface AppendMessageInput {
  sessionId: string
  connectionId?: string | null
  role: ChatMessageRecord['role']
  content: string
  sqlText?: string | null
  model?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
}

export const chatSessionDao = {
  // —— 会话元信息 ——

  /** 创建会话 */
  createSession(input: ChatSessionInput): ChatSession {
    const db = getDb()
    db.prepare(
      `INSERT INTO chat_sessions (id, title, connection_id, schema_name)
       VALUES (?, ?, ?, ?)`,
    ).run(input.id, input.title, input.connectionId ?? null, input.schemaName ?? null)
    return this.getSession(input.id)!
  },

  /** 按 id 取会话 */
  getSession(id: string): ChatSession | null {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(id) as
      | SessionRow
      | undefined
    return row ? rowToSession(row) : null
  },

  /** 列出会话（按最后活动倒序，可按连接过滤） */
  listSessions(connectionId?: string): ChatSession[] {
    const db = getDb()
    const rows = connectionId
      ? (db
          .prepare(
            `SELECT * FROM chat_sessions
             WHERE connection_id = ?
             ORDER BY updated_at DESC`,
          )
          .all(connectionId) as SessionRow[])
      : (db.prepare(`SELECT * FROM chat_sessions ORDER BY updated_at DESC`).all() as SessionRow[])
    return rows.map(rowToSession)
  },

  /** 重命名会话（更新标题 + updated_at） */
  renameSession(id: string, title: string): void {
    const db = getDb()
    db.prepare(`UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`).run(
      title,
      id,
    )
  },

  /** 删除会话（连同其消息） */
  deleteSession(id: string): void {
    const db = getDb()
    db.transaction(() => {
      db.prepare(`DELETE FROM chat_history WHERE session_id = ?`).run(id)
      db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id)
    })()
  },

  /** 触摸会话的 updated_at（每轮结束调用） */
  touchSession(id: string): void {
    const db = getDb()
    db.prepare(`UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?`).run(id)
  },

  // —— 会话内消息 ——

  /** 追加一条消息 */
  appendMessage(input: AppendMessageInput): void {
    const db = getDb()
    db.prepare(
      `INSERT INTO chat_history
        (session_id, connection_id, role, content, sql_text, model,
         prompt_tokens, completion_tokens, total_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.sessionId,
      input.connectionId ?? null,
      input.role,
      input.content,
      input.sqlText ?? null,
      input.model ?? null,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.totalTokens ?? null,
    )
    this.touchSession(input.sessionId)
  },

  /** 取会话的全部消息（按时间正序） */
  listMessages(sessionId: string): ChatMessageRecord[] {
    const db = getDb()
    const rows = db
      .prepare(`SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sessionId) as MessageRow[]
    return rows.map(rowToMessage)
  },
}
