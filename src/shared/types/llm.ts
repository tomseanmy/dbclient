/**
 * LLM 网关相关类型（主进程与渲染进程共享）
 */

/** LLM Provider 配置（列表/展示用，不含 API Key） */
export interface LlmProvider {
  id: string
  name: string
  /** OpenAI 兼容 Base URL，如 https://api.deepseek.com/v1 */
  baseUrl: string
  /** 可用模型列表 */
  models: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 新建/编辑 Provider 的输入 */
export interface LlmProviderInput {
  name: string
  baseUrl: string
  models: string[]
  /** API Key：create 时必填，update 时留空表示不变 */
  apiKey?: string
  sortOrder?: number
}

/** 对话消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Chat 请求（领域层，不含 provider 敏感信息） */
export interface ChatRequest {
  messages: ChatMessage[]
  /** 指定 provider；缺省用全局默认 */
  providerId?: string
  /** 指定模型；缺省用 provider 第一个模型 */
  model?: string
  temperature?: number
  maxTokens?: number
}

/** Token 用量 */
export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

/** Chat 响应 */
export interface ChatResponse {
  content: string
  model: string
  usage: TokenUsage
}

/** Provider 连通性测试结果 */
export interface ProviderTestResult {
  success: boolean
  message: string
  model?: string
}

/** AI 调用前的数据流向描述（隐私提示用） */
export interface DataFlowNotice {
  /** provider 显示名 */
  providerName: string
  /** 发送内容摘要：如「Schema（12 张表）」 */
  summary: string
  /** 发送的表名列表（供 UI 展示详情） */
  tableNames?: string[]
}

/** AI Chat 请求（渲染进程 → 主进程 IPC） */
export interface AiChatRequest {
  connectionId: string
  messages: ChatMessage[]
  providerId?: string
  model?: string
  /** 本次涉及哪些表（留空则注入相关/全部表 Schema） */
  scopeTables?: string[]
}

/** AI Chat 响应（含提取的 SQL + 数据流向提示） */
export interface AiChatResponse {
  reply: string
  /** 从回复中提取的 SQL（可能多条） */
  sql?: string[]
  dataFlow: DataFlowNotice
}

/** GUI 辅助动作类型 */
export type AssistAction = 'explain' | 'optimize' | 'nl2sql' | 'fixError'

/** GUI 辅助请求 */
export interface AiAssistRequest {
  connectionId: string
  action: AssistAction
  /** explain/optimize: { sql }; nl2sql: { naturalText }; fixError: { sql, error } */
  payload: { sql?: string; naturalText?: string; error?: string }
  providerId?: string
  model?: string
}

/** Token 用量汇总（按 provider 聚合） */
export interface UsageSummary {
  totalTokens: number
  totalCalls: number
  byProvider: {
    provider: string
    totalTokens: number
    calls: number
  }[]
}

// ============================================================================
// 流式（SSE）对话支持
//
// 流式采用「请求-响应 + 事件推送」组合：
// - 渲染进程 invoke('ai:chatStream', req) 发起请求，拿到本次会话的 streamId
// - 主进程通过 webContents.send('ai:streamDelta', { streamId, delta }) 增量推送
// - 收到 streamId 一致的 'ai:streamDone' 表示本流结束（携带最终回复/SQL/数据流向）
// - 出错时推送 'ai:streamError'（携带 message）
// ============================================================================

/** 流式请求：复用 AiChatRequest，额外带一个客户端生成的 streamId */
export interface AiChatStreamRequest extends AiChatRequest {
  /** 本次流的唯一标识（前端生成），用于匹配增量事件 */
  streamId: string
}

/** 增量文本事件载荷 */
export interface AiStreamDeltaPayload {
  streamId: string
  /** 本片段新增文本 */
  delta: string
}

/** 流结束事件载荷（携带最终回复 + 提取的 SQL + 数据流向） */
export interface AiStreamDonePayload {
  streamId: string
  reply: string
  sql?: string[]
  dataFlow: DataFlowNotice
}

/** 流错误事件载荷 */
export interface AiStreamErrorPayload {
  streamId: string
  message: string
}
