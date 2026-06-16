/**
 * SQL 工作区（M3 版本）
 *
 * 执行流程：
 *   1. 用户点执行
 *   2. 先调 db:checkSql 预检
 *   3a. allowed → 直接执行 db:executeQuery
 *   3b. confirmRequired → 弹 ConfirmDialog，确认后调 db:confirmExecute
 *   3c. denied → 显示 PermissionNotice（可提权）
 */
import { useState, useCallback, useEffect } from 'react'
import { Download, Copy, Check, ChevronDown, Sparkles, Wrench } from 'lucide-react'
import { api, type ConnectionListItem, type QueryResult, type SecurityCheckResult } from '../api'
import type { AssistAction } from '../api'
import { useConnectionStore } from '../store/connections'
import { SqlEditor } from './SqlEditor'
import { DataGrid } from './DataGrid'
import { SqlHistory } from './SqlHistory'
import { SavedQueries } from './SavedQueries'
import { ConfirmDialog } from './ConfirmDialog'
import { notify } from '../services/notifications'
import { PermissionNotice } from './PermissionNotice'
import { AiAssistPanel } from './AiAssistPanel'
import { useTabStore } from '../store/tabs'
import {
  setCompletionContext,
  clearCompletionContext,
  invalidateCompletionCache,
} from '../services/sql-completion'

/** SQL 编辑器初始模板，偏离即视为「已编辑」 */
const INITIAL_SQL = '-- 在此输入 SQL\nSELECT * FROM '

interface SqlWorkspaceProps {
  connection: ConnectionListItem
  /** 所属 tab 的 id，用于上报脏状态（编辑器内容偏离初始模板） */
  tabId: string
}

