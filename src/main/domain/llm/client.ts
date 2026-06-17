/**
 * LLM 客户端 —— OpenAI 兼容协议直调
 *
 * 不引入任何具体 provider SDK，只用 Node 内置 fetch 直调
 * /v1/chat/completions，覆盖 DeepSeek/Qwen/Moonshot/Ollama/OpenAI 等。
 *
 * 支持流式（SSE）与非流式两种调用。流式用于对话工作台/图表生成等长输出场景，
 * 非流式用于补全/连通测试等短输出场景。
 */
import type { ChatMessage, ChatResponse, TokenUsage } from '@shared/types/llm'
import { logger } from '@main/infra/logger'
import { tMain } from '@main/i18n'

interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** 请求超时（毫秒），默认 60s */
  timeoutMs?: number
}

/** 流式输出的增量回调参数 */
export interface StreamDelta {
  /** 本片段文本（已累积之外的新增部分） */
  delta: string
}

/** 流式选项：每次收到 delta 时回调 */
interface StreamOptions extends ChatOptions {
  /** 收到增量文本时回调 */
  onDelta: (chunk: StreamDelta) => void
  /**
   * 外部传入的取消信号（用于主动停止生成）。
   * 与内部超时定时器联动：任一触发都会 abort 实际请求。
   */
  signal?: AbortSignal
}

/** 带 tools 的流式选项：复用 StreamOptions，文本增量同样通过 onDelta 推送 */
type StreamWithToolsOptions = StreamOptions

/** 工具定义（OpenAI 兼容 function-calling 的 tool schema） */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    /** JSON Schema 参数描述 */
    parameters: Record<string, unknown>
  }
}

/** LLM 请求的工具调用（需执行的函数） */
export interface LlmToolCall {
  /** 工具调用 id（回灌结果时关联） */
  id: string
  /** 函数名 */
  name: string
  /** 参数（已 JSON.parse 的对象；解析失败为 null） */
  args: Record<string, unknown> | null
}

/** 带 tool-calling 的响应：要么是普通文本，要么是工具调用请求 */
export interface ChatWithToolsResult {
  /** 模型输出的文本（若 finish_reason 非 tool_calls） */
  content: string | null
  /** 模型请求的工具调用（finish_reason === 'tool_calls' 时非空） */
  toolCalls: LlmToolCall[]
  /** 是否请求调用工具 */
  isToolCall: boolean
  model: string
  usage: TokenUsage
}

interface OpenAiChoice {
  message?: { content?: string }
}

interface OpenAiResponse {
  choices?: OpenAiChoice[]
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  error?: { message?: string; code?: string }
}

/**
 * 调用 OpenAI 兼容 /v1/chat/completions。
 *
 * @param baseUrl  provider base URL（如 https://api.deepseek.com/v1）
 * @param apiKey   API Key
 * @param model    模型名
 * @param messages 对话消息
 * @param opts     可选参数
 */
export async function chat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResponse> {
  const url = joinUrl(baseUrl, '/chat/completions')
  const timeoutMs = opts.timeoutMs ?? 60_000

  logger.debug('LLM 请求', { url, model, messageCount: messages.length })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: controller.signal,
    })

    const body = (await resp.json()) as OpenAiResponse

    if (!resp.ok || body.error) {
      const msg = body.error?.message ?? `HTTP ${resp.status}`
      throw new Error(tMain('errors.llm.callFailed', { msg }))
    }

    const content = body.choices?.[0]?.message?.content ?? ''
    if (!content) {
      throw new Error(tMain('errors.llm.emptyResponse'))
    }

    return {
      content,
      model: body.model ?? model,
      usage: {
        prompt: body.usage?.prompt_tokens ?? 0,
        completion: body.usage?.completion_tokens ?? 0,
        total: body.usage?.total_tokens ?? 0,
      },
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(tMain('errors.llm.requestTimeout', { seconds: timeoutMs / 1000 }))
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * agent loop 消息：比 ChatMessage 宽，支持工具调用与结果回灌。
 * - assistant 消息可带 tool_calls（模型请求的工具）
 * - tool role 消息携带工具执行结果（tool_call_id 关联）
 */
export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: {
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }[]
    }
  | { role: 'tool'; content: string; tool_call_id: string }

/**
 * 带 tool-calling 的对话调用（非流式）。
 *
 * AGENT loop 每轮用此方法：要么拿到文本（结束），要么拿到 tool_calls（执行后回灌）。
 * 用非流式是因为需要完整解析 tool_calls 才能决定下一步，流式增量价值有限。
 */
