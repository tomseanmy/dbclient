/**
 * AI 对话工作区
 *
 * 自然语言驱动的对话：用户输入 → AI 回复（可能含 SQL）→
 * 用户确认后执行 SQL（走 M3 安全层 db:confirmExecute）。
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '../api'
import type { ConnectionListItem, LlmProvider, ChatMessage, AiChatResponse } from '../api'

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  /** assistant 回复中提取的 SQL */
  sql?: string[]
  /** 数据流向提示 */
  dataFlow?: { providerName: string; summary: string; tableNames?: string[] }
}

interface AiChatProps {
  connection: ConnectionListItem
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

  // 自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, loading])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    setError(null)
    const userTurn: ChatTurn = { role: 'user', content: text }
    setTurns((prev) => [...prev, userTurn])
    setInput('')
    setLoading(true)

    try {
      // 构造历史消息（最近 10 轮）
      const history: ChatMessage[] = [...turns, userTurn]
        .slice(-20)
        .map((t) => ({ role: t.role, content: t.content }))

      const result: AiChatResponse = await api['ai:chat']({
        connectionId: connection.id,
        messages: history,
        providerId: selectedProviderId || undefined,
      })

      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.reply,
          sql: result.sql,
          dataFlow: result.dataFlow,
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [input, loading, turns, connection.id, selectedProviderId])

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
            content: `✅ 执行成功，返回 ${rowCount} 行。`,
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
            <p>💬 AI 对话已就绪</p>
            <p className="muted">
              用自然语言描述你的需求，例如：
              <br />
              「查询最近 7 天注册的用户」
              <br />
              「统计每个分类下的商品数量」
            </p>
            {!hasProvider && <p className="ai-chat-warn">⚠️ 请先在设置中配置 LLM Provider</p>}
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={`ai-chat-turn ai-chat-turn-${turn.role}`}>
            <div className="ai-chat-avatar">{turn.role === 'user' ? '👤' : '🤖'}</div>
            <div className="ai-chat-bubble">
              <div className="ai-chat-content">{turn.content}</div>
              {/* SQL 卡片 */}
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
              {turn.dataFlow && <div className="ai-chat-dataflow">🔒 {turn.dataFlow.summary}</div>}
            </div>
          </div>
        ))}
        {loading && (
          <div className="ai-chat-turn ai-chat-turn-assistant">
            <div className="ai-chat-avatar">🤖</div>
            <div className="ai-chat-bubble">
              <div className="ai-chat-typing">
                <span /> <span /> <span />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="ai-chat-error">{error}</div>}

      {/* 输入区 */}
      <div className="ai-chat-input-area">
        <textarea
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={
            hasProvider ? '输入需求，Enter 发送，Shift+Enter 换行…' : '请先配置 Provider'
          }
          disabled={!hasProvider || loading}
          rows={2}
        />
        <button
          className="btn btn-primary ai-chat-send"
          onClick={handleSend}
          disabled={!input.trim() || loading || !hasProvider}
        >
          {loading ? '思考中…' : '发送'}
        </button>
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
            {copied ? '✓ 已复制' : '复制'}
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
