/**
 * AI 对话会话类型（主进程与渲染进程共享）
 */

/** 会话元信息（任务列表用） */
export interface ChatSession {
  id: string
  title: string
  connectionId: string | null
  schemaName: string | null
  createdAt: string
  updatedAt: string
}

/** 会话内的单条消息 */
export interface ChatMessageRecord {
  id: number
  sessionId: string
  connectionId: string | null
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** assistant 生成时附带的 SQL */
  sqlText: string | null
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  createdAt: string
}

/** 新建会话输入 */
export interface ChatSessionInput {
  id: string
  title: string
  connectionId?: string | null
  schemaName?: string | null
}