export async function chatWithTools(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AgentMessage[],
  tools: ToolDefinition[],
  opts: ChatOptions = {},
): Promise<ChatWithToolsResult> {
  const url = joinUrl(baseUrl, '/chat/completions')
  const timeoutMs = opts.timeoutMs ?? 90_000
  logger.debug('LLM 工具调用请求', {
    url,
    model,
    messageCount: messages.length,
    tools: tools.length,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        tools,
        // 优先返回工具调用而非文本（agent 场景）
        tool_choice: 'auto',
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: controller.signal,
    })

    const body = (await resp.json()) as OpenAiToolResponse
    if (!resp.ok || body.error) {
      const msg = body.error?.message ?? `HTTP ${resp.status}`
      throw new Error(tMain('errors.llm.toolCallFailed', { msg }))
    }

    const choice = body.choices?.[0]
    const message = choice?.message
    const toolCallsRaw = message?.tool_calls ?? []
    const toolCalls: LlmToolCall[] = toolCallsRaw.map((tc) => {
      let args: Record<string, unknown> | null = null
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : null
      } catch {
        args = null
      }
      return { id: tc.id, name: tc.function.name, args }
    })

    const isToolCall = choice?.finish_reason === 'tool_calls' && toolCalls.length > 0

    return {
      content: message?.content ?? null,
      toolCalls,
      isToolCall,
      model: body.model ?? model,
      usage: {
        prompt: body.usage?.prompt_tokens ?? 0,
        completion: body.usage?.completion_tokens ?? 0,
        total: body.usage?.total_tokens ?? 0,
      },
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(tMain('errors.llm.toolCallTimeout', { seconds: timeoutMs / 1000 }))
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 带 tool-calling 的流式调用（SSE）。
 *
 * 与 chatWithTools 等价，但文本通过 onDelta 增量推送，让 AGENT 每一轮的
 * 思考/最终回复边生成边显示，避免长输出的空白等待。
 *
 * 工具调用片段（delta.tool_calls）按 index 累积合并，流结束后与
 * chatWithTools 一样返回结构化的 toolCalls（可据此决定是否进入下一轮）。
 */
export async function chatWithToolsStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AgentMessage[],
  tools: ToolDefinition[],
  opts: StreamWithToolsOptions,
): Promise<ChatWithToolsResult> {
  const url = joinUrl(baseUrl, '/chat/completions')
  const timeoutMs = opts.timeoutMs ?? 90_000
  logger.debug('LLM 流式工具调用请求', {
    url,
    model,
    messageCount: messages.length,
    tools: tools.length,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  // 累积状态
  let fullContent = ''
  let finishReason: string | null = null
  let respModel = model
  const usage: TokenUsage = { prompt: 0, completion: 0, total: 0 }
  // tool_calls 分片累积：index → { id, name, arguments(分片字符串拼接) }
  const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>()

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        tools,
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const errBody = (await resp.json().catch(() => null)) as OpenAiResponse | null
      const msg = errBody?.error?.message ?? `HTTP ${resp.status}`
      throw new Error(tMain('errors.llm.streamToolCallFailed', { msg }))
    }
    if (!resp.body) {
      throw new Error(tMain('errors.llm.streamNoBody'))
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue

        let payload: StreamChunk
        try {
          payload = JSON.parse(data) as StreamChunk
        } catch {
          continue
        }

        if (payload.error) {
          throw new Error(tMain('errors.llm.streamError', { msg: payload.error.message ?? data }))
        }
        if (payload.model) respModel = payload.model

        const choice = payload.choices?.[0]
        const delta = choice?.delta

        // 文本增量
        const textDelta = delta?.content ?? ''
        if (textDelta) {
          fullContent += textDelta
          opts.onDelta({ delta: textDelta })
        }

        // 工具调用片段累积（OpenAI 协议：首帧带 id+name，后续帧带 arguments 分片）
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            const acc = toolCallAccumulator.get(idx) ?? { id: '', name: '', args: '' }
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.name += tc.function.name
            if (tc.function?.arguments) acc.args += tc.function.arguments
            toolCallAccumulator.set(idx, acc)
          }
        }

        if (choice?.finish_reason) finishReason = choice.finish_reason

        if (payload.usage) {
          usage.prompt = payload.usage.prompt_tokens ?? usage.prompt
          usage.completion = payload.usage.completion_tokens ?? usage.completion
          usage.total = payload.usage.total_tokens ?? usage.total
        }
      }
    }

    // 合并累积的 tool_calls
    const toolCalls: LlmToolCall[] = [...toolCallAccumulator.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, acc]) => {
        let args: Record<string, unknown> | null = null
        try {
          args = acc.args ? JSON.parse(acc.args) : null
        } catch {
          args = null
        }
        return { id: acc.id, name: acc.name, args }
      })

    const isToolCall = finishReason === 'tool_calls' && toolCalls.length > 0

    return {
      content: fullContent || null,
      toolCalls,
      isToolCall,
      model: respModel,
      usage,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // 用户主动停止：已有文本则视为完成返回，否则报超时
      if (opts.signal?.aborted && fullContent) {
        return {
          content: fullContent,
          toolCalls: [],
          isToolCall: false,
          model: respModel,
          usage,
        }
      }
      throw new Error(tMain('errors.llm.streamToolCallTimeout', { seconds: timeoutMs / 1000 }))
    }
    throw err
  } finally {
    clearTimeout(timer)
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort)
  }
}

