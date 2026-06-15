/**
 * LLM 客户端 —— OpenAI 兼容协议直调
 *
 * 不引入任何具体 provider SDK，只用 Node 内置 fetch 直调
 * /v1/chat/completions，覆盖 DeepSeek/Qwen/Moonshot/Ollama/OpenAI 等。
 *
 * 第一版非流式；P1 加 SSE 流式（mainWindow.webContents.send 增量推送）。
 */
import type { ChatMessage, ChatResponse } from '@shared/types/llm'
import { logger } from '@main/infra/logger'

interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** 请求超时（毫秒），默认 60s */
  timeoutMs?: number
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
      throw new Error(`LLM 调用失败: ${msg}`)
    }

    const content = body.choices?.[0]?.message?.content ?? ''
    if (!content) {
      throw new Error('LLM 返回内容为空')
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
      throw new Error(`LLM 请求超时（${timeoutMs / 1000}s）`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
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
    return { success: true, message: `连接成功（模型 ${respModel}）` }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, message: '请求超时（15s）' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, message: msg }
  } finally {
    clearTimeout(timer)
  }
}
