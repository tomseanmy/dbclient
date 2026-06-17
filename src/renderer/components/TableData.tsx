/**
 * 表数据浏览与编辑组件（Excel 风格）
 *
 * - 单击单元格选中（蓝色高亮），双击进入编辑
 * - 单元格右键：编辑/复制/粘贴/设为NULL/添加到筛选
 * - 序号列右键：复制行/插入行/删除行
 * - 工具栏：刷新/自动更新/分隔线/添加行/删除行/撤销/提交 | 导入/导出
 * - 脏行黄色高亮
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
  Minus,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Download,
  Upload,
  ClipboardPaste,
  CircleSlash,
  Filter,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { translateReason } from '@shared/i18n/composite'
import { api, type ConnectionListItem, type QueryResult, type TableMeta } from '../api'
import { DataGrid } from './DataGrid'
import { useTabStore } from '../store/tabs'
import { exportResultCsv, exportResultJson } from '../lib/export'

interface TableDataProps {
  connection: ConnectionListItem
  schema?: string
  tableName: string
  /** 所属 tab 的 id，用于上报脏状态（未提交修改） */
  tabId: string
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

/** 行右键菜单 */
interface RowContextMenu {
  x: number
  y: number
  rowKey: number
  isInsertRow: boolean
  /**
   * 右键落点位于多选集内时，记录当时的多选集合；
   * 删除项将作用于这些行（macOS 语义：右键不改变多选）。
   * 单行情况为 undefined。
   */
  selectedKeys?: number[]
}

/** 单元格右键菜单 */
interface CellContextMenu {
  x: number
  y: number
  rowKey: number
  column: string
  value: unknown
  isInsertRow: boolean
}

const AUTO_REFRESH_OPTIONS = [
  { labelKey: 'tableData.autoRefreshOff', value: 0 },
  { label: '5s', value: 5 },
  { label: '10s', value: 10 },
]

