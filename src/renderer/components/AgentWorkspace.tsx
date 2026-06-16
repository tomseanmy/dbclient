/**
 * AGENT 工作台（AGENT 模式主组件）
 *
 * 订阅 agent:* 事件，把 LLM 的工具调用、工具结果、文本回复渲染成卡片流。
 * 区别于 AiChat（单轮流式文本）：这里是多步 agent loop，每步一个卡片。
 *
 * 条目类型：
 * - user：用户输入
 * - tool：工具调用 + 结果（按 toolCallId 配对，结果异步到达）
 * - assistant：文本回复（最终总结）
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Bot, User, Wrench, Database, Table2, Terminal, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import { useConnectionStore, DB_LABELS } from '../store/connections'
import { notify } from '../services/notifications'
import type {
  ConnectionListItem,
  LlmProvider,
  ChatMessage,
  ToolCallEvent,
  ToolResultEvent,
} from '../api'

/** # 自动补全候选项 */
interface MentionItem {
  conn: ConnectionListItem
  /** 插入到输入框的标签（#name） */
  tag: string
}

/** 工具调用条目（调用 + 待配对的结果） */
interface ToolEntry {
  type: 'tool'
  toolCallId: string
  name: string
  args: Record<string, unknown>
  result?: ToolResultEvent
}

/** 对话流条目联合 */
type Entry =
  | { type: 'user'; content: string }
  | ToolEntry
  | { type: 'assistant'; content: string; sql?: string[]; streaming?: boolean }

interface AgentWorkspaceProps {
  /** 当前选中的连接（从 store 取或外部传入）；可为空 */
  connection?: ConnectionListItem | null
  /** 外部要求带入输入框的初始文本（如 `#db_a 统计订单`） */
  initialInput?: string
}

function genStreamId(): string {
  return `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 由连接生成 #mention 标签（# + 连接名；空格/特殊字符不影响匹配逻辑） */
function makeMentionTag(conn: ConnectionListItem): string {
  return `#${conn.name}`
}

/**
 * 检测 textarea 当前光标处是否处于「#查询」上下文。
 * 规则：从光标向前找最近的 '#'，若它与光标之间没有空白字符（即仍在输入标签内容），
 * 则返回该 # 之后的文本作为查询串；否则返回 null。
 * 触发场景：输入「#」或「#par」时弹出候选。
 */
function detectMentionQuery(el: HTMLTextAreaElement): string | null {
  const { selectionStart, selectionEnd, value } = el
  if (selectionStart !== selectionEnd) return null
  const before = value.slice(0, selectionStart)
  const hashIdx = before.lastIndexOf('#')
  if (hashIdx === -1) return null
  // '#' 必须紧跟在行首或空白之后，避免误匹配形如 a#b
  const prevChar = before[hashIdx - 1]
  if (prevChar !== undefined && !/\s/.test(prevChar)) return null
  const query = before.slice(hashIdx + 1)
  // 标签内不允许换行/空白
  if (/\s/.test(query)) return null
  return query
}

/** 工具名 → 显示信息 */
const TOOL_META: Record<string, { label: string; icon: typeof Database }> = {
  listTables: { label: '列出表', icon: Database },
  describeTable: { label: '查看表结构', icon: Table2 },
  runReadQuery: { label: '执行查询', icon: Terminal },
  generateSql: { label: '生成 SQL', icon: Wrench },
}

