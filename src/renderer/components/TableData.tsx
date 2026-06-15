/**
 * 表数据浏览与编辑组件（Excel 风格）
 *
 * - 双击单元格直接编辑（无需「编辑」按钮）
 * - 顶部工具栏：提交(N)/撤回/刷新，未修改时提交撤回禁用
 * - 第一列序号：点击选中整行，右键菜单（删除/复制/插入）
 * - 脏行黄色高亮
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Check,
  Undo2,
  Trash2,
  Copy,
  ArrowDownToLine,
} from 'lucide-react'
import { api, type ConnectionListItem, type QueryResult } from '../api'
import { DataGrid } from './DataGrid'

interface TableDataProps {
  connection: ConnectionListItem
  schema?: string
  tableName: string
}

type ChangeType = 'update' | 'insert' | 'delete'

interface Change {
  type: ChangeType
  rowKey: number
  values?: Record<string, string>
  original?: Record<string, unknown>
  newValues?: Record<string, string>
  afterRowIndex?: number
}

/** 右键菜单 */
interface RowContextMenu {
  x: number
  y: number
  rowKey: number
  rowIndex: number
  isInsertRow: boolean
}

export function TableData({ connection, schema, tableName }: TableDataProps) {
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [changes, setChanges] = useState<Map<number, Change>>(new Map())
  const [selectedRowKey, setSelectedRowKey] = useState<number | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitLog, setCommitLog] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<RowContextMenu | null>(null)

  const qualifiedName = useMemo(() => {
    if (connection.type === 'postgres' && schema) return `"${schema}"."${tableName}"`
    if (connection.type === 'sqlite') return `"${tableName}"`
    return '`' + tableName + '`'
  }, [connection.type, schema, tableName])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setChanges(new Map())
    setCommitLog(null)
    setSelectedRowKey(null)
    try {
      const sql = `SELECT * FROM ${qualifiedName} LIMIT 100`
      const res = await api['db:executeQuery']({ connectionId: connection.id, sql, limit: 100 })
      const rowsWithKey = res.rows.map((row, i) => ({ ...row, __row_key__: i }))
      setResult({ ...res, rows: rowsWithKey })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [connection.id, qualifiedName])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换表时加载数据
    loadData()
  }, [loadData])

  // 关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [ctxMenu])

  /** 双击编辑回调 */
  const handleCellChange = (rowIndex: number, column: string, value: string) => {
    // insert 行的特殊处理
    if (rowIndex < 0) {
      setChanges((prev) => {
        const next = new Map(prev)
        const ch = next.get(rowIndex)
        if (ch && ch.type === 'insert') {
          ch.newValues = { ...ch.newValues, [column]: value }
        }
        return next
      })
      return
    }
    setChanges((prev) => {
      const next = new Map(prev)
      const existing = next.get(rowIndex)
      const originalRow = result?.rows[rowIndex]
      if (existing && existing.type === 'update') {
        existing.values = { ...existing.values, [column]: value }
      } else {
        const original: Record<string, unknown> = {}
        if (originalRow) {
          for (const k of Object.keys(originalRow)) {
            if (k !== '__row_key__') original[k] = originalRow[k]
          }
        }
        next.set(rowIndex, {
          type: 'update',
          rowKey: rowIndex,
          values: { [column]: value },
          original,
        })
      }
      return next
    })
  }

  /** 在指定行后插入新行 */
  const insertRowAfter = (afterRowIndex: number) => {
    setChanges((prev) => {
      const next = new Map(prev)
      const newKey = -1 * Math.floor(Math.random() * 1000000) - 1
      const newValues: Record<string, string> = {}
      result?.columns.forEach((c) => (newValues[c.name] = ''))
      next.set(newKey, { type: 'insert', rowKey: newKey, newValues, afterRowIndex })
      return next
    })
  }

  /** 删除行 */
  const deleteRow = (rowKey: number) => {
    // insert 行直接移除
    if (rowKey < 0) {
      setChanges((prev) => {
        const next = new Map(prev)
        next.delete(rowKey)
        return next
      })
      return
    }
    const originalRow = result?.rows[rowKey]
    if (!originalRow) return
    const original: Record<string, unknown> = {}
    for (const k of Object.keys(originalRow)) {
      if (k !== '__row_key__') original[k] = originalRow[k]
    }
    setChanges((prev) => {
      const next = new Map(prev)
      next.set(rowKey, { type: 'delete', rowKey, original })
      return next
    })
  }

  /** 复制行（在原行后插入一份相同数据的 insert） */
  const duplicateRow = (rowKey: number) => {
    let sourceValues: Record<string, string> = {}
    if (rowKey < 0) {
      const ch = changes.get(rowKey)
      if (ch?.newValues) sourceValues = { ...ch.newValues }
    } else {
      const originalRow = result?.rows[rowKey]
      if (originalRow) {
        for (const [k, v] of Object.entries(originalRow)) {
          if (k !== '__row_key__') sourceValues[k] = v === null ? '' : String(v)
        }
      }
    }
    setChanges((prev) => {
      const next = new Map(prev)
      const newKey = -1 * Math.floor(Math.random() * 1000000) - 1
      next.set(newKey, {
        type: 'insert',
        rowKey: newKey,
        newValues: sourceValues,
        afterRowIndex: rowKey,
      })
      return next
    })
  }

  /** 序号列右键菜单 */
  const handleRowContextMenu = (e: React.MouseEvent, rowKey: number) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedRowKey(rowKey)
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      rowKey,
      rowIndex: rowKey,
      isInsertRow: rowKey < 0,
    })
  }

  /** 提交 */
  const handleCommit = async () => {
    if (changes.size === 0) return
    setCommitting(true)
    setCommitLog(null)
    try {
      const stmts: string[] = []
      changes.forEach((change) => {
        if (change.type === 'insert' && change.newValues) {
          const cols = Object.keys(change.newValues).filter((k) => change.newValues![k] !== '')
          if (cols.length === 0) return
          const vals = cols.map((k) => escapeSqlValue(change.newValues![k] as string)).join(', ')
          stmts.push(`INSERT INTO ${qualifiedName} (${cols.join(', ')}) VALUES (${vals})`)
        } else if (change.type === 'update' && change.values && change.original) {
          const sets = Object.entries(change.values)
            .map(([k, v]) => quoteIdent(k) + ' = ' + escapeSqlValue(v))
            .join(', ')
          const where = buildWhereClause(change.original)
          stmts.push(`UPDATE ${qualifiedName} SET ${sets} WHERE ${where}`)
        } else if (change.type === 'delete' && change.original) {
          const where = buildWhereClause(change.original)
          stmts.push(`DELETE FROM ${qualifiedName} WHERE ${where}`)
        }
      })

      const results: string[] = []
      for (const stmt of stmts) {
        const check = await api['db:checkSql']({ connectionId: connection.id, sql: stmt })
        if (check.denied) {
          results.push('✗ 拒绝: ' + check.reason)
          break
        }
        try {
          await api['db:confirmExecute']({ connectionId: connection.id, sql: stmt })
          results.push('✓ ' + stmt.slice(0, 60))
        } catch (err) {
          results.push('✗ ' + (err instanceof Error ? err.message : String(err)))
        }
      }

      setCommitLog(results.join('\n'))
      await loadData()
    } catch (err) {
      setCommitLog('提交失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCommitting(false)
    }
  }

  /** 撤回 */
  const handleRollback = () => {
    setChanges(new Map())
    setSelectedRowKey(null)
    setCommitLog(null)
  }

  const dirtyRowKeys = useMemo(() => new Set(changes.keys()), [changes])

  // 合并 insert 行到显示数据（按 afterRowIndex 插入）
  const displayResult = useMemo(() => {
    if (!result) return null
    const insertChanges = [...changes.values()].filter((c) => c.type === 'insert')
    if (insertChanges.length === 0) return result
    // 简单追加到顶部
    const insertRows = insertChanges.map((c) => {
      const row: Record<string, unknown> = { __row_key__: c.rowKey }
      if (c.newValues) for (const [k, v] of Object.entries(c.newValues)) row[k] = v
      return row
    })
    return { ...result, rows: [...insertRows, ...result.rows] } as QueryResult
  }, [result, changes])

  const hasChanges = changes.size > 0

  return (
    <div className="table-data-view">
      {/* 工具栏（无标题） */}
      <div className="table-data-toolbar-bar">
        <button
          className="btn btn-sm"
          style={{
            background: hasChanges ? 'var(--success)' : 'var(--bg-hover)',
            color: hasChanges ? 'white' : 'var(--text-muted)',
            border: '1px solid transparent',
            opacity: hasChanges ? 1 : 0.5,
          }}
          onClick={handleCommit}
          disabled={!hasChanges || committing}
          title="提交所有变更"
        >
          {committing ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
          提交 {hasChanges ? `(${changes.size})` : ''}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleRollback}
          disabled={!hasChanges}
          title="撤回所有未提交变更"
          style={{ opacity: hasChanges ? 1 : 0.5 }}
        >
          <Undo2 size={12} /> 撤回
        </button>
        <div className="toolbar-spacer" />
        <button className="btn btn-secondary btn-sm" onClick={loadData} disabled={loading}>
          {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
          刷新
        </button>
      </div>

      {loading && (
        <div className="detail-loading">
          <Loader2 size={16} className="spin" /> 加载数据…
        </div>
      )}

      {error && (
        <div className="detail-error">
          <AlertCircle size={14} style={{ display: 'inline', marginRight: 4 }} />
          {error}
        </div>
      )}

      {displayResult && !loading && !error && (
        <div className="table-data-grid-wrapper">
          <DataGrid
            result={displayResult}
            editable
            dirtyRowKeys={dirtyRowKeys}
            onCellChange={handleCellChange}
            selectedRowKey={selectedRowKey}
            onSelectRow={(k) => setSelectedRowKey(typeof k === 'number' ? k : Number(k))}
            onRowContextMenu={handleRowContextMenu}
          />
          <div className="table-data-footer">
            {result?.rowCount ?? 0} 行（最多显示 100 行）
            {result && result.durationMs > 0 && ` · ${result.durationMs}ms`}
            {hasChanges && <span className="changes-badge">{changes.size} 个未提交变更</span>}
          </div>
        </div>
      )}

      {commitLog && (
        <div className="commit-log">
          <pre>{commitLog}</pre>
        </div>
      )}

      {/* 行右键菜单 */}
      {ctxMenu && (
        <div
          className="context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="ctx-item"
            onClick={() => {
              duplicateRow(ctxMenu.rowKey)
              setCtxMenu(null)
            }}
          >
            <Copy size={12} /> 复制行
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              insertRowAfter(ctxMenu.rowKey)
              setCtxMenu(null)
            }}
          >
            <ArrowDownToLine size={12} /> 插入行
          </button>
          <div className="ctx-divider" />
          <button
            className="ctx-item ctx-danger"
            onClick={() => {
              deleteRow(ctxMenu.rowKey)
              setCtxMenu(null)
            }}
          >
            <Trash2 size={12} /> 删除行
          </button>
        </div>
      )}
    </div>
  )
}

function escapeSqlValue(v: string): string {
  if (v === '' || v.toLowerCase() === 'null') return 'NULL'
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  return "'" + v.replace(/'/g, "''") + "'"
}

function quoteIdent(name: string): string {
  return '`' + name + '`'
}

function buildWhereClause(original: Record<string, unknown>): string {
  const conds = Object.entries(original)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      const sv = typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"
      return quoteIdent(k) + ' = ' + sv
    })
  return conds.length > 0 ? conds.join(' AND ') : '1=1'
}
