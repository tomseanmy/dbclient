/**
 * AGENT 运行请求类型
 */
import type { ChatMessage } from './llm'

/** AGENT 运行请求（渲染进程 → 主进程） */
export interface AgentRunRequest {
  /** 本次流的唯一标识（前端生成） */
  streamId: string
  connectionId: string
  /** 关联 schema（PG 等） */
  schema?: string
  /** 对话历史（最近若干轮） */
  messages: ChatMessage[]
  providerId?: string
  model?: string
  /** 本次涉及哪些表（约束 schema 上下文范围） */
  scopeTables?: string[]
}