export function AgentWorkspace({ connection, initialInput }: AgentWorkspaceProps) {
  const connections = useConnectionStore((s) => s.connections)
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeStreamId = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // —— # 自动补全 ——
  /** 当前光标处的 #mention 查询（如输入「#par」时为 'par'）；null 表示未触发 */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  /** 选中的候选索引（键盘上下移动） */
  const [mentionIndex, setMentionIndex] = useState(0)
  /** 关闭 mention 下一次 onInput 的处理（选中候选项时设 true，避免循环） */
  const suppressMentionRef = useRef(false)

  /**
   * 解析当前生效的连接：
   * - 优先用外部传入的 connection
   * - 否则从输入框文本的 `#db名` 语法匹配连接
   * - 否则取第一个已连接的连接
   * - 都没有则返回 null（AGENT 无法执行工具，只能纯对话）
   */
  const resolveConnection = useCallback(
    (text?: string): ConnectionListItem | null => {
      if (connection) return connection
      // 解析 `#db名` —— 匹配连接 name 或 database 字段
      if (text) {
        const hashMatch = text.match(/#([\w-]+)/)
        if (hashMatch) {
          const tag = hashMatch[1]!.toLowerCase()
          const hit =
            connections.find((c) => c.name.toLowerCase() === tag) ??
            connections.find((c) => (c.database ?? '').toLowerCase() === tag) ??
            connections.find((c) => c.name.toLowerCase().includes(tag))
          if (hit) return hit
        }
      }
      // 回退：第一个已连接的
      const states = useConnectionStore.getState().states
      return connections.find((c) => states[c.id]?.connected) ?? null
    },
    [connection, connections],
  )

  // 外部要求带入初始文本时，注入输入框（一次性）
  useEffect(() => {
    if (initialInput) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部一次性带入初始文本，合法模式
      setInput((prev) => (prev ? prev : initialInput))
    }
  }, [initialInput])

  /** 候选数据库：仅当前已连接的连接，按 query 前缀过滤，前 10 个 */
  const mentionCandidates: MentionItem[] = useMemo(() => {
    if (mentionQuery === null) return []
    const states = useConnectionStore.getState().states
    const q = mentionQuery.toLowerCase()
    return connections
      .filter((c) => states[c.id]?.connected)
      .map((c) => ({ conn: c, tag: makeMentionTag(c) }))
      .filter((m) => m.tag.toLowerCase().includes(q))
      .slice(0, 10)
  }, [mentionQuery, connections])

  /** 当前有效的选中索引（渲染期 clamp 到候选范围内，避免 effect） */
  const activeMentionIndex = Math.min(mentionIndex, Math.max(0, mentionCandidates.length - 1))

  /** 选中某个候选项：把光标处的 #query 替换为 #tag + 空格 */
  const applyMention = useCallback((item: MentionItem) => {
    const el = inputRef.current
    if (!el) return
    suppressMentionRef.current = true
    const { selectionStart, selectionEnd, value } = el
    // 找到光标前最近一个未闭合的 # 起始位置
    const before = value.slice(0, selectionStart)
    const hashIdx = before.lastIndexOf('#')
    if (hashIdx === -1) return
    const insert = `${item.tag} `
    const next = value.slice(0, hashIdx) + insert + value.slice(selectionEnd)
    setInput(next)
    setMentionQuery(null)
    setMentionIndex(0)
    // 把光标移到插入内容之后，并在下一帧恢复焦点
    const caret = hashIdx + insert.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }, [])

  useEffect(() => {
    api['llm:listProviders']()
      .then((list) => {
        setProviders(list)
        const def = list.find((p) => p.isDefault) ?? list[0]
        if (def) setSelectedProviderId(def.id)
      })
      .catch(() => {})
  }, [])

  // 订阅 agent 事件
  useEffect(() => {
    const offToolCall = window.on('agent:toolCall', (e: ToolCallEvent) => {
      if (e.streamId !== activeStreamId.current) return
      setEntries((prev) => [
        ...prev,
        { type: 'tool', toolCallId: e.toolCallId, name: e.name, args: e.args },
      ])
    })

    const offToolResult = window.on('agent:toolResult', (e: ToolResultEvent) => {
      if (e.streamId !== activeStreamId.current) return
      setEntries((prev) =>
        prev.map((entry) =>
          entry.type === 'tool' && entry.toolCallId === e.toolCallId
            ? { ...entry, result: e }
            : entry,
        ),
      )
    })

    const offText = window.on('agent:text', ({ streamId, delta }) => {
      if (streamId !== activeStreamId.current) return
      setEntries((prev) => {
        // 追加到最后一个 streaming assistant 条目；没有则新建
        const last = prev[prev.length - 1]
        if (last && last.type === 'assistant' && last.streaming) {
          const next = [...prev] as Entry[]
          next[next.length - 1] = {
            ...last,
            content: last.content + delta,
          }
          return next
        }
        return [...prev, { type: 'assistant', content: delta, streaming: true }]
      })
    })

    const offDone = window.on('agent:done', ({ streamId, reply, sql }) => {
      if (streamId !== activeStreamId.current) return
      setEntries((prev) => {
        // 把最后 streaming 的 assistant 条目定型（补 sql）
        const next = [...prev] as Entry[]
        const last = next[next.length - 1]
        if (last && last.type === 'assistant' && last.streaming) {
          next[next.length - 1] = { ...last, streaming: false, sql }
        } else if (reply) {
          next.push({ type: 'assistant', content: reply, sql, streaming: false })
        }
        return next
      })
      setLoading(false)
      activeStreamId.current = null
      // 窗口失焦时提醒用户 AGENT 任务已完成
      void notify('agentComplete', 'AGENT 任务完成', '已生成回复')
    })

    const offError = window.on('agent:error', ({ streamId, message }) => {
      if (streamId !== activeStreamId.current) return
      setError(message)
      setLoading(false)
      activeStreamId.current = null
    })

    return () => {
      offToolCall()
      offToolResult()
      offText()
      offDone()
      offError()
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries, loading])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const conn = resolveConnection(text)
    if (!conn) {
      setError('未选择数据库。请在输入框用 `#数据库名 你的任务` 指定，或先连接一个数据库。')
      return
    }

    setError(null)
    const streamId = genStreamId()
    activeStreamId.current = streamId
    setEntries((prev) => [...prev, { type: 'user', content: text }])
    setInput('')
    setLoading(true)

    try {
      const history: ChatMessage[] = entries
        .filter((e) => e.type === 'user' || e.type === 'assistant')
        .slice(-20)
        .map((e) => ({
          role: e.type === 'user' ? ('user' as const) : ('assistant' as const),
          content: e.content,
        }))

      await api['ai:agentRun']({
        streamId,
        connectionId: conn.id,
        messages: [...history, { role: 'user', content: text }],
        providerId: selectedProviderId || undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
      activeStreamId.current = null
    }
  }, [input, loading, entries, resolveConnection, selectedProviderId])

  const hasProvider = providers.length > 0
  const activeConn = resolveConnection(input)

  return (
    <div className="agent-workspace">
      {/* 当前生效连接提示（用 #db 语法可切换） */}
      <div className="agent-conn-hint">
        {activeConn ? (
          <>
            <span className="conn-dot" style={{ background: activeConn.color || '#0a84ff' }} />
            <Database size={12} />
            <span className="agent-conn-name">{activeConn.name}</span>
            <span className="muted">· 输入 # 可切换数据库</span>
          </>
        ) : (
          <span className="muted">
            未选择数据库。用 <code>#数据库名</code> 指定，如 <code>#mydb 统计订单</code>
          </span>
        )}
      </div>

      {/* 对话流 */}
      <div className="agent-stream" ref={scrollRef}>
        {entries.length === 0 && (
          <div className="ai-chat-empty">
            <p className="ai-chat-ready-title">
              <Bot size={16} style={{ display: 'inline', verticalAlign: 'middle' }} /> AGENT 已就绪
            </p>
            <p className="muted">
              描述你的分析任务，AGENT 会自主查询数据并给出结论，例如：
              <br />
              「统计最近 30 天每天的订单量」
              <br />
              「找出库存低于 10 的商品」
              <br />
              「分析用户表的字段结构」
            </p>
            {!hasProvider && (
              <p className="ai-chat-warn">
                <AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                请先在设置中配置 LLM Provider
              </p>
            )}
          </div>
        )}

        {entries.map((entry, i) => {
          if (entry.type === 'user') {
            return (
              <div key={i} className="ai-chat-turn ai-chat-turn-user">
                <div className="ai-chat-avatar">
                  <User size={14} />
                </div>
                <div className="ai-chat-bubble">
                  <div className="ai-chat-content">{entry.content}</div>
                </div>
              </div>
            )
          }
          if (entry.type === 'tool') {
            return <ToolCard key={i} entry={entry} connectionId={activeConn?.id ?? ''} />
          }
          // assistant
          return (
            <div key={i} className="ai-chat-turn ai-chat-turn-assistant">
              <div className="ai-chat-avatar">
                <Bot size={14} />
              </div>
              <div className="ai-chat-bubble">
                <div className="ai-chat-content">
                  {entry.content}
                  {entry.streaming && <span className="ai-chat-cursor">▋</span>}
                </div>
                {entry.sql && entry.sql.length > 0 && (
                  <div className="ai-chat-sql-cards">
                    {entry.sql.map((sql, j) => (
                      <SqlCardMini key={j} sql={sql} connectionId={activeConn?.id ?? ''} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {loading && entries.length > 0 && entries[entries.length - 1]!.type !== 'assistant' && (
          <div className="ai-chat-turn ai-chat-turn-assistant">
            <div className="ai-chat-avatar">
              <Bot size={14} />
            </div>
            <div className="ai-chat-bubble">
              <div className="ai-chat-typing">
                <span /> <span /> <span />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="ai-chat-error">{error}</div>}

      {/* 胶囊输入框：模型选择 + textarea + 发送 融为一体 */}
      <div className="chat-composer">
        <div className="chat-composer-box">
          <textarea
            ref={inputRef}
            className="chat-composer-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              autoGrow(e.target)
              // 检测光标处的 #mention 查询
              if (suppressMentionRef.current) {
                suppressMentionRef.current = false
                return
              }
              setMentionQuery(detectMentionQuery(e.target))
            }}
            onKeyDown={(e) => {
              // 输入法合成中（敲拼音/选候选词）：Enter/方向键交给输入法，不拦截
              if (e.nativeEvent.isComposing) return

              // —— #mention 下拉导航 ——
              if (mentionQuery !== null && mentionCandidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setMentionIndex((i) => (i + 1) % mentionCandidates.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMentionIndex(
                    (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length,
                  )
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  applyMention(mentionCandidates[activeMentionIndex]!)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setMentionQuery(null)
                  return
                }
              }

              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            onBlur={() => {
              // 延迟关闭，允许点击候选项（mousedown 先于 blur 触发）
              setTimeout(() => setMentionQuery(null), 150)
            }}
            placeholder={
              hasProvider
                ? '描述任务，Enter 发送，Shift+Enter 换行… 输入 # 选择数据库'
                : '请先配置 Provider'
            }
            disabled={!hasProvider || loading}
            rows={3}
          />

          {/* #mention 候选下拉 */}
          {mentionQuery !== null && mentionCandidates.length > 0 && (
            <div className="mention-popover">
              <div className="mention-popover-title">已连接的数据库</div>
              {mentionCandidates.map((item, i) => (
                <button
                  key={item.conn.id}
                  className={`mention-item ${i === activeMentionIndex ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault() // 阻止 textarea blur
                    applyMention(item)
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                >
                  <span className="conn-dot" style={{ background: item.conn.color || '#0a84ff' }} />
                  <Database size={12} />
                  <span className="mention-item-name">{item.conn.name}</span>
                  <span className="muted mention-item-type">{DB_LABELS[item.conn.type]}</span>
                </button>
              ))}
            </div>
          )}

          <div className="chat-composer-bar">
            <select
              className="chat-model-select"
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              disabled={!hasProvider}
              title="选择模型"
            >
              {providers.length === 0 && <option value="">未配置</option>}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.models[0] ?? '?'}
                  {p.isDefault ? '（默认）' : ''}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary chat-send-btn"
              onClick={handleSend}
              disabled={!input.trim() || loading || !hasProvider}
              title="发送（Enter）"
            >
              {loading ? '思考中…' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** textarea 自适应高度：内容增多时向上扩展，封顶 200px */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

/** 工具调用卡片：展示工具名/参数 + 结果（查询结果用表格） */
function ToolCard({
  entry,
  connectionId: _connectionId,
}: {
  entry: ToolEntry
  connectionId: string
}) {
  const meta = TOOL_META[entry.name]
  const Icon = meta?.icon ?? Wrench
  const result = entry.result

  return (
    <div className="agent-tool-card">
      <div className="agent-tool-head">
        <Icon size={13} />
        <span className="agent-tool-name">{meta?.label ?? entry.name}</span>
        {entry.name === 'runReadQuery' && (
          <code className="agent-tool-sql">{String(entry.args.sql ?? '').slice(0, 60)}</code>
        )}
        {entry.name === 'describeTable' && (
          <code className="agent-tool-sql">{String(entry.args.table ?? '')}</code>
        )}
        {result ? (
          result.ok ? (
            <span className="agent-tool-status ok">✓</span>
          ) : (
            <span className="agent-tool-status err">✗</span>
          )
        ) : (
          <span className="agent-tool-status pending">…</span>
        )}
      </div>
      {/* 结果内容 */}
      {result && result.structured?.kind === 'query' && (
        <ResultTable structured={result.structured} />
      )}
      {result && result.structured?.kind === 'tables' && (
        <div className="agent-tool-result">
          {result.structured.tables.map((t) => (
            <span key={t.name} className="agent-table-chip">
              {t.name}
            </span>
          ))}
        </div>
      )}
      {result && result.structured?.kind === 'schema' && (
        <div className="agent-tool-result">
          {result.structured.columns.map((c) => (
            <div key={c.name} className="agent-col-row">
              <code>{c.name}</code>
              <span className="muted">{c.dataType}</span>
              {c.isPrimaryKey && <span className="pk-tag">PK</span>}
            </div>
          ))}
        </div>
      )}
      {result && result.structured?.kind === 'sql' && (
        <pre className="sql-card-code">{result.structured.sql}</pre>
      )}
      {result && result.structured?.kind === 'error' && (
        <div className="agent-tool-error">{result.structured.message}</div>
      )}
      {result && !result.ok && !result.structured && (
        <div className="agent-tool-error">{result.result}</div>
      )}
    </div>
  )
}

/** 查询结果表格（前若干行） */
function ResultTable({
  structured,
}: {
  structured: Extract<ToolResultEvent['structured'], { kind: 'query' }>
}) {
  const previewRows = structured.rows.slice(0, 8)
  return (
    <div className="agent-result-table">
      <div className="agent-result-meta">
        {structured.rowCount} 行{structured.truncated ? '（已截断至 50）' : ''}
      </div>
      <table>
        <thead>
          <tr>
            {structured.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{formatCell(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** assistant 回复里的 SQL 小卡片（可执行） */
function SqlCardMini({ sql, connectionId }: { sql: string; connectionId: string }) {
  const [executing, setExecuting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleRun = async () => {
    setExecuting(true)
    setResult(null)
    try {
      const r = await api['db:confirmExecute']({ connectionId, sql })
      setResult(`执行成功，${r.rowCount} 行`)
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err))
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="sql-card">
      <div className="sql-card-header">
        <span className="sql-card-label">SQL</span>
        <div className="sql-card-actions">
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => {
              navigator.clipboard.writeText(sql)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            disabled={executing}
          >
            {copied ? '已复制' : '复制'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleRun} disabled={executing}>
            {executing ? '执行中…' : '▶ 执行'}
          </button>
        </div>
      </div>
      <pre className="sql-card-code">{sql}</pre>
      {result && <div className="agent-sql-result">{result}</div>}
    </div>
  )
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 50)
  return String(v).slice(0, 50)
}
