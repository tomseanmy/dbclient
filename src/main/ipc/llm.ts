/**
 * llm:* IPC handler —— LLM Provider 管理 + 连通性测试 + 用量查询
 */
import { registerHandler } from './registry'
import { llmProviderDao } from '@main/infra/storage/llm-provider-dao'
import { llmUsageDao } from '@main/infra/storage/llm-usage-dao'
import { testProvider } from '@main/domain/llm/gateway'
import { logger } from '@main/infra/logger'
import type { LlmProviderInput } from '@shared/types/llm'

export function registerLlmHandlers(): void {
  // 列出所有 provider
  registerHandler('llm:listProviders', () => {
    return llmProviderDao.list()
  })

  // 新建 provider
  registerHandler('llm:createProvider', async (_event, input: LlmProviderInput) => {
    logger.info('新建 LLM Provider', { name: input.name, baseUrl: input.baseUrl })
    return llmProviderDao.create(input)
  })

  // 更新 provider
  registerHandler('llm:updateProvider', async (_event, { id, input }) => {
    logger.info('更新 LLM Provider', { id })
    return llmProviderDao.update(id, input as LlmProviderInput)
  })

  // 删除 provider
  registerHandler('llm:deleteProvider', async (_event, { id }) => {
    logger.info('删除 LLM Provider', { id })
    await llmProviderDao.remove(id)
    return { success: true }
  })

  // 连通性测试（不保存，验证 baseUrl + apiKey + model）
  registerHandler('llm:testProvider', async (_event, input: LlmProviderInput) => {
    logger.info('测试 LLM Provider', { name: input.name })
    const model = input.models[0]
    if (!model) {
      return { success: false, message: '请至少配置一个模型' }
    }
    if (!input.apiKey) {
      return { success: false, message: '请填写 API Key' }
    }
    return testProvider(input.baseUrl, input.apiKey, model)
  })

  // 用量汇总
  registerHandler('llm:getUsage', () => {
    return llmUsageDao.summary()
  })

  // 清空用量
  registerHandler('llm:clearUsage', () => {
    llmUsageDao.clear()
    return { success: true }
  })
}
