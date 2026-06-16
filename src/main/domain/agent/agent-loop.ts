/**
 * AGENT loop 引擎（工具调用循环）
 *
 * 这是 AGENT 模式的核心：让 LLM 自主调用工具完成任务。
 *
 * 循环：
 *   1. 把 system prompt（含 schema）+ 历史 + 工具定义发给 LLM
 *   2a. LLM 返回文本 → 流程结束，推送最终回复
 *   2b. LLM 返回 tool_calls → 执行每个工具 → 推送工具调用/结果事件
 *       → 把 assistant(tool_calls) + tool(results) 回灌消息 → 回到第 1 步
 *   3. 达到最大轮数仍未结束 → 强制结束，推送当前文本
 *
 * 安全（T2.5）与自修复（T2.7）：
 * - 工具内部静态拦截写操作，错误以结构化结果返回（不中断循环）
 * - 工具报错会作为 tool result 回灌，LLM 据此修正（天然实现自修复）
 * - 最大轮数兜底，防止无限循环
 *
 * 所有中间步骤通过 onEvent 推送给前端，渲染成卡片化对话流。
 */
import { chatWithToolsStream } from '@main/domain/llm/gateway'
import { getToolsSchema, executeTool } from './tools'
import type { ToolCallEvent, ToolResultEvent, AgentTextEvent } from '@shared/types/agent'
import { buildSchemaContext } from '@main/domain/privacy/schema-context'
import { buildAgentSystemPrompt } from './prompt'
import { getConfig } from '@main/domain/db/manager'
import type { AgentMessage } from '@main/domain/llm/client'
import type { ChatMessage } from '@shared/types/llm'
import { extractSql } from '@main/domain/llm/extract-sql'
import { logger } from '@main/infra/logger'

/** agent loop 的事件回调（前端渲染用） */
export interface AgentLoopCallbacks {
  onToolCall: (e: ToolCallEvent) => void
  onToolResult: (e: ToolResultEvent) => void
  onText: (e: AgentTextEvent) => void
}

/** agent run 参数 */
export interface AgentLoopParams {
  streamId: string
  connectionId: string
  schema?: string
  messages: ChatMessage[]
  scopeTables?: string[]
  providerId?: string
  model?: string
  callbacks: AgentLoopCallbacks
}

/** 最大工具调用轮数（防止无限循环；含最终文本轮） */
const MAX_ROUNDS = 50

/**
 * 运行 AGENT loop。
 * 返回最终回复文本（供持久化与 SQL 提取）。
 */
export async function runAgentLoop(
  params: AgentLoopParams,
): Promise<{ reply: string; sql: string[] }> {
  const { streamId, connectionId, schema, callbacks, providerId, model } = params

  // 构建 system prompt（含 schema 上下文）
  const config = getConfig(connectionId)
  const ctx = await buildSchemaContext(connectionId, { schema, scopeTables: params.scopeTables })
  const systemPrompt = buildAgentSystemPrompt(config.type, ctx.text)

  // 初始消息：system + 历史
  const agentMessages: AgentMessage[] = [
    { role: 'system', content: systemPrompt },
    ...params.messages.map((m) => ({ role: m.role, content: m.content }) as AgentMessage),
  ]

  const tools = getToolsSchema()
  let finalReply = ''
  let round = 0

  while (round < MAX_ROUNDS) {
    round++
    logger.info('AGENT loop 轮次', { streamId, round })

    const result = await chatWithToolsStream(agentMessages, tools, {
      providerId,
      model,
      streamId,
      onDelta: ({ delta }) => {
        // 文本增量实时推送，前端边生成边渲染
        if (delta) callbacks.onText({ streamId, delta })
      },
    })

    // 情况 1：模型返回文本（不再调用工具）→ 结束
    // 最终回复已在上面通过 onDelta 流式推送，这里只记录文本供 SQL 提取
    if (!result.isToolCall) {
      finalReply = result.content ?? ''
      break
    }

    // 情况 2：模型请求工具调用
    // 先把 assistant 的 tool_calls 消息入栈（必须原样回灌）
    agentMessages.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      })),
    })

    // 逐个执行工具，推送事件，回灌结果
    for (const tc of result.toolCalls) {
      callbacks.onToolCall({
        streamId,
        toolCallId: tc.id,
        name: tc.name,
        args: tc.args ?? {},
      })

      const exec = await executeTool(tc.name, connectionId, schema, tc.args ?? {})

      callbacks.onToolResult({
        streamId,
        toolCallId: tc.id,
        ok: exec.ok,
        result: exec.result,
        structured: exec.structured,
      })

      // 回灌工具结果（T2.7：工具报错也回灌，LLM 据此自修复）
      agentMessages.push({
        role: 'tool',
        content: exec.result,
        tool_call_id: tc.id,
      })
    }

    // 如果已到最大轮数，强制结束（保留模型本轮可能已输出的文本）
    if (round >= MAX_ROUNDS) {
      const tail = result.content ?? ''
      finalReply = tail
        ? `${tail}\n\n（已达最大工具调用轮数（${MAX_ROUNDS}），停止自动执行。如需继续，请发送新的需求。）`
        : `（已达最大工具调用轮数（${MAX_ROUNDS}），停止自动执行。如需继续，请发送新的需求。）`
      // tail 已在上方 chatWithToolsStream 的 onDelta 中流式推送，这里只补推提示文本
      callbacks.onText({
        streamId,
        delta: `\n\n（已达最大工具调用轮数（${MAX_ROUNDS}），停止自动执行。如需继续，请发送新的需求。）`,
      })
      break
    }
    // 否则继续下一轮（带工具结果的对话）
  }

  const sql = extractSql(finalReply)
  return { reply: finalReply, sql }
}
