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
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState<number | null>(null)

  const qualifiedName = useMemo(() => {
    if (connection.type === 'postgres' && schema) return `"${schema}"."${tableName}"`
    if (connection.type === 'sqlite') return `"${tableName}"`
    return '`' + tableName + '`'
  }, [connection.type, schema, tableName])

  const quoteIdentifier = useCallback(
    (name: string) => {
      if (connection.type === 'postgres' || connection.type === 'sqlite') {
        return '"' + name.replace(/"/g, '""') + '"'
      }
      return '`' + name.replace(/`/g, '``') + '`'
    },
    [connection.type],
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setChanges(new Map())
    setCommitLog(null)
    setSelectedRowKey(null)
    try {
      const meta = await api['db:describeTable']({
        connectionId: connection.id,
        schema,
        table: tableName,
      })
      const offset = (page - 1) * pageSize
      const sql = `SELECT * FROM ${qualifiedName} LIMIT ${pageSize} OFFSET ${offset}`
      const res = await api['db:executeQuery']({
        connectionId: connection.id,
        sql,
        limit: pageSize,
      })
      const columns =
        res.columns.length > 0
          ? res.columns
          : meta.columns.map((col) => ({ name: col.name, dataType: col.dataType }))
      const rowsWithKey = res.rows.map((row, i) => ({
        ...row,
        __row_key__: offset + i,
      }))
      setResult({ ...res, columns, rows: rowsWithKey })

      // 获取总行数（用于分页信息）
      try {
        const countRes = await api['db:executeQuery']({
          connectionId: connection.id,
          sql: `SELECT COUNT(*) AS cnt FROM ${qualifiedName}`,
          limit: 1,
        })
        const cnt = countRes.rows[0]?.['cnt']
        setTotalCount(typeof cnt === 'number' ? cnt : Number(cnt) || null)
      } catch {
        setTotalCount(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [connection.id, qualifiedName, schema, tableName, page, pageSize])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换表时加载数据
    loadData()
  }, [loadData])

  // 切换表时重置到第一页
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换表时重置分页
    setPage(1)
  }, [qualifiedName])

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
  const handleCellChange = (rowKey: string | number, column: string, value: string) => {
    const rowKeyNumber = Number(rowKey)
    if (Number.isNaN(rowKeyNumber)) return
    // insert 行的特殊处理
    if (rowKeyNumber < 0) {
      setChanges((prev) => {
        const next = new Map(prev)
        const ch = next.get(rowKeyNumber)
        if (ch && ch.type === 'insert') {
          ch.newValues = { ...ch.newValues, [column]: value }
        }
        return next
      })
      return
    }
    setChanges((prev) => {
      const next = new Map(prev)
      const existing = next.get(rowKeyNumber)
      const originalRow = result?.rows.find((row) => row.__row_key__ === rowKeyNumber)
      const originalValue = originalRow?.[column]
      const normalizedOriginal =
        originalValue === null || originalValue === undefined ? '' : String(originalValue)
      if (existing && existing.type === 'update') {
        const values = { ...existing.values }
        if (value === normalizedOriginal) {
          delete values[column]
        } else {
          values[column] = value
        }
        if (Object.keys(values).length === 0) {
          next.delete(rowKeyNumber)
        } else {
          existing.values = values
        }
      } else {
        if (value === normalizedOriginal) return next
        const original: Record<string, unknown> = {}
        if (originalRow) {
          for (const k of Object.keys(originalRow)) {
            if (k !== '__row_key__') original[k] = originalRow[k]
          }
        }
        next.set(rowKeyNumber, {
          type: 'update',
          rowKey: rowKeyNumber,
          values: { [column]: value },
          original,
        })
      }
      return next
    })
  }

  /** 新增空行（追加到顶部） */
  const handleAddRow = () => {
    setChanges((prev) => {
      const next = new Map(prev)
      const newKey = -1 * Math.floor(Math.random() * 1000000) - 1
      const newValues: Record<string, string> = {}
      result?.columns.forEach((col) => (newValues[col.name] = ''))
      next.set(newKey, { type: 'insert', rowKey: newKey, newValues })
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
    const originalRow = result?.rows.find((row) => row.__row_key__ === rowKey)
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
      const originalRow = result?.rows.find((row) => row.__row_key__ === rowKey)
      if (originalRow) {
        const updateValues = changes.get(rowKey)?.values ?? {}
        for (const [k, v] of Object.entries(originalRow)) {
          if (k !== '__row_key__') {
            const currentValue = updateValues[k] ?? v
            sourceValues[k] = currentValue === null ? '' : String(currentValue)
          }
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
          const colSql = cols.map((k) => quoteIdentifier(k)).join(', ')
          const vals = cols.map((k) => escapeSqlValue(change.newValues![k] as string)).join(', ')
          stmts.push(`INSERT INTO ${qualifiedName} (${colSql}) VALUES (${vals})`)
        } else if (change.type === 'update' && change.values && change.original) {
          const sets = Object.entries(change.values)
            .map(([k, v]) => quoteIdentifier(k) + ' = ' + escapeSqlValue(v))
            .join(', ')
          const where = buildWhereClause(change.original, quoteIdentifier)
          stmts.push(`UPDATE ${qualifiedName} SET ${sets} WHERE ${where}`)
        } else if (change.type === 'delete' && change.original) {
          const where = buildWhereClause(change.original, quoteIdentifier)
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

  // 合并未提交变更到显示数据：update 立即覆盖显示值，insert 按 afterRowIndex 就近显示。
  const displayResult = useMemo(() => {
    if (!result) return null
    if (changes.size === 0) return result

    const updateChanges = [...changes.values()].filter((c) => c.type === 'update')
    const updateByRowKey = new Map(updateChanges.map((c) => [c.rowKey, c]))
    const rows = result.rows.map((row) => {
      const rowKey = Number(row.__row_key__)
      const change = updateByRowKey.get(rowKey)
      if (!change?.values) return row
      return { ...row, ...change.values }
    })

    const topInsertRows: Record<string, unknown>[] = []
    const insertRowsByAfterKey = new Map<number, Record<string, unknown>[]>()

    for (const change of changes.values()) {
      if (change.type !== 'insert') continue
      const row: Record<string, unknown> = { __row_key__: change.rowKey }
      if (change.newValues) for (const [k, v] of Object.entries(change.newValues)) row[k] = v

      if (change.afterRowIndex === undefined) {
        topInsertRows.push(row)
      } else {
        const existing = insertRowsByAfterKey.get(change.afterRowIndex) ?? []
        existing.push(row)
        insertRowsByAfterKey.set(change.afterRowIndex, existing)
      }
    }

    const orderedRows: Record<string, unknown>[] = [...topInsertRows]
    for (const row of rows) {
      orderedRows.push(row)
      const rowKey = Number(row.__row_key__)
      const insertRows = insertRowsByAfterKey.get(rowKey)
      if (insertRows) orderedRows.push(...insertRows)
    }

    return { ...result, rows: orderedRows } as QueryResult
  }, [result, changes])

  const hasChanges = changes.size > 0
  const totalPages = Math.max(1, totalCount !== null ? Math.ceil(totalCount / pageSize) : page + 1)

  return (
    <div className="table-data-view">
      {/* 工具栏（无标题） */}
      <div className="table-data-toolbar-bar">
        <abbr title={hasChanges ? '提交 ' + changes.size + ' 个变更' : '无变更可提交'}>
          <button
            className="icon-btn"
            onClick={handleCommit}
            disabled={!hasChanges || committing}
            style={{ color: hasChanges ? 'var(--success)' : undefined }}
          >
            {committing ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
          </button>
        </abbr>
        <abbr title="撤回所有变更">
          <button className="icon-btn" onClick={handleRollback} disabled={!hasChanges}>
            <Undo2 size={14} />
          </button>
        </abbr>
        <abbr title="新增空行">
          <button className="icon-btn" onClick={handleAddRow}>
            <Plus size={14} />
          </button>
        </abbr>
        <div className="toolbar-spacer" />
        <abbr title="刷新数据">
          <button className="icon-btn" onClick={loadData} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </abbr>
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
        </div>
      )}

      {/* 底部悬浮分页工具条（DataGrip 风格灵动岛） */}
      {displayResult && !loading && !error && (
        <div className="pagination-bar">
          <div className="pagination-info">
            {hasChanges && <span className="changes-badge">{changes.size} 变更</span>}
            <span className="pagination-count">
              {totalCount !== null
                ? `共 ${totalCount.toLocaleString()} 行`
                : `${result?.rowCount ?? 0} 行`}
              {result && result.durationMs > 0 && ` · ${result.durationMs}ms`}
            </span>
          </div>
          <div className="pagination-controls">
            <label className="pagination-size">
              每页
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(1)
                }}
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
              </select>
            </label>
            <button
              className="pagination-btn"
              onClick={() => setPage(1)}
              disabled={page <= 1}
              title="第一页"
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              className="pagination-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              title="上一页"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="pagination-page">
              <input
                className="pagination-page-input"
                type="number"
                value={page}
                min={1}
                max={totalPages}
                onChange={(e) => {
                  const p = Number(e.target.value)
                  if (p >= 1 && p <= totalPages) setPage(p)
                }}
              />
              / {totalPages}
            </span>
            <button
              className="pagination-btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              title="下一页"
            >
              <ChevronRight size={14} />
            </button>
            <button
              className="pagination-btn"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              title="最后一页"
            >
              <ChevronsRight size={14} />
            </button>
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

function buildWhereClause(
  original: Record<string, unknown>,
  quoteIdentifier: (name: string) => string,
): string {
  const conds = Object.entries(original)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      const sv = typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"
      return quoteIdentifier(k) + ' = ' + sv
    })
  return conds.length > 0 ? conds.join(' AND ') : '1=1'
}
