/**
 * 订阅 ai:* 流式对话事件（AiChat 用）
 *
 * 封装 ai:streamDelta / ai:streamDone / ai:streamError 三类事件的订阅、
 * activeStreamId 过滤与卸载清理。调用方通过 setActiveStreamId 标记当前流，
 * 通过回调接收增量/完成/错误。
 *
 * 行为与原 AiChat 内联订阅一致，仅提取为可复用 hook。
 */
import { useEffect, useRef, useCallback } from 'react'
import type { AiStreamDonePayload } from '@shared/types/llm'

interface StreamCallbacks {
  /** 收到增量文本（已按 streamId 过滤） */
  onDelta: (delta: string) => void
  /** 流完成（已按 streamId 过滤） */
  onDone: (payload: AiStreamDonePayload) => void
  /** 流出错（已按 streamId 过滤） */
  onError: (message: string) => void
}

/**
 * 订阅 ai:* 流式事件。
 *
 * @returns activeStreamIdRef —— 当前活跃流的 streamId（set 后用于过滤事件）；
 *          以及 setActiveStreamId 用于开始/结束流。
 *
 * 用法：
 * ```ts
 * const { activeStreamIdRef, setActiveStreamId } = useStreamChat({
 *   onDelta: (delta) => setTurns(...),
 *   onDone: (payload) => ...,
 *   onError: (msg) => ...,
 * })
 * // 开始流：
 * const sid = genStreamId()
 * setActiveStreamId(sid)
 * // 结束/清理：
 * setActiveStreamId(null)
 * ```
 */
export function useStreamChat(callbacks: StreamCallbacks): {
  activeStreamIdRef: React.MutableRefObject<string | null>
  setActiveStreamId: (id: string | null) => void
} {
  const activeStreamId = useRef<string | null>(null)

  // 回调用 ref 承载，避免依赖变化导致重新订阅；
  // close 通常是 setXxx(null)，不依赖外部闭包变量，ref 承载行为等价且更高效。
  const cbRef = useRef(callbacks)
  useEffect(() => {
    cbRef.current = callbacks
  })

  useEffect(() => {
    const offDelta = window.on('ai:streamDelta', ({ streamId, delta }) => {
      if (streamId !== activeStreamId.current) return
      cbRef.current.onDelta(delta)
    })

    const offDone = window.on('ai:streamDone', (payload: AiStreamDonePayload) => {
      if (payload.streamId !== activeStreamId.current) return
      cbRef.current.onDone(payload)
    })

    const offError = window.on('ai:streamError', ({ streamId, message }) => {
      if (streamId !== activeStreamId.current) return
      cbRef.current.onError(message)
    })

    return () => {
      offDelta()
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