export function TableData({ connection, schema, tableName, tabId }: TableDataProps) {
  const { t } = useTranslation()
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<TableMeta | null>(null)
  const [changes, setChanges] = useState<Map<number, Change>>(new Map())
  // 行选中：支持多选（Cmd/Ctrl 增选、Shift 区间）。空 Set 表示无选中。
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<number>>(new Set())
  const [selectedCell, setSelectedCell] = useState<{
    rowKey: string | number
    column: string
  } | null>(null)
  /** 受控编辑态：双击与右键「编辑」共用，驱动 DataGrid 进入行内编辑 */
  const [editingCell, setEditingCell] = useState<{
    rowKey: string | number
    column: string
  } | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitLog, setCommitLog] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<RowContextMenu | null>(null)
  const [cellCtxMenu, setCellCtxMenu] = useState<CellContextMenu | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [autoRefresh, setAutoRefresh] = useState(0)
  const [autoRefreshOpen, setAutoRefreshOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const qualifiedName = useMemo(() => {
    if (connection.type === 'postgres') {
      return schema ? `"${schema}"."${tableName}"` : `"${tableName}"`
    }
    if (connection.type === 'sqlite') return `"${tableName}"`
    // MySQL：schema 可能与默认库不同，需带上 schema 前缀
    if (connection.type === 'mysql' && schema) return `\`${schema}\`.\`${tableName}\``
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

  // 构建 WHERE 子句（来自列筛选）
  const whereClause = useMemo(() => {
    const entries = Object.entries(filters).filter(([, v]) => v !== '')
    if (entries.length === 0) return ''
    const conds = entries.map(([col, val]) => {
      return `${quoteIdentifier(col)} = ${escapeSqlValue(val)}`
    })
    return ' WHERE ' + conds.join(' AND ')
  }, [filters, quoteIdentifier])

  /** 列元信息映射（主键/可空），供 DataGrid 列头显示类型 icon */
  const columnMeta = useMemo(() => {
    const map: Record<string, { isPrimaryKey?: boolean; nullable?: boolean }> = {}
    for (const col of meta?.columns ?? []) {
      map[col.name] = { isPrimaryKey: col.isPrimaryKey, nullable: col.nullable }
    }
    return map
  }, [meta])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setChanges(new Map())
    setCommitLog(null)
    setSelectedRowKeys(new Set())
    setSelectedCell(null)
    setEditingCell(null)
    try {
      const tableMeta = await api['db:describeTable']({
        connectionId: connection.id,
        schema,
        table: tableName,
      })
      setMeta(tableMeta)
      const offset = (page - 1) * pageSize
      const sql = `SELECT * FROM ${qualifiedName}${whereClause} LIMIT ${pageSize} OFFSET ${offset}`
      const res = await api['db:executeQuery']({
        connectionId: connection.id,
        sql,
        limit: pageSize,
      })
      const columns =
        res.columns.length > 0
          ? res.columns
          : tableMeta.columns.map((col) => ({ name: col.name, dataType: col.dataType }))
      const rowsWithKey = res.rows.map((row, i) => ({
        ...row,
        __row_key__: offset + i,
      }))
      setResult({ ...res, columns, rows: rowsWithKey })

      // 获取总行数（用于分页信息）
      try {
        const countRes = await api['db:executeQuery']({
          connectionId: connection.id,
          sql: `SELECT COUNT(*) AS cnt FROM ${qualifiedName}${whereClause}`,
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
  }, [connection.id, qualifiedName, schema, tableName, page, pageSize, whereClause])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换表时加载数据
    loadData()
  }, [loadData])

  // 切换表时重置到第一页 + 清除筛选
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换表时重置
    setPage(1)
    setFilters({})
  }, [qualifiedName])

  // 自动刷新
  useEffect(() => {
    if (autoRefresh <= 0) return
    const timer = setInterval(() => {
      loadData()
    }, autoRefresh * 1000)
    return () => clearInterval(timer)
  }, [autoRefresh, loadData])

  // 关闭右键菜单（行 + 单元格）
  useEffect(() => {
    if (!ctxMenu && !cellCtxMenu) return
    const close = () => {
      setCtxMenu(null)
      setCellCtxMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [ctxMenu, cellCtxMenu])

  /** 单元格编辑回调 */
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

  /** 删除行（工具栏按钮：优先删选中单元格所在行，否则删所有选中行） */
  const handleDeleteRow = () => {
    if (selectedCell) {
      deleteRow(Number(selectedCell.rowKey))
      return
    }
    if (selectedRowKeys.size === 0) return
    // 复制一份再清空选中，避免 deleteRow 内部依赖选中态
    const keys = Array.from(selectedRowKeys)
    setSelectedRowKeys(new Set())
    for (const k of keys) deleteRow(k)
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

  /** 序号列右键菜单（多选语义：落点在已选集内时保持多选，否则聚焦单选该行） */
  const handleRowContextMenu = (e: React.MouseEvent, rowKey: number) => {
    e.preventDefault()
    e.stopPropagation()
    // 右键不改变已有选择：若落点不在选中集中，则聚焦单选该行
    let activeSelectedKeys: number[] | undefined
    if (selectedRowKeys.has(rowKey) && selectedRowKeys.size > 1) {
      activeSelectedKeys = Array.from(selectedRowKeys)
    } else {
      // 落点不在多选集中：单选该行
      setSelectedRowKeys(new Set([rowKey]))
    }
    setCellCtxMenu(null)
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      rowKey,
      isInsertRow: rowKey < 0,
      selectedKeys: activeSelectedKeys,
    })
  }

  /** 单元格右键菜单 */
  const handleCellContextMenu = (
    e: React.MouseEvent,
    rowKey: string | number,
    column: string,
    value: unknown,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedCell({ rowKey, column })
    setCtxMenu(null)
    setCellCtxMenu({
      x: e.clientX,
      y: e.clientY,
      rowKey: Number(rowKey),
      column,
      value,
      isInsertRow: Number(rowKey) < 0,
    })
  }

  /** 单元格右键：设为 NULL */
  const handleSetNull = () => {
    if (!cellCtxMenu) return
    handleCellChange(cellCtxMenu.rowKey, cellCtxMenu.column, 'NULL')
    setCellCtxMenu(null)
  }

  /** 单元格右键：粘贴 */
  const handlePasteCell = async () => {
    if (!cellCtxMenu) return
    try {
      const text = await navigator.clipboard.readText()
      handleCellChange(cellCtxMenu.rowKey, cellCtxMenu.column, text)
    } catch {
      // 剪贴板读取失败忽略
    }
    setCellCtxMenu(null)
  }

  /** 单元格右键：复制值 */
  const handleCopyValue = () => {
    if (!cellCtxMenu) return
    const v = cellCtxMenu.value
    const text =
      v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    navigator.clipboard.writeText(text).catch(() => {})
    setCellCtxMenu(null)
  }

  /** 单元格右键：添加到筛选 */
  const handleAddFilter = () => {
    if (!cellCtxMenu) return
    const v = cellCtxMenu.value
    const text =
      v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    setFilters((prev) => ({ ...prev, [cellCtxMenu.column]: text }))
    setPage(1)
    setCellCtxMenu(null)
  }

  /** 列头筛选输入：列名 -> 值（空串清除该列筛选） */
  const handleHeaderFilter = (column: string, value: string) => {
    setFilters((prev) => ({ ...prev, [column]: value }))
    setPage(1)
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
          results.push(t('tableData.commitDenied', { reason: translateReason(check.reason, t) }))
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
      setCommitLog(
        t('tableData.commitFailed', { error: err instanceof Error ? err.message : String(err) }),
      )
    } finally {
      setCommitting(false)
    }
  }

  /** 撤回 */
  const handleRollback = () => {
    setChanges(new Map())
    setSelectedRowKeys(new Set())
    setSelectedCell(null)
    setEditingCell(null)
    setCommitLog(null)
  }

  /** 导出 CSV */
  const exportCsv = () => {
    if (!result) return
    exportResultCsv(tableName + '.csv', result)
    setExportOpen(false)
  }

  /** 导出 JSON */
  const exportJson = () => {
    if (!result) return
    exportResultJson(tableName + '.json', result)
    setExportOpen(false)
  }

  const dirtyRowKeys = useMemo(() => new Set(changes.keys()), [changes])

  // 合并未提交变更到显示数据
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
  const hasFilter = Object.values(filters).some((v) => v !== '')

  // 上报脏状态到 tab store（用于「关闭未编辑 Tab」）
  const setTabDirty = useTabStore((s) => s.setDirty)
  useEffect(() => {
    setTabDirty(tabId, hasChanges)
  }, [tabId, hasChanges, setTabDirty])

  return (
    <div className="table-data-view">
      {/* 工具栏 */}
      <div className="table-data-toolbar-bar">
        {/* 刷新 */}
        <abbr title={t('tableData.refreshData')}>
          <button className="icon-btn" onClick={loadData} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </abbr>

        {/* 自动更新 */}
        <div className="auto-refresh-wrapper">
          <abbr title={t('tableData.autoRefresh')}>
            <button
              className={`icon-btn ${autoRefresh > 0 ? 'icon-btn-active' : ''}`}
              onClick={() => setAutoRefreshOpen((v) => !v)}
            >
              <Clock size={14} />
              {autoRefresh > 0 && <span className="auto-refresh-label">{autoRefresh}s</span>}
            </button>
          </abbr>
          {autoRefreshOpen && (
            <div className="auto-refresh-menu" onClick={(e) => e.stopPropagation()}>
              {AUTO_REFRESH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`ctx-item ${autoRefresh === opt.value ? 'ctx-item-active' : ''}`}
                  onClick={() => {
                    setAutoRefresh(opt.value)
                    setAutoRefreshOpen(false)
                  }}
                >
                  {opt.labelKey ? t(opt.labelKey) : opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 竖分隔线 */}
        <div className="toolbar-divider" />

        {/* 添加行 */}
        <abbr title={t('tableData.addRow')}>
          <button className="icon-btn" onClick={handleAddRow}>
            <Plus size={14} />
          </button>
        </abbr>

        {/* 删除行 */}
        <abbr title={t('tableData.deleteSelectedRows')}>
          <button
            className="icon-btn"
            onClick={handleDeleteRow}
            disabled={selectedRowKeys.size === 0 && selectedCell === null}
          >
            <Minus size={14} />
          </button>
        </abbr>

        {/* 撤销修改 */}
        <abbr title={t('tableData.undoAll')}>
          <button className="icon-btn" onClick={handleRollback} disabled={!hasChanges}>
            <Undo2 size={14} />
          </button>
        </abbr>

        {/* 提交 */}
        <abbr
          title={
            hasChanges
              ? t('tableData.commitHint', { count: changes.size })
              : t('tableData.noChanges')
          }
        >
          <button
            className="icon-btn"
            onClick={handleCommit}
            disabled={!hasChanges || committing}
            style={{ color: hasChanges ? 'var(--success)' : undefined }}
          >
            {committing ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
          </button>
        </abbr>

        <div className="toolbar-spacer" />

        {/* 导入（占位） */}
        <abbr title={t('tableData.importData')}>
          <button className="icon-btn" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} />
          </button>
        </abbr>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json"
          style={{ display: 'none' }}
          onChange={() => {
            // 导入暂未实现
          }}
        />

        {/* 导出 */}
        <div className="export-wrapper">
          <abbr title={t('tableData.exportData')}>
            <button className="icon-btn" onClick={() => setExportOpen((v) => !v)}>
              <Download size={14} />
            </button>
          </abbr>
          {exportOpen && (
            <div className="export-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={exportCsv}>CSV</button>
              <button onClick={exportJson}>JSON</button>
            </div>
          )}
        </div>
      </div>

      {/* 筛选标记条 */}
      {hasFilter && (
        <div className="filter-bar">
          <Filter size={12} />
          <span>{t('tableData.filtered')}</span>
          {Object.entries(filters)
            .filter(([, v]) => v !== '')
            .map(([col, val]) => (
              <span key={col} className="filter-chip">
                {col} = {val}
                <button
                  className="filter-chip-remove"
                  onClick={() => setFilters((prev) => ({ ...prev, [col]: '' }))}
                >
                  ×
                </button>
              </span>
            ))}
          <button className="filter-clear" onClick={() => setFilters({})}>
            {t('tableData.clearAll')}
          </button>
        </div>
      )}

      {loading && (
        <div className="detail-loading">
          <Loader2 size={16} className="spin" /> {t('tableData.loadingData')}
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
            selectedRowKeys={selectedRowKeys}
            onSelectRows={(keys) => {
              // 选中整行时清除单元格选中（保持两者互斥）
              if (keys.size > 0) setSelectedCell(null)
              setSelectedRowKeys(new Set(Array.from(keys).map((k) => Number(k))))
            }}
            onRowContextMenu={handleRowContextMenu}
            selectedCell={selectedCell}
            onSelectCell={setSelectedCell}
            onCellContextMenu={handleCellContextMenu}
            editing={editingCell}
            onEditingChange={setEditingCell}
            columnMeta={columnMeta}
            filters={filters}
            onFilterChange={handleHeaderFilter}
            bottomPadding={150}
          />
        </div>
      )}

      {/* 底部悬浮分页工具条 */}
      {displayResult && !loading && !error && (
        <div className="pagination-bar">
          <div className="pagination-info">
            {hasChanges && (
              <span className="changes-badge">
                {t('tableData.changesBadge', { count: changes.size })}
              </span>
            )}
            <span className="pagination-count">
              {totalCount !== null
                ? t('tableData.totalRows', { count: totalCount.toLocaleString() })
                : t('tableData.rowCount', { count: result?.rowCount ?? 0 })}
              {result && result.durationMs > 0 && ` · ${result.durationMs}ms`}
            </span>
          </div>
          <div className="pagination-controls">
            <label className="pagination-size">
              {t('tableData.perPage')}
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
              title={t('tableData.firstPage')}
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              className="pagination-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              title={t('tableData.prevPage')}
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
              title={t('tableData.nextPage')}
            >
              <ChevronRight size={14} />
            </button>
            <button
              className="pagination-btn"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              title={t('tableData.lastPage')}
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
            <Copy size={12} /> {t('tableData.ctxDuplicateRow')}
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              insertRowAfter(ctxMenu.rowKey)
              setCtxMenu(null)
            }}
          >
            <ArrowDownToLine size={12} /> {t('tableData.ctxInsertRow')}
          </button>
          <div className="ctx-divider" />
          <button
            className="ctx-item ctx-danger"
            onClick={() => {
              const keys = ctxMenu.selectedKeys ?? [ctxMenu.rowKey]
              setSelectedRowKeys(new Set())
              for (const k of keys) deleteRow(k)
              setCtxMenu(null)
            }}
          >
            <Trash2 size={12} /> {t('tableData.ctxDeleteRow')}
            {ctxMenu.selectedKeys && ctxMenu.selectedKeys.length > 1
              ? t('tableData.ctxDeleteRowCount', { count: ctxMenu.selectedKeys.length })
              : ''}
          </button>
        </div>
      )}

      {/* 单元格右键菜单 */}
      {cellCtxMenu && (
        <div
          className="context-menu"
          style={{ left: cellCtxMenu.x, top: cellCtxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="ctx-item"
            onClick={() => {
              setEditingCell({ rowKey: cellCtxMenu.rowKey, column: cellCtxMenu.column })
              setCellCtxMenu(null)
            }}
          >
            <Check size={12} /> {t('tableData.ctxEdit')}
          </button>
          <button className="ctx-item" onClick={handleCopyValue}>
            <Copy size={12} /> {t('tableData.ctxCopyValue')}
          </button>
          <button className="ctx-item" onClick={handlePasteCell}>
            <ClipboardPaste size={12} /> {t('tableData.ctxPaste')}
          </button>
          <button className="ctx-item" onClick={handleSetNull}>
            <CircleSlash size={12} /> {t('tableData.ctxSetNull')}
          </button>
          {!cellCtxMenu.isInsertRow && (
            <>
              <div className="ctx-divider" />
              <button className="ctx-item" onClick={handleAddFilter}>
                <Filter size={12} /> {t('tableData.ctxAddFilter')}
              </button>
            </>
          )}
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