export function SqlWorkspace({ connection, tabId }: SqlWorkspaceProps) {
  const triggerRefresh = useConnectionStore((s) => s.triggerRefresh)
  const [sql, setSql] = useState(INITIAL_SQL)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmCheck, setConfirmCheck] = useState<SecurityCheckResult | null>(null)
  const [confirmSql, setConfirmSql] = useState('')
  const [deniedCheck, setDeniedCheck] = useState<SecurityCheckResult | null>(null)
  const [aiPanel, setAiPanel] = useState<{
    action: AssistAction
    payload: { sql?: string; naturalText?: string; error?: string }
  } | null>(null)
  const [nlInput, setNlInput] = useState('')

  // 上报脏状态到 tab store（编辑器内容偏离初始模板即视为已编辑）
  const setTabDirty = useTabStore((s) => s.setDirty)
  useEffect(() => {
    setTabDirty(tabId, sql !== INITIAL_SQL)
  }, [tabId, sql, setTabDirty])

  // 设置 SQL 补全上下文（当前连接），卸载时清除；refreshTick 变化时失效缓存
  const refreshTick = useConnectionStore((s) => s.refreshTick)
  useEffect(() => {
    setCompletionContext(connection.id, undefined)
    return () => clearCompletionContext()
  }, [connection.id])
  useEffect(() => {
    // 对象树刷新（DDL 执行后）时，失效该连接的补全缓存
    if (refreshTick > 0) invalidateCompletionCache(connection.id)
  }, [refreshTick, connection.id])

  const doExecute = useCallback(
    async (sqlToRun: string) => {
      setExecuting(true)
      setError(null)
      setResult(null)
      try {
        const res = await api['db:executeQuery']({
          connectionId: connection.id,
          sql: sqlToRun,
        })
        setResult(res)
        // 如果是写操作（有 message 说明是非 SELECT），刷新对象树
        if (res.message) {
          triggerRefresh()
        }
        // 窗口失焦时提醒用户查询已完成
        void notify(
          'queryComplete',
          '查询完成',
          res.message ? res.message : `${res.rowCount ?? 0} 行 · ${res.durationMs ?? 0}ms`,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setExecuting(false)
      }
    },
    [connection.id, triggerRefresh],
  )

  const handleExecute = useCallback(
    async (sqlToRun: string) => {
      if (!sqlToRun.trim()) return
      setExecuting(true)
      setError(null)
      setResult(null)
      setDeniedCheck(null)

      try {
        // 先预检
        const check = await api['db:checkSql']({
          connectionId: connection.id,
          sql: sqlToRun,
        })

        if (check.denied) {
          setDeniedCheck(check)
          setExecuting(false)
          return
        }

        if (check.confirmRequired) {
          setConfirmCheck(check)
          setConfirmSql(sqlToRun)
          setExecuting(false)
          return
        }

        // 直接执行
        await doExecute(sqlToRun)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setExecuting(false)
      }
    },
    [connection.id, doExecute],
  )

  const handleConfirm = async (keyword?: string) => {
    setConfirmCheck(null)
    setExecuting(true)
    try {
      const res = await api['db:confirmExecute']({
        connectionId: connection.id,
        sql: confirmSql,
        confirmedKeyword: keyword,
      })
      setResult(res)
      // 确认执行的是危险操作，一定刷新
      triggerRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExecuting(false)
    }
  }

  const exportCsv = () => {
    if (!result) return
    const headers = result.columns.map((c) => c.name).join(',')
    const lines = result.rows.map((row) =>
      result.columns
        .map((c) => {
          const v = row[c.name]
          if (v === null) return ''
          const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? '"' + s.replace(/"/g, '""') + '"'
            : s
        })
        .join(','),
    )
    download(connection.name + '-query.csv', [headers, ...lines].join('\n'), 'text/csv')
    setExportOpen(false)
  }

  const exportJson = () => {
    if (!result) return
    download(
      connection.name + '-query.json',
      JSON.stringify(result.rows, null, 2),
      'application/json',
    )
    setExportOpen(false)
  }

  const copyResult = async () => {
    if (!result) return
    const headers = result.columns.map((c) => c.name).join('\t')
    const lines = result.rows.map((row) =>
      result.columns
        .map((c) => (row[c.name] === null ? '' : String(row[c.name])).replace(/\t/g, ' '))
        .join('\t'),
    )
    await navigator.clipboard.writeText([headers, ...lines].join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    setExportOpen(false)
  }

  // ===== AI 辅助 =====
  const handleAiExplain = useCallback((sqlText: string) => {
    setAiPanel({ action: 'explain', payload: { sql: sqlText } })
  }, [])

  const handleAiOptimize = useCallback((sqlText: string) => {
    setAiPanel({ action: 'optimize', payload: { sql: sqlText } })
  }, [])

  const handleNl2Sql = useCallback(() => {
    const text = nlInput.trim()
    if (!text) return
    setAiPanel({ action: 'nl2sql', payload: { naturalText: text } })
    setNlInput('')
  }, [nlInput])

  const handleAiFixError = useCallback(() => {
    if (!error) return
    setAiPanel({ action: 'fixError', payload: { sql, error } })
  }, [error, sql])

  const dialect =
    connection.type === 'postgres'
      ? 'postgresql'
      : connection.type === 'sqlite'
        ? 'sqlite'
        : 'mysql'

  return (
    <div className="sql-workspace">
      <SqlEditor
        value={sql}
        onChange={setSql}
        onExecute={handleExecute}
        executing={executing}
        dialect={dialect}
        onAiExplain={handleAiExplain}
        onAiOptimize={handleAiOptimize}
        database={connection.database || connection.name}
      />

      {/* 自然语言转 SQL 输入框 */}
      <div className="nl2sql-bar">
        <Sparkles size={12} />
        <input
          className="nl2sql-input"
          value={nlInput}
          onChange={(e) => setNlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleNl2Sql()
          }}
          placeholder="用自然语言描述需求，AI 帮你写 SQL…"
        />
        <button
          className="btn btn-sm btn-primary"
          onClick={handleNl2Sql}
          disabled={!nlInput.trim()}
        >
          生成 SQL
        </button>
      </div>

      {deniedCheck && (
        <PermissionNotice
          check={deniedCheck}
          connectionId={connection.id}
          onElevated={() => {
            setDeniedCheck(null)
            handleExecute(confirmSql || sql)
          }}
          onDismiss={() => setDeniedCheck(null)}
        />
      )}

      {confirmCheck && (
        <ConfirmDialog
          check={confirmCheck}
          sql={confirmSql}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmCheck(null)}
        />
      )}

      {error && (
        <div className="result-error">
          <div className="result-error-head">
            <strong>执行错误</strong>
            <button className="btn btn-sm btn-warning" onClick={handleAiFixError}>
              <Wrench size={12} /> 让 AI 修复
            </button>
          </div>
          <pre>{error}</pre>
        </div>
      )}

      {aiPanel && (
        <AiAssistPanel
          connection={connection}
          action={aiPanel.action}
          payload={aiPanel.payload}
          onClose={() => setAiPanel(null)}
          onInsertSql={(s) => {
            setSql(s)
            setAiPanel(null)
          }}
          onExecuteSql={(s) => {
            handleExecute(s)
          }}
        />
      )}

      {result && (
        <div className="result-section">
          <div className="result-toolbar">
            <span className="result-info">
              {result.rowCount} 行{result.durationMs > 0 && ' · ' + result.durationMs + 'ms'}
              {result.truncated && <span className="truncated-warn">（已截断）</span>}
              {result.message && <span className="result-message">{result.message}</span>}
            </span>
            <div className="result-actions">
              <button className="btn-icon btn-text" onClick={copyResult} title="复制结果">
                {copied ? <Check size={12} /> : <Copy size={12} />} 复制
              </button>
              <div className="export-wrapper">
                <button className="btn-icon btn-text" onClick={() => setExportOpen(!exportOpen)}>
                  <Download size={12} /> 导出 <ChevronDown size={10} />
                </button>
                {exportOpen && (
                  <div className="export-menu">
                    <button onClick={exportCsv}>CSV</button>
                    <button onClick={exportJson}>JSON</button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DataGrid result={result} />
        </div>
      )}

      {!result && !error && !executing && !deniedCheck && (
        <div className="result-placeholder">
          <p>执行查询后结果将显示在这里</p>
        </div>
      )}

      <SqlHistory connectionId={connection.id} onPick={(s) => setSql(s)} />
      <SavedQueries connectionId={connection.id} currentSql={sql} onPick={(s) => setSql(s)} />
    </div>
  )
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
