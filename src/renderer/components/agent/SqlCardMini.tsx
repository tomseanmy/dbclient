/**
 * AGENT assistant 回复里的 SQL 小卡片（从 AgentWorkspace 拆分）
 *
 * - 执行：走 db:confirmExecute（M3 安全层），成功捕获完整 QueryResult 上报父级
 *   （右侧历史面板据此展示结果表）。
 * - 重新生成：执行报错后出现，调 ai:assist 的 fixError 动作，把错误信息回灌 LLM，
 *   拿到新 SQL 就地替换（不污染对话历史）。
 */
import { useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { api } from '../../api'
import type { ConnectionListItem } from '../../api'
import type { ExecHistoryItem } from './types'

export function SqlCardMini({
  sql,
  connection,
  providerId,
  onExecuted,
}: {
  sql: string
  connection: ConnectionListItem | null
  providerId?: string
  /** 执行完成（无论成败）回调，父级把结果归入历史列表 */
  onExecuted?: (item: ExecHistoryItem) => void
}) {
  const connectionId = connection?.id ?? ''
  // 当前展示的 SQL（重新生成后就地替换）
  const [curSql, setCurSql] = useState(sql)
  const [executing, setExecuting] = useState(false)
  const [copied, setCopied] = useState(false)
  /** 执行结果摘要（成功显示行数，失败显示错误） */
  const [result, setResult] = useState<string | null>(null)
  /** 最近一次执行的错误信息（用于「重新生成」） */
  const [lastError, setLastError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  const handleRun = async () => {
    if (!connectionId) return
    setExecuting(true)
    setResult(null)
    setLastError(null)
    try {
      const r = await api['db:confirmExecute']({ connectionId, sql: curSql })
      const hasColumns = r.columns.length > 0
      setResult(
        hasColumns
          ? `执行成功，返回 ${r.rowCount} 行`
          : `执行成功，${r.message ?? r.rowCount + ' 行受影响'}`,
      )
      // 上报到历史面板（查询语句带完整结果，便于右侧展示结果表）
      onExecuted?.({
        id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        time: Date.now(),
        sql: curSql,
        ok: true,
        result: hasColumns ? r : null,
        // 非查询语句（增删改）：记录影响行数，列表态直接展示、禁用点击
        affected: hasColumns ? undefined : { rows: r.rowCount, message: r.message },
        connName: connection?.name ?? '',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setResult(msg)
      setLastError(msg)
      onExecuted?.({
        id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        time: Date.now(),
        sql: curSql,
        ok: false,
        result: null,
        error: msg,
        connName: connection?.name ?? '',
      })
    } finally {
      setExecuting(false)
    }
  }

  /** 根据执行错误让 AI 重新生成 SQL（调 fixError，就地替换） */
  const handleRegenerate = async () => {
    if (!connectionId || !lastError) return
    setRegenerating(true)
    try {
      const res = await api['ai:assist']({
        connectionId,
        action: 'fixError',
        payload: { sql: curSql, error: lastError },
        providerId,
      })
      const newSql = res.sql?.[0]
      if (newSql) {
        setCurSql(newSql)
        setResult(
          res.reply
            ? `已根据错误重新生成 SQL：\n${res.reply}`
            : '已根据错误重新生成 SQL，可重新执行',
        )
        setLastError(null)
      } else {
        setResult(res.reply || 'AI 未能给出修复后的 SQL，请重试')
      }
    } catch (err) {
      setResult('重新生成失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setRegenerating(false)
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
              navigator.clipboard.writeText(curSql)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            disabled={executing || regenerating}
          >
            {copied ? '已复制' : '复制'}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleRun}
            disabled={executing || regenerating}
          >
            {executing ? '执行中…' : '▶ 执行'}
          </button>
        </div>
      </div>
      <pre className="sql-card-code">{curSql}</pre>
      {result && (
        <div className={`agent-sql-result ${lastError ? 'agent-sql-result-err' : ''}`}>
          {result}
          {lastError && (
            <button
              className="btn btn-sm btn-secondary sql-regen-btn"
              onClick={handleRegenerate}
              disabled={regenerating}
              title="把错误信息交给 AI，重新生成 SQL"
            >
              {regenerating ? (
                <>
                  <Loader2 size={11} className="spin" /> 重新生成中…
                </>
              ) : (
                <>
                  <RefreshCw size={11} /> 根据错误重新生成
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
