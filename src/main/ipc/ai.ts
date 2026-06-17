/**
 * ai:* IPC handler —— AI Chat + GUI 辅助
 *
 * 链路：取连接配置 → 构建 Schema 上下文 → 选 prompt 模板 → 调 LLM 网关
 *       → 提取 SQL → 返回回复 + 数据流向提示。
 *
 * AI 生成的 SQL 不在此执行；前端用户确认后走 db:confirmExecute（M3 安全层）。
 */
import { registerHandler } from './registry'
import { tMain } from '@main/i18n'
import { chat, chatStream, stopStream, getDefaultProviderName } from '@main/domain/llm/gateway'
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
import { runAgentLoop } from '@main/domain/agent/agent-loop'
import { getConfig } from '@main/domain/db/manager'
import { logger } from '@main/infra/logger'
import type {
  AiChatRequest,
  AiAssistRequest,
  AssistAction,
  AiChatStreamRequest,
} from '@shared/types/llm'
import type { AgentRunRequest } from '@shared/types/agent-run'
import type { IpcMainInvokeEvent } from 'electron'

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
  // AI 对话（非流式）
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

  // AI 对话（流式 SSE）
  // invoke 立即返回 streamId；增量文本/完成/错误通过事件通道推送：
  //   ai:streamDelta / ai:streamDone / ai:streamError
  registerHandler('ai:chatStream', async (event, req: AiChatStreamRequest) => {
    const { streamId } = req
    logger.info('AI 流式对话', {
      connectionId: req.connectionId,
      msgCount: req.messages.length,
      streamId,
    })

    // 异步执行流式对话；不 await，让 invoke 立即返回
    void runChatStream(event, req).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('AI 流式对话失败', { streamId, message })
      event.sender.send('ai:streamError', { streamId, message })
    })

    return { streamId, ok: true as const }
  })

  // 停止流式对话（用户点击「停止」）
  registerHandler('ai:stopStream', async (_event, req: { streamId: string }) => {
    logger.info('停止流式对话', { streamId: req.streamId })
    stopStream(req.streamId)
    return { ok: true as const }
  })

  // AGENT 运行（带工具调用循环）
  // invoke 立即返回 streamId；工具调用/结果/文本/完成/错误通过 agent:* 事件推送：
  //   agent:toolCall / agent:toolResult / agent:text / agent:done / agent:error
  registerHandler('ai:agentRun', async (event, req: AgentRunRequest) => {
    const { streamId } = req
    logger.info('AGENT 运行', {
      connectionId: req.connectionId,
      msgCount: req.messages.length,
      streamId,
    })

    void runAgent(event, req).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('AGENT 运行失败', { streamId, message })
      event.sender.send('agent:error', { streamId, message })
    })

    return { streamId, ok: true as const }
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
        throw new Error(
          tMain('errors.llm.unknownAssistAction', { action: req.action as AssistAction }),
        )
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

/**
 * 执行流式对话：构建 prompt → chatStream → 增量推送 delta → 完成推送 done。
 * 失败由调用方捕获并推送 streamError。
 */
async function runChatStream(
  event: import('electron').IpcMainInvokeEvent,
  req: AiChatStreamRequest,
): Promise<void> {
  const { systemPrompt, includedTables } = await buildPromptForAction(
    req.connectionId,
    'chat',
    req.scopeTables,
  )
  const messages = [{ role: 'system' as const, content: systemPrompt }, ...req.messages]

  const result = await chatStream(
    {
      messages,
      providerId: req.providerId,
      model: req.model,
    },
    ({ delta }) => {
      event.sender.send('ai:streamDelta', { streamId: req.streamId, delta })
    },
    req.streamId,
  )

  const sql = extractSql(result.content)
  const providerName = getDefaultProviderName()
  event.sender.send('ai:streamDone', {
    streamId: req.streamId,
    reply: result.content,
    sql: sql.length > 0 ? sql : undefined,
    dataFlow: describeDataFlow(providerName, includedTables),
  })
}

/**
 * 执行 AGENT 运行：agent loop → 推送工具调用/结果/文本 → 完成推送 done。
 * 失败由调用方捕获并推送 agent:error。
 */
async function runAgent(event: IpcMainInvokeEvent, req: AgentRunRequest): Promise<void> {
  const { reply, sql } = await runAgentLoop({
    streamId: req.streamId,
    connectionId: req.connectionId,
    schema: req.schema,
    messages: req.messages,
    scopeTables: req.scopeTables,
    providerId: req.providerId,
    model: req.model,
    callbacks: {
      onToolCall: (e) => event.sender.send('agent:toolCall', e),
      onToolResult: (e) => event.sender.send('agent:toolResult', e),
      onText: (e) => event.sender.send('agent:text', e),
    },
  })

  event.sender.send('agent:done', {
    streamId: req.streamId,
    reply,
    sql: sql.length > 0 ? sql : undefined,
  })
}
