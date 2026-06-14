/**
 * SQL 工作区
 *
 * 整合：SQL 编辑器 + 执行结果网格 + 状态栏 + 导出。
 * 一个连接对应一个工作区。
 */
import { useState, useCallback } from 'react'
import { Download, Copy, Check, ChevronDown } from 'lucide-react'
import { api, type ConnectionListItem, type QueryResult } from '../api'
import { SqlEditor } from './SqlEditor'
import { SqlHistory } from './SqlHistory'
import { DataGrid } from './DataGrid'

interface SqlWorkspaceProps {
  connection: ConnectionListItem
}

export function SqlWorkspace({ connection }: SqlWorkspaceProps) {
  const [sql, setSql] = useState('-- 在此输入 SQL\nSELECT * FROM ')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleExecute = useCallback(
    async (sqlToRun: string) => {
      if (!sqlToRun.trim()) return
      setExecuting(true)
      setError(null)
      setResult(null)
      try {
        const res = await api['db:executeQuery']({
          connectionId: connection.id,
          sql: sqlToRun,
        })
        setResult(res)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setExecuting(false)
      }
    },
    [connection.id],
  )

  const exportCsv = () => {
    if (!result) return
    const headers = result.columns.map((c: { name: string; dataType: string }) => c.name).join(',')
    const lines = result.rows.map((row: Record<string, unknown>) =>
      result.columns
        .map((c) => {
          const v = row[c.name]
          if (v === null) return ''
          const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s
        })
        .join(','),
    )
    const csv = [headers, ...lines].join('\n')
    download(`${connection.name}-query.csv`, csv, 'text/csv')
    setExportOpen(false)
  }

  const exportJson = () => {
    if (!result) return
    const json = JSON.stringify(result.rows, null, 2)
    download(`${connection.name}-query.json`, json, 'application/json')
    setExportOpen(false)
  }

  const copyResult = async () => {
    if (!result) return
    const headers = result.columns.map((c: { name: string; dataType: string }) => c.name).join('\t')
    const lines = result.rows.map((row: Record<string, unknown>) =>
      result.columns
        .map((c: { name: string; dataType: string }) =>
          (row[c.name] === null ? '' : String(row[c.name])).replace(/\t/g, ' '),
        )
        .join('\t'),
    )
    await navigator.clipboard.writeText([headers, ...lines].join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    setExportOpen(false)
  }

  const dialect =
    connection.type === 'postgres'
      ? 'postgresql'
      : connection.type === 'sqlite'
        ? 'sqlite'
        : 'mysql'

  return (
    <div className="sql-workspace">
      <div className="workspace-header">
        <h2>📝 SQL 查询 · {connection.name}</h2>
      </div>

      <SqlEditor
        value={sql}
        onChange={setSql}
        onExecute={handleExecute}
        executing={executing}
        dialect={dialect}
      />

      {error && (
        <div className="result-error">
          <strong>执行错误</strong>
          <pre>{error}</pre>
        </div>
      )}

      {result && (
        <div className="result-section">
          <div className="result-toolbar">
            <span className="result-info">
              {result.rowCount} 行{result.durationMs > 0 && ` · ${result.durationMs}ms`}
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

      <SqlHistory connectionId={connection.id} onPick={(sql) => setSql(sql)} />

      {!result && !error && !executing && (
        <div className="result-placeholder">
          <p>执行查询后结果将显示在这里</p>
        </div>
      )}
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
