/**
 * LLM 网关门面
 *
 * 职责：
 * - 解析 providerId（缺省用全局默认）
 * - 取 provider 配置 + API Key（CredentialStore）
 * - 调用 client.chat
 * - 记录 token 用量
 *
 * 上层（AI Chat / GUI 辅助 / MCP）只依赖此门面，不感知 provider 细节。
 */
import type { ChatRequest, ChatResponse } from '@shared/types/llm'
import { llmProviderDao } from '@main/infra/storage/llm-provider-dao'
import { llmUsageDao } from '@main/infra/storage/llm-usage-dao'
import { logger } from '@main/infra/logger'
import {
  chat as clientChat,
  chatStream as clientChatStream,
  chatWithTools as clientChatWithTools,
  chatWithToolsStream as clientChatWithToolsStream,
  ping,
} from './client'
import type { StreamDelta, ToolDefinition, AgentMessage, ChatWithToolsResult } from './client'

/**
 * 进行中的流式对话：streamId → AbortController。
 * 用于实现「停止生成」：主进程收到 ai:stopStream 时 abort 对应流。
 */
const activeStreams = new Map<string, AbortController>()

/** 注册一个流并返回其 AbortController；结束后自动清理 */
function registerStream(streamId: string): AbortController {
  const controller = new AbortController()
  activeStreams.set(streamId, controller)
  return controller
}

/** 流结束后清理（无论正常结束/出错/中止） */
function unregisterStream(streamId: string): void {
  activeStreams.delete(streamId)
}

/** 中止指定流（用户主动停止）。不存在的 streamId 视为 no-op */
export function stopStream(streamId: string): void {
  const controller = activeStreams.get(streamId)
  if (controller) controller.abort()
}

/** 解析 provider + model + apiKey，供调用前预检 */
function resolveProvider(providerId?: string) {
  const provider = providerId ? llmProviderDao.get(providerId) : llmProviderDao.getDefault()

  if (!provider) {
    throw new Error('未配置 LLM Provider，请先在设置中添加')
  }

  return provider
}

async function resolveApiKey(providerId: string): Promise<string> {
  const apiKey = await llmProviderDao.getApiKey(providerId)
  if (!apiKey) {
    throw new Error('该 Provider 未配置 API Key')
  }
  return apiKey
}

/** 调用 LLM 对话（记录用量） */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const provider = resolveProvider(req.providerId)
  const apiKey = await resolveApiKey(provider.id)
  const model = req.model ?? provider.models[0]

  if (!model) {
    throw new Error(`Provider "${provider.name}" 未配置模型`)
  }

  const result = await clientChat(provider.baseUrl, apiKey, model, req.messages, {
    temperature: req.temperature,
    maxTokens: req.maxTokens,
  })

  // 记录 token 用量
  llmUsageDao.record({
    provider: provider.name,
    model: result.model,
    usage: result.usage,
  })

  logger.info('LLM 调用完成', {
    provider: provider.name,
    model: result.model,
    totalTokens: result.usage.total,
  })

  return result
}

/**
 * 流式调用 LLM 对话（边输出边通过 onDelta 推送，结束记录用量）。
 *
 * 上层（IPC handler）把 onDelta 转成 renderer 的增量事件，
 * 渲染进程逐 token 追加渲染，避免长输出的空白等待。
 *
 * @param streamId 可选，传入后注册到 activeStreams，可被 stopStream 中止
 */
export async function chatStream(
  req: ChatRequest,
  onDelta: (delta: StreamDelta) => void,
  streamId?: string,
): Promise<ChatResponse> {
  const provider = resolveProvider(req.providerId)
  const apiKey = await resolveApiKey(provider.id)
  const model = req.model ?? provider.models[0]

  if (!model) {
    throw new Error(`Provider "${provider.name}" 未配置模型`)
  }

  const controller = streamId ? registerStream(streamId) : undefined
  try {
    const result = await clientChatStream(provider.baseUrl, apiKey, model, req.messages, {
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      onDelta,
      signal: controller?.signal,
    })

    // 流式结束后同样记录用量
    llmUsageDao.record({
      provider: provider.name,
      model: result.model,
      usage: result.usage,
    })

    logger.info('LLM 流式调用完成', {
      provider: provider.name,
      model: result.model,
      totalTokens: result.usage.total,
    })

    return result
  } finally {
    if (streamId) unregisterStream(streamId)
  }
}

/**
 * 带 tool-calling 的对话（AGENT loop 每轮调用）。
 * 记录用量后返回结构化结果（文本 or 工具调用请求）。
 */
export async function chatWithTools(
  messages: AgentMessage[],
  tools: ToolDefinition[],
  opts: { providerId?: string; model?: string; temperature?: number } = {},
): Promise<ChatWithToolsResult> {
  const provider = resolveProvider(opts.providerId)
  const apiKey = await resolveApiKey(provider.id)
  const model = opts.model ?? provider.models[0]
  if (!model) {
    throw new Error(`Provider "${provider.name}" 未配置模型`)
  }

  const result = await clientChatWithTools(provider.baseUrl, apiKey, model, messages, tools, {
    temperature: opts.temperature,
  })

  llmUsageDao.record({
    provider: provider.name,
    model: result.model,
    usage: result.usage,
  })

  logger.info('LLM 工具调用完成', {
    provider: provider.name,
    model: result.model,
    isToolCall: result.isToolCall,
    toolCount: result.toolCalls.length,
    totalTokens: result.usage.total,
  })

  return result
}

/**
 * 带 tool-calling 的流式对话（AGENT loop 每轮调用）。
 *
 * 与 chatWithTools 等价，但文本通过 onDelta 增量推送，让 AGENT 的思考/
 * 最终回复边生成边显示。工具调用判断在流结束后得出，返回结构与
 * chatWithTools 一致。streamId 用于注册到 activeStreams，支持「停止」。
 */
export async function chatWithToolsStream(
  messages: AgentMessage[],
  tools: ToolDefinition[],
  opts: {
    providerId?: string
    model?: string
    temperature?: number
    onDelta: (delta: StreamDelta) => void
    streamId?: string
  },
): Promise<ChatWithToolsResult> {
  const provider = resolveProvider(opts.providerId)
  const apiKey = await resolveApiKey(provider.id)
  const model = opts.model ?? provider.models[0]
  if (!model) {
    throw new Error(`Provider "${provider.name}" 未配置模型`)
  }

  const controller = opts.streamId ? registerStream(opts.streamId) : undefined
  try {
    const result = await clientChatWithToolsStream(
      provider.baseUrl,
      apiKey,
      model,
      messages,
      tools,
      {
        temperature: opts.temperature,
        onDelta: opts.onDelta,
        signal: controller?.signal,
      },
    )

    llmUsageDao.record({
      provider: provider.name,
      model: result.model,
      usage: result.usage,
    })

    logger.info('LLM 流式工具调用完成', {
      provider: provider.name,
      model: result.model,
      isToolCall: result.isToolCall,
      toolCount: result.toolCalls.length,
      totalTokens: result.usage.total,
    })

    return result
  } finally {
    if (opts.streamId) unregisterStream(opts.streamId)
  }
}

/** 连通性测试（不记录用量） */
export async function testProvider(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<{ success: boolean; message: string }> {
  return ping(baseUrl, apiKey, model)
}

/** 获取当前默认 provider 名（供数据流向提示用） */
export function getDefaultProviderName(): string {
  return llmProviderDao.getDefault()?.name ?? '未配置'
}
