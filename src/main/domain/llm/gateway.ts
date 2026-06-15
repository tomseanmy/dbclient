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
import { chat as clientChat, ping } from './client'

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
