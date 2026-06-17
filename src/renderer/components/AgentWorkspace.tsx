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
import { useTranslation } from 'react-i18next'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Bot, User, Database, Table2, AlertTriangle, Settings2 } from 'lucide-react'
import { api } from '../api'
import { useConnectionStore, DB_LABELS } from '../store/connections'
import { useLlmProviderStore } from '../store/llm-providers'
import { useAgentStream } from '../hooks/useAgentStream'
import { notify } from '../services/notifications'
import { genStreamId } from '../lib/stream'
import { detectMention, makeMentionTag, autoGrow, type MentionContext } from '../lib/mention'
import { ToolCard } from './agent/ToolCard'
import { SqlCardMini } from './agent/SqlCardMini'
import { ResultsPanel } from './agent/ResultsPanel'
import { ResultDetailModal } from './agent/ResultDetailModal'
import type { Entry, ExecHistoryItem } from './agent/types'
import type { ConnectionListItem, ChatMessage, ToolCallEvent, ToolResultEvent } from '../api'

/** # 自动补全候选项（连接 / 表） */
type MentionItem =
  | {
      kind: 'connection'
      conn: ConnectionListItem
      /** 插入到输入框的标签（#name） */
      tag: string
      /** 该连接是否已连接（未连接项选中时自动触发连接） */
      connected: boolean
      /** 是否正在连接中（用于候选展示状态） */
      connecting: boolean
    }
  | {
      kind: 'table'
      /** 表名 */
      name: string
      /** 所属连接 */
      conn: ConnectionListItem
      /** 所属 schema（PG 等，可能为空） */
      schema?: string
    }

interface AgentWorkspaceProps {
  /** 当前选中的连接（从 store 取或外部传入）；可为空 */
  connection?: ConnectionListItem | null
  /** 外部要求带入输入框的初始文本（如 `#db_a 统计订单`） */
  initialInput?: string
  /** 未配置 Provider 时，点击「配置模型」打开设置（直达模型 tab） */
  onOpenSettings?: () => void
}