/** OpenAI 兼容 tool-calling 响应结构 */
interface OpenAiToolResponse {
  choices?: {
    finish_reason?: string
    message?: {
      content?: string | null
      tool_calls?: {
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }[]
    }
  }[]
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  error?: { message?: string; code?: string }
}

/**
 * 流式调用 OpenAI 兼容 /v1/chat/completions（SSE）。
 *
 * 边收边通过 onDelta 推送增量文本，结束返回完整内容 + token 用量。
 * 用量优先用末帧的 usage；provider 未在流末返回 usage 时，用量记 0
 * （gateway 仍会按惯例落库，避免漏记）。
 *
 * @param opts.onDelta 收到增量文本时回调
 */
export async function chatStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts: StreamOptions,
): Promise<ChatResponse> {
  const url = joinUrl(baseUrl, '/chat/completions')
  const timeoutMs = opts.timeoutMs ?? 120_000
  logger.debug('LLM 流式请求', { url, model, messageCount: messages.length })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // 联动外部取消信号：用户主动停止时也 abort 本请求
  const onExternalAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  // 累积状态（声明在 try 外，便于 catch 块在中止时返回已收到的部分内容）
  let fullContent = ''
  const usage: TokenUsage = { prompt: 0, completion: 0, total: 0 }
  let respModel = model

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        stream: true,
        // 请求在最后一帧返回 usage（OpenAI 兼容协议扩展字段）
        stream_options: { include_usage: true },
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const errBody = (await resp.json().catch(() => null)) as OpenAiResponse | null
      const msg = errBody?.error?.message ?? `HTTP ${resp.status}`
      throw new Error(tMain('errors.llm.streamCallFailed', { msg }))
    }
    if (!resp.body) {
      throw new Error(tMain('errors.llm.streamResponseNoBody'))
    }

    // 逐行解析 SSE：空行分隔事件，每行 `data: <json>` 或 `data: [DONE]`
    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按行切分，最后一段可能不完整，留在 buffer
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':')) continue // 跳过空行与注释（心跳）
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue

        let payload: StreamChunk
        try {
          payload = JSON.parse(data) as StreamChunk
        } catch {
          // 部分实现偶发非完整 JSON，跳过本行
          continue
        }

        if (payload.error) {
          throw new Error(tMain('errors.llm.streamError', { msg: payload.error.message ?? data }))
        }
        if (payload.model) respModel = payload.model

        const delta = payload.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          fullContent += delta
          opts.onDelta({ delta })
        }

        // 末帧 usage（stream_options.include_usage）
        if (payload.usage) {
          usage.prompt = payload.usage.prompt_tokens ?? usage.prompt
          usage.completion = payload.usage.completion_tokens ?? usage.completion
          usage.total = payload.usage.total_tokens ?? usage.total
        }
      }
    }

    if (!fullContent) {
      throw new Error(tMain('errors.llm.streamEmptyResponse'))
    }

    return { content: fullContent, model: respModel, usage }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // 用户主动停止：已有部分内容则视为完成返回，否则报超时
      if (opts.signal?.aborted && fullContent) {
        return { content: fullContent, model: respModel, usage }
      }
      throw new Error(tMain('errors.llm.streamRequestTimeout', { seconds: timeoutMs / 1000 }))
    }
    throw err
  } finally {
    clearTimeout(timer)
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort)
  }
}

/** OpenAI 兼容 SSE 单帧结构（流式专用） */
interface StreamChunk {
  choices?: {
    delta?: {
      content?: string
      /** 流式工具调用片段（按 index 累积合并） */
      tool_calls?: {
        index?: number
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }[]
    }
    finish_reason?: string | null
  }[]
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  error?: { message?: string; code?: string }
}

/** 拼接 base URL + path，处理末尾斜杠 */
function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

/**
 * 连通性测试：发一个极短的 ping 请求，验证 base URL + apiKey + model 可用。
 *
 * 只关心 API 是否可达 + 认证是否通过，不要求返回实际内容
 * （某些 provider 用 max_tokens=1 时返回空 content 是正常的）。
 */
export async function ping(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<{ success: boolean; message: string }> {
  const url = joinUrl(baseUrl, '/chat/completions')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    })

    const body = (await resp.json().catch(() => null)) as OpenAiResponse | null

    if (!resp.ok || body?.error) {
      const msg = body?.error?.message ?? `HTTP ${resp.status}`
      return { success: false, message: msg }
    }

    // HTTP 200 且无 error 字段即视为连通成功
    const respModel = body?.model ?? model
    return {
      success: true,
      message: `${tMain('errors.llm.testConnectSuccess', { model: respModel })}`,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, message: tMain('errors.llm.testTimeout') }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, message: msg }
  } finally {
    clearTimeout(timer)
  }
}
