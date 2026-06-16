/**
 * AI 对话工作区
 *
 * 自然语言驱动的对话：用户输入 → AI 回复（可能含 SQL）→
 * 用户确认后执行 SQL（走 M3 安全层 db:confirmExecute）。
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, User, Bot, Lock, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import type { ConnectionListItem, LlmProvider, ChatMessage, AiStreamDonePayload } from '../api'

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  /** assistant 回复中提取的 SQL */
  sql?: string[]
  /** 数据流向提示 */
  dataFlow?: { providerName: string; summary: string; tableNames?: string[] }
  /** 是否正在流式生成（渲染光标） */
  streaming?: boolean
}

interface AiChatProps {
  connection: ConnectionListItem
}

/** 生成简易唯一 streamId（足够区分并发流） */
function genStreamId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function AiChat({ connection }: AiChatProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [executing, setExecuting] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 当前流的 streamId，用于事件过滤 */
  const activeStreamId = useRef<string | null>(null)

  // 加载 provider 列表
  useEffect(() => {
    api['llm:listProviders']()
      .then((list) => {
        setProviders(list)
        const def = list.find((p) => p.isDefault) ?? list[0]
        if (def) setSelectedProviderId(def.id)
      })
      .catch(() => {})
  }, [])

  // 订阅流式事件（挂载一次）
  useEffect(() => {
    // 增量：把 delta 追加到最后一个 assistant turn
    const offDelta = window.on('ai:streamDelta', ({ streamId, delta }) => {
      if (streamId !== activeStreamId.current) return
      setTurns((prev) => {
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'assistant') return prev
        const next = [...prev]
        next[next.length - 1] = { ...last, content: last.content + delta }
        return next
      })
    })

    // 完成：补全 sql/dataFlow，关闭流式态
    const offDone = window.on('ai:streamDone', (payload: AiStreamDonePayload) => {
      if (payload.streamId !== activeStreamId.current) return
      setTurns((prev) => {
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'assistant') return prev
        const next = [...prev]
        next[next.length - 1] = {
          ...last,
          sql: payload.sql,
          dataFlow: payload.dataFlow,
          streaming: false,
        }
        return next
      })
      setLoading(false)
      activeStreamId.current = null
    })

    // 错误：展示错误，关闭 loading
    const offError = window.on('ai:streamError', ({ streamId, message }) => {
      if (streamId !== activeStreamId.current) return
      setError(message)
      setLoading(false)
      // 移除可能残留的空 assistant 占位
      setTurns((prev) => {
        const last = prev[prev.length - 1]
        if (last && last.role === 'assistant' && last.streaming && !last.content) {
          return prev.slice(0, -1)
        }
        return prev
      })
      activeStreamId.current = null
    })

    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [])

  // 自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, loading])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    setError(null)
    const userTurn: ChatTurn = { role: 'user', content: text }
    const streamId = genStreamId()
    activeStreamId.current = streamId
    // 先放一个流式中的 assistant 占位 turn
    const placeholder: ChatTurn = { role: 'assistant', content: '', streaming: true }
    setTurns((prev) => [...prev, userTurn, placeholder])
    setInput('')
    setLoading(true)

    try {
      // 构造历史消息（最近 10 轮，不含刚加的占位）
      const history: ChatMessage[] = [...turns, userTurn]
        .slice(-20)
        .map((t) => ({ role: t.role, content: t.content }))

      await api['ai:chatStream']({
        streamId,
        connectionId: connection.id,
        messages: history,
        providerId: selectedProviderId || undefined,
      })
      // 实际内容由 ai:streamDelta/done 事件填充
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
      activeStreamId.current = null
      setTurns((prev) => prev.filter((t) => !t.streaming))
    }
  }, [input, loading, turns, connection.id, selectedProviderId])

  /** 停止当前流式生成 */
  const handleStop = useCallback(async () => {
    const streamId = activeStreamId.current
    if (!streamId) return
    // 通知主进程中止底层 fetch（SSE）
    try {
      await api['ai:stopStream']({ streamId })
    } catch {
      // 忽略：主进程可能已无此流
    }
    // 立即结束本地流式态（保留已生成的内容）
    setLoading(false)
    activeStreamId.current = null
    setTurns((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.role === 'assistant' && last.streaming) {
        const next = [...prev]
        next[next.length - 1] = { ...last, streaming: false }
        return next
      }
      return prev
    })
  }, [])

  // 执行 AI 生成的 SQL（走 M3 安全层确认）
  const handleExecuteSql = useCallback(
    async (sql: string) => {
      setError(null)
      setExecuting(sql)
      try {
        const result = await api['db:confirmExecute']({
          connectionId: connection.id,
          sql,
        })
        // 执行成功，提示行数
        const rowCount = result.rowCount
        setError(null)
        setTurns((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `执行成功，返回 ${rowCount} 行。`,
          },
        ])
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setExecuting(null)
      }
    },
    [connection.id],
  )

  const hasProvider = providers.length > 0

  return (
    <div className="ai-chat-view">
      {/* 头部：连接信息 + provider 选择 */}
      <div className="ai-chat-header">
        <div className="ai-chat-conn">
          <span className="conn-dot" style={{ background: connection.color || '#0a84ff' }} />
          <span className="ai-chat-conn-name">{connection.name}</span>
          <span className="ai-chat-db-type">{connection.type}</span>
        </div>
        <select
          className="ai-chat-provider-select"
          value={selectedProviderId}
          onChange={(e) => setSelectedProviderId(e.target.value)}
          disabled={!hasProvider}
        >
          {providers.length === 0 && <option value="">未配置 Provider</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.models[0] ?? '?'}
              {p.isDefault ? '（默认）' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* 消息列表 */}
      <div className="ai-chat-messages" ref={scrollRef}>
        {turns.length === 0 && (
          <div className="ai-chat-empty">
            <p className="ai-chat-ready-title">
              <MessageCircle size={16} style={{ display: 'inline', verticalAlign: 'middle' }} /> AI
              对话已就绪
            </p>
            <p className="muted">
              用自然语言描述你的需求，例如：
              <br />
              「查询最近 7 天注册的用户」
              <br />
              「统计每个分类下的商品数量」
            </p>
            {!hasProvider && (
              <p className="ai-chat-warn">
                <AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                请先在设置中配置 LLM Provider
              </p>
            )}
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={`ai-chat-turn ai-chat-turn-${turn.role}`}>
            <div className="ai-chat-avatar">
              {turn.role === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className="ai-chat-bubble">
              {/* 流式中且尚无内容：显示打字动画；否则渲染已累积内容 */}
              {turn.streaming && !turn.content ? (
                <div className="ai-chat-typing">
                  <span /> <span /> <span />
                </div>
              ) : (
                <div className="ai-chat-content">
                  {turn.content}
                  {turn.streaming && <span className="ai-chat-cursor">▋</span>}
                </div>
              )}
              {/* SQL 卡片（流式结束后才有） */}
              {turn.sql && turn.sql.length > 0 && (
                <div className="ai-chat-sql-cards">
                  {turn.sql.map((sql, j) => (
                    <SqlCard
                      key={j}
                      sql={sql}
                      index={j}
                      executing={executing === sql}
                      onExecute={() => handleExecuteSql(sql)}
                    />
                  ))}
                </div>
              )}
              {/* 数据流向提示 */}
              {turn.dataFlow && (
                <div className="ai-chat-dataflow">
                  <Lock size={11} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                  {turn.dataFlow.summary}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="ai-chat-error">{error}</div>}

      {/* 输入区 */}
      <div className="ai-chat-input-area">
        <textarea
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // 输入法正在输入合成中（敲拼音/选候选词）时，Enter 不发送
            // 让输入法自行处理：通常是确认候选词并上屏
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={
            hasProvider ? '输入需求，Enter 发送，Shift+Enter 换行…' : '请先配置 Provider'
          }
          disabled={!hasProvider}
          rows={3}
        />
        {loading ? (
          <button className="btn btn-danger ai-chat-send" onClick={handleStop} title="停止生成">
            停止
          </button>
        ) : (
          <button
            className="btn btn-primary ai-chat-send"
            onClick={handleSend}
            disabled={!input.trim() || !hasProvider}
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}

/** SQL 卡片：展示 SQL + 执行/复制按钮 */
function SqlCard({
  sql,
  index,
  executing,
  onExecute,
}: {
  sql: string
  index: number
  executing: boolean
  onExecute: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(sql)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="sql-card">
      <div className="sql-card-header">
        <span className="sql-card-label">SQL {index + 1}</span>
        <div className="sql-card-actions">
          <button className="btn btn-sm btn-secondary" onClick={handleCopy} disabled={executing}>
            {copied ? '已复制' : '复制'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={onExecute} disabled={executing}>
            {executing ? '执行中…' : '▶ 执行'}
          </button>
        </div>
      </div>
      <pre className="sql-card-code">{sql}</pre>
    </div>
  )
}