export function AgentWorkspace({ connection, initialInput, onOpenSettings }: AgentWorkspaceProps) {
  const { t } = useTranslation()
  const connections = useConnectionStore((s) => s.connections)
  const connectDb = useConnectionStore((s) => s.connectDb)
  const loadSchemas = useConnectionStore((s) => s.loadSchemas)
  const loadTables = useConnectionStore((s) => s.loadTables)
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // provider 列表改为共享 store：设置中配置后即时刷新（无需重启）
  const providers = useLlmProviderStore((s) => s.providers)
  const selectedProviderId = useLlmProviderStore((s) => s.selectedProviderId)
  const setSelectedProviderId = useLlmProviderStore((s) => s.setSelected)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // —— 执行历史（右侧面板）——
  const [execHistory, setExecHistory] = useState<ExecHistoryItem[]>([])
  /** 详情弹窗展示的历史项（点击查询类历史项打开；null=关闭） */
  const [detailItem, setDetailItem] = useState<ExecHistoryItem | null>(null)
  /** 右侧结果面板是否折叠 */
  const [resultsCollapsed, setResultsCollapsed] = useState(false)

  // —— # 自动补全 ——
  /** 当前光标处的 mention 上下文（连接 / 表）；null 表示未触发 */
  const [mentionContext, setMentionContext] = useState<MentionContext>(null)
  /** 选中的候选索引（键盘上下移动） */
  const [mentionIndex, setMentionIndex] = useState(0)
  /** 关闭 mention 下一次 onInput 的处理（选中候选项时设 true，避免循环） */
  const suppressMentionRef = useRef(false)
  /** mention 候选列表容器，用于键盘导航时把选中项滚进可视区 */
  const mentionListRef = useRef<HTMLDivElement>(null)

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

  /**
   * 候选项：按当前 mention 上下文返回连接或表。
   * - connection：显示全部连接（含未连接），按 query 前缀过滤，前 10 个。
   * - table：从该连接已加载的表（store states）中按 query 前缀过滤，前 10 个。
   */
  const mentionCandidates: MentionItem[] = useMemo(() => {
    if (!mentionContext) return []
    const states = useConnectionStore.getState().states

    if (mentionContext.kind === 'connection') {
      const q = mentionContext.query.toLowerCase()
      return connections
        .map((c) => ({
          kind: 'connection' as const,
          conn: c,
          tag: makeMentionTag(c.name),
          connected: !!states[c.id]?.connected,
          connecting: !!states[c.id]?.connecting,
        }))
        .filter((m) => m.tag.toLowerCase().includes(q))
        .slice(0, 10)
    }

    // table 上下文：定位连接，取其已加载表
    // - connTag 为空（@ 触发）：用当前生效连接（按输入文本解析）
    // - connTag 非空（#db 触发）：按 #tag 匹配连接
    let conn: ConnectionListItem | null
    if (mentionContext.connTag) {
      conn =
        connections.find(
          (c) =>
            makeMentionTag(c.name).toLowerCase() === `#${mentionContext.connTag.toLowerCase()}`,
        ) ??
        connections.find((c) => c.name.toLowerCase() === mentionContext.connTag.toLowerCase()) ??
        null
    } else {
      conn = resolveConnection(input)
    }
    if (!conn) return []
    const tableMap = states[conn.id]?.tables ?? {}
    const q = mentionContext.query.toLowerCase()
    const items: MentionItem[] = []
    for (const [schema, tables] of Object.entries(tableMap)) {
      for (const t of tables) {
        if (t.name.toLowerCase().includes(q)) {
          items.push({ kind: 'table', name: t.name, conn, schema })
          if (items.length >= 10) break
        }
      }
      if (items.length >= 10) break
    }
    return items
  }, [mentionContext, connections, resolveConnection, input])

  /** 当前有效的选中索引（渲染期 clamp 到候选范围内，避免 effect） */
  const activeMentionIndex = Math.min(mentionIndex, Math.max(0, mentionCandidates.length - 1))

  // 键盘上下移动选中项时，把它滚进候选下拉的可视区（避免被遮挡需手动滚动）
  useEffect(() => {
    if (!mentionListRef.current) return
    const el = mentionListRef.current.querySelector<HTMLElement>(
      `[data-mention-idx="${activeMentionIndex}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeMentionIndex])

  /**
   * 连接成功后拉取 schema 与默认 schema 下的表，写入 store。
   * 目的：让左侧对象树无需手动刷新即可展示表，并为 #db 表补全提供数据。
   * 失败静默（树节点仍可手动刷新）。
   */
  const ensureConnLoaded = useCallback(
    async (connId: string) => {
      try {
        await loadSchemas(connId)
        const states = useConnectionStore.getState().states
        const schemas = states[connId]?.schemas ?? []
        // 默认 schema 优先，否则取第一个（SQLite/Redis 可能只有一项）
        const target = schemas.find((sc) => sc.isDefault)?.name ?? schemas[0]?.name ?? ''
        if (target) await loadTables(connId, target)
      } catch {
        // 拉取失败不阻塞 mention 流程
      }
    },
    [loadSchemas, loadTables],
  )

  /** 选中某个候选项：把光标处的 #query 替换为 #tag + 空格；未连接则自动连接 */
  const applyMention = useCallback(
    async (item: MentionItem) => {
      const el = inputRef.current
      if (!el) return
      // 先关闭候选下拉，避免连接等待期间残留
      setMentionContext(null)
      setMentionIndex(0)

      // —— 连接候选：未连接则自动触发连接 ——
      if (item.kind === 'connection') {
        if (!item.connected && !item.connecting) {
          const ok = await connectDb(item.conn.id)
          if (!ok) {
            setError(t('agent.connectFailed', { name: item.conn.name }))
            return
          }
          // 连接成功后立即拉取 schema + 默认 schema 的表，
          // 让左侧对象树无需手动刷新即可展开，并为表补全提供数据
          void ensureConnLoaded(item.conn.id)
        }
        setError(null)

        suppressMentionRef.current = true
        const { selectionStart, selectionEnd, value } = el
        const before = value.slice(0, selectionStart)
        const hashIdx = before.lastIndexOf('#')
        if (hashIdx === -1) return
        const insert = `${item.tag} `
        const next = value.slice(0, hashIdx) + insert + value.slice(selectionEnd)
        setInput(next)
        const caret = hashIdx + insert.length
        requestAnimationFrame(() => {
          el.focus()
          el.setSelectionRange(caret, caret)
        })
        return
      }

      // —— 表候选：把光标处的单词替换为表名 ——
      setError(null)
      suppressMentionRef.current = true
      const { selectionStart, selectionEnd, value } = el
      // 光标前最近的空白位置 = 当前单词起点
      const before = value.slice(0, selectionStart)
      const wordStart = before.search(/\S+$/)
      const start = wordStart === -1 ? selectionStart : wordStart
      const insert = item.name
      const next = value.slice(0, start) + insert + value.slice(selectionEnd)
      setInput(next)
      const caret = start + insert.length
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(caret, caret)
      })
    },
    [connectDb, ensureConnLoaded, t],
  )

  // 订阅 agent 事件（封装在 hook 内，按 activeStreamId 过滤 + 卸载清理）
  const { activeStreamIdRef, setActiveStreamId } = useAgentStream({
    onToolCall: (e: ToolCallEvent) => {
      setEntries((prev) => [
        ...prev,
        { type: 'tool', toolCallId: e.toolCallId, name: e.name, args: e.args },
      ])
    },
    onToolResult: (e: ToolResultEvent) => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.type === 'tool' && entry.toolCallId === e.toolCallId
            ? { ...entry, result: e }
            : entry,
        ),
      )
    },
    onText: ({ delta }) => {
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
    },
    onDone: ({ reply, sql }) => {
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
      setActiveStreamId(null)
      // 窗口失焦时提醒用户 AGENT 任务已完成
      void notify('agentComplete', t('agent.taskCompleteTitle'), t('agent.taskCompleteBody'))
    },
    onError: (message) => {
      setError(message)
      setLoading(false)
      setActiveStreamId(null)
    },
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries, loading])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const conn = resolveConnection(text)
    if (!conn) {
      setError(t('agent.noDbSelected'))
      return
    }

    setError(null)
    const streamId = genStreamId('a')
    setActiveStreamId(streamId)
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
      setActiveStreamId(null)
    }
  }, [input, loading, entries, resolveConnection, selectedProviderId, setActiveStreamId, t])

  /** {t('ai.stop')}当前 AGENT 生成：通知主进程中止底层 SSE 流，并就地结束本地流式态（保留已生成内容） */
  const handleStop = useCallback(async () => {
    const streamId = activeStreamIdRef.current
    if (!streamId) return
    try {
      await api['ai:stopStream']({ streamId })
    } catch {
      // 忽略：主进程可能已无此流
    }
    setLoading(false)
    setActiveStreamId(null)
    // 把正在流式输出的 assistant 条目定型（保留已累积的内容）
    setEntries((prev) => {
      const next = [...prev] as Entry[]
      const last = next[next.length - 1]
      if (last && last.type === 'assistant' && last.streaming) {
        next[next.length - 1] = { ...last, streaming: false }
      }
      return next
    })
  }, [activeStreamIdRef, setActiveStreamId])

  const hasProvider = providers.length > 0
  const activeConn = resolveConnection(input)

  return (
    <div className="agent-workspace">
      <div className="agent-main">
        {/* 当前生效连接提示（用 #db 语法可切换） */}
        <div className="agent-conn-hint">
          {activeConn ? (
            <>
              <span className="conn-dot" style={{ background: activeConn.color || '#0a84ff' }} />
              <Database size={12} />
              <span className="agent-conn-name">{activeConn.name}</span>
              <span className="muted">{t('agent.hintSwitchDb')}</span>
            </>
          ) : (
            <span className="muted">{t('agent.noDbHint')}</span>
          )}
        </div>

        {/* 对话流 */}
        <div className="agent-stream" ref={scrollRef}>
          {entries.length === 0 && (
            <div className="ai-chat-empty">
              <p className="ai-chat-ready-title">
                <Bot size={16} style={{ display: 'inline', verticalAlign: 'middle' }} /> AGENT
                {t('agent.ready')}
              </p>
              <p className="muted">
                {t('agent.placeholderExample')}
                <br />
                {t('agent.example1')}
                <br />
                {t('agent.example2')}
                <br />
                {t('agent.example3')}
              </p>
              {!hasProvider && (
                <p className="ai-chat-warn">
                  <AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                  {t('agent.configureFirst')}
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
                        <SqlCardMini
                          key={j}
                          sql={sql}
                          connection={activeConn}
                          providerId={selectedProviderId || undefined}
                          onExecuted={(item) => {
                            setExecHistory((prev) => [item, ...prev].slice(0, 50))
                            // 成功且为查询语句：自动弹出详情窗口，避免「点了执行看不到东西」
                            if (item.ok && item.result && item.result.columns.length > 0) {
                              setDetailItem(item)
                            }
                          }}
                        />
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

        {/* 胶囊输入框：模型选择 + textarea + {t('ai.send')} 融为一体 */}
        <div className="chat-composer">
          <div className="chat-composer-box">
            <textarea
              ref={inputRef}
              className="chat-composer-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                autoGrow(e.target)
                // 检测光标处的 mention 上下文（连接 / 表）
                if (suppressMentionRef.current) {
                  suppressMentionRef.current = false
                  return
                }
                setMentionContext(detectMention(e.target))
                // 上下文切换时重置选中索引
                setMentionIndex(0)
              }}
              onKeyDown={(e) => {
                // 输入法合成中（敲拼音/选候选词）：Enter/方向键交给输入法，不拦截
                if (e.nativeEvent.isComposing) return

                // —— mention 下拉导航 ——
                if (mentionContext !== null && mentionCandidates.length > 0) {
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
                    void applyMention(mentionCandidates[activeMentionIndex]!)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setMentionContext(null)
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
                setTimeout(() => setMentionContext(null), 150)
              }}
              placeholder={
                hasProvider ? t('agent.inputPlaceholder') : t('agent.noProviderPlaceholder')
              }
              disabled={!hasProvider || loading}
              rows={3}
            />

            {/* mention 候选下拉：连接上下文显示连接，表上下文显示表 */}
            {mentionContext !== null && mentionCandidates.length > 0 && (
              <div className="mention-popover" ref={mentionListRef}>
                <div className="mention-popover-title">
                  {mentionContext.kind === 'connection'
                    ? t('agent.dbConnLabel')
                    : mentionContext.connTag
                      ? t('agent.tablesOf', { conn: mentionContext.connTag })
                      : t('agent.tablesOfCurrent', {
                          conn: resolveConnection(input)?.name ?? t('agent.dbConnLabel'),
                        })}
                </div>
                {mentionCandidates.map((item, i) => (
                  <button
                    key={item.kind === 'connection' ? item.conn.id : `${item.conn.id}:${item.name}`}
                    className={`mention-item ${i === activeMentionIndex ? 'active' : ''}`}
                    data-mention-idx={i}
                    onMouseDown={(e) => {
                      e.preventDefault() // 阻止 textarea blur
                      void applyMention(item)
                    }}
                    onMouseEnter={() => setMentionIndex(i)}
                  >
                    {item.kind === 'connection' ? (
                      <>
                        <span
                          className={`conn-dot ${item.connected ? '' : 'conn-dot-off'}`}
                          style={{
                            background: item.connected ? item.conn.color || '#0a84ff' : undefined,
                          }}
                        />
                        <Database size={12} />
                        <span className="mention-item-name">{item.conn.name}</span>
                        <span className="mention-item-status">
                          {item.connecting
                            ? t('agent.connecting')
                            : item.connected
                              ? DB_LABELS[item.conn.type]
                              : t('agent.notConnected')}
                        </span>
                      </>
                    ) : (
                      <>
                        <Table2 size={12} />
                        <span className="mention-item-name">{item.name}</span>
                        {item.schema && <span className="mention-item-status">{item.schema}</span>}
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="chat-composer-bar">
              {hasProvider ? (
                <select
                  className="chat-model-select"
                  value={selectedProviderId}
                  onChange={(e) => setSelectedProviderId(e.target.value)}
                  title={t('agent.selectModelHint')}
                >
                  <option value="">{t('agent.defaultAgentModel')}</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.models[0] ?? '?'}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  className="chat-model-select chat-model-configure"
                  onClick={() => onOpenSettings?.()}
                  title={t('agent.noModelHint')}
                >
                  <Settings2 size={13} /> {t('agent.configureModel')}
                </button>
              )}
              {loading ? (
                <button
                  className="btn btn-danger chat-send-btn chat-stop-btn"
                  onClick={handleStop}
                  title={t('agent.stopHint')}
                >
                  {t('ai.stop')}
                </button>
              ) : (
                <button
                  className="btn btn-primary chat-send-btn"
                  onClick={handleSend}
                  disabled={!input.trim() || !hasProvider}
                  title={t('agent.sendHint')}
                >
                  {t('ai.send')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 右侧：执行历史面板（列表态；点击查询类项弹出详情窗口） */}
      <ResultsPanel
        history={execHistory}
        collapsed={resultsCollapsed}
        onOpenDetail={(item) => setDetailItem(item)}
        onToggleCollapse={() => setResultsCollapsed((v) => !v)}
        onClear={() => setExecHistory([])}
      />

      {/* 查询结果详情弹窗（独立窗口，上 SQL editor 下结果列表） */}
      {detailItem && <ResultDetailModal item={detailItem} onClose={() => setDetailItem(null)} />}
    </div>
  )
}
