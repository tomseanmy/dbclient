/**
 * ai:* IPC handler —— AI Chat + GUI 辅助
 *
 * 链路：取连接配置 → 构建 Schema 上下文 → 选 prompt 模板 → 调 LLM 网关
 *       → 提取 SQL → 返回回复 + 数据流向提示。
 *
 * AI 生成的 SQL 不在此执行；前端用户确认后走 db:confirmExecute（M3 安全层）。
 */
import { registerHandler } from './registry'
import { chat } from '@main/domain/llm/gateway'
import { getDefaultProviderName } from '@main/domain/llm/gateway'
import { extractSql } from '@main/domain/llm/extract-sql'
import { buildSchemaContext } from '@main/domain/privacy/schema-context'
import {
  buildChatSystemPrompt,
  buildExplainPrompt,
  buildOptimizePrompt,
  buildNl2SqlPrompt,
  buildFixErrorPrompt,
  describeDataFlow,
} from '@main/domain/privacy/prompt'
import { getConfig } from '@main/domain/db/manager'
import { logger } from '@main/infra/logger'
import type { AiChatRequest, AiAssistRequest, AssistAction } from '@shared/types/llm'

/** 按需构建 system prompt（带 Schema 上下文） */
async function buildPromptForAction(
  connectionId: string,
  action: 'chat' | AssistAction,
  scopeTables?: string[],
): Promise<{ systemPrompt: string; includedTables: string[] }> {
  const config = getConfig(connectionId)
  const ctx = await buildSchemaContext(connectionId, { scopeTables })

  const prompts = {
    chat: buildChatSystemPrompt(config.type, ctx.text),
    explain: buildExplainPrompt(config.type, ctx.text),
    optimize: buildOptimizePrompt(config.type, ctx.text),
    nl2sql: buildNl2SqlPrompt(config.type, ctx.text),
    fixError: buildFixErrorPrompt(config.type, ctx.text),
  }

  return { systemPrompt: prompts[action], includedTables: ctx.includedTables }
}

export function registerAiHandlers(): void {
  // AI 对话
  registerHandler('ai:chat', async (_event, req: AiChatRequest) => {
    logger.info('AI 对话', { connectionId: req.connectionId, msgCount: req.messages.length })

    const { systemPrompt, includedTables } = await buildPromptForAction(
      req.connectionId,
      'chat',
      req.scopeTables,
    )

    const messages = [{ role: 'system' as const, content: systemPrompt }, ...req.messages]

    const result = await chat({
      messages,
      providerId: req.providerId,
      model: req.model,
    })

    const sql = extractSql(result.content)
    const providerName = getDefaultProviderName()

    return {
      reply: result.content,
      sql: sql.length > 0 ? sql : undefined,
      dataFlow: describeDataFlow(providerName, includedTables),
    }
  })

  // GUI 辅助（解释/优化/NL2SQL/修复）
  registerHandler('ai:assist', async (_event, req: AiAssistRequest) => {
    logger.info('AI 辅助', { connectionId: req.connectionId, action: req.action })

    const { systemPrompt, includedTables } = await buildPromptForAction(
      req.connectionId,
      req.action,
    )

    // 根据动作构造 user 消息
    let userContent: string
    switch (req.action) {
      case 'explain':
        userContent = `请解释以下 SQL：\n\n${req.payload.sql ?? ''}`
        break
      case 'optimize':
        userContent = `请优化以下 SQL：\n\n${req.payload.sql ?? ''}`
        break
      case 'nl2sql':
        userContent = req.payload.naturalText ?? ''
        break
      case 'fixError':
        userContent = `执行以下 SQL 时报错：\n\nSQL:\n${req.payload.sql ?? ''}\n\n错误信息:\n${req.payload.error ?? ''}`
        break
      default:
        throw new Error(`未知的辅助动作: ${req.action as AssistAction}`)
    }

    const result = await chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      providerId: req.providerId,
      model: req.model,
    })

    const sql = extractSql(result.content)
    const providerName = getDefaultProviderName()

    return {
      reply: result.content,
      sql: sql.length > 0 ? sql : undefined,
      dataFlow: describeDataFlow(providerName, includedTables),
    }
  })
}
