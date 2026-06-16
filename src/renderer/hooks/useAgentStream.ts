/**
 * 订阅 agent:* 事件（AgentWorkspace 用）
 *
 * 封装 agent:toolCall / agent:toolResult / agent:text / agent:done / agent:error
 * 五类事件的订阅、activeStreamId 过滤与卸载清理。
 *
 * 行为与原 AgentWorkspace 内联订阅一致，仅提取为可复用 hook。
 */
import { useEffect, useRef, useCallback } from 'react'
import type { ToolCallEvent, ToolResultEvent, AgentTextEvent } from '@shared/types/agent'

interface AgentStreamCallbacks {
  /** 工具调用开始 */
  onToolCall: (e: ToolCallEvent) => void
  /** 工具调用返回结果 */
  onToolResult: (e: ToolResultEvent) => void
  /** LLM 文本增量 */
  onText: (e: AgentTextEvent) => void
  /** AGENT 运行完成（reply + sql） */
  onDone: (payload: { streamId: string; reply: string; sql?: string[] }) => void
  /** AGENT 运行出错 */
  onError: (message: string) => void
}

/**
 * 订阅 agent:* 事件。
 *
 * @returns activeStreamIdRef（用于过滤事件）、setActiveStreamId（开始/结束流）。
 */
export function useAgentStream(callbacks: AgentStreamCallbacks): {
  activeStreamIdRef: React.MutableRefObject<string | null>
  setActiveStreamId: (id: string | null) => void
} {
  const activeStreamId = useRef<string | null>(null)

  // 回调用 ref 承载，避免依赖变化导致重新订阅
  const cbRef = useRef(callbacks)
  useEffect(() => {
    cbRef.current = callbacks
  })

  useEffect(() => {
    const offToolCall = window.on('agent:toolCall', (e: ToolCallEvent) => {
      if (e.streamId !== activeStreamId.current) return
      cbRef.current.onToolCall(e)
    })

    const offToolResult = window.on('agent:toolResult', (e: ToolResultEvent) => {
      if (e.streamId !== activeStreamId.current) return
      cbRef.current.onToolResult(e)
    })

    const offText = window.on('agent:text', (e: AgentTextEvent) => {
      if (e.streamId !== activeStreamId.current) return
      cbRef.current.onText(e)
    })

    const offDone = window.on('agent:done', (payload) => {
      if (payload.streamId !== activeStreamId.current) return
      cbRef.current.onDone(payload)
    })

    const offError = window.on('agent:error', ({ streamId, message }) => {
      if (streamId !== activeStreamId.current) return
      cbRef.current.onError(message)
    })

    return () => {
      offToolCall()
      offToolResult()
      offText()
      offDone()
      offError()
    }
  }, [])

  // 用 useCallback 稳定化，便于消费方放入依赖数组而不触发重建
  const setActiveStreamId = useCallback((id: string | null): void => {
    activeStreamId.current = id
  }, [])

  return { activeStreamIdRef: activeStreamId, setActiveStreamId }
}
