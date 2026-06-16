/**
 * 数据网格组件
 *
 * TanStack Table v8 + 虚拟滚动。
 * 支持：列排序、类型渲染、双击行内编辑、选中行。
 * 编辑通过 onChange 回调通知父组件（待提交队列在父组件管理）。
 */
import { useMemo, useRef, useState, useEffect } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table'
import type { SortingState, ColumnDef } from '@tanstack/react-table'
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Key,
  Table2,
  Columns3Cog,
  Filter,
  X,
} from 'lucide-react'
import type { QueryResult, CellValue } from '../api'

interface BinaryValue {
  __binary: true
  hex: string
  length: number
}
interface JsonValue {
  __json: true
  data: unknown
}
type RichValue = CellValue | BinaryValue | JsonValue

export interface DataGridProps {
  result: QueryResult
  /** 是否可编辑 */
  editable?: boolean
  /** 当前行变更（脏行）的 rowKey 集合，用于高亮 */
  dirtyRowKeys?: Set<string | number>
  /** 当前行编辑回调 */
  onCellChange?: (rowKey: string | number, column: string, value: string) => void
  /** 选中行变化回调（单选） */
  selectedRowKey?: string | number | null
  onSelectRow?: (rowKey: string | number) => void
  /**
   * 多选行（受控）。传入时启用多选语义：
   * - 普通点击：单选当前行（清空其他）
   * - Cmd/Ctrl+点击：切换当前行
   * - Shift+点击：从锚点行到当前行的区间批量选中
   * 不传时退化为单选（selectedRowKey/onSelectRow 路径）
   */
  selectedRowKeys?: ReadonlySet<string | number>
  onSelectRows?: (rowKeys: Set<string | number>) => void
  /** 序号列右键菜单回调 */
  onRowContextMenu?: (e: React.MouseEvent, rowKey: number) => void
  /** 单元格选中状态（高亮单个单元格） */
  selectedCell?: { rowKey: string | number; column: string } | null
  onSelectCell?: (cell: { rowKey: string | number; column: string } | null) => void
  /** 数据单元格右键菜单回调 */
  onCellContextMenu?: (
    e: React.MouseEvent,
    rowKey: string | number,
    column: string,
    value: unknown,
  ) => void
  /** 受控编辑态：当前正在编辑的单元格，与双击走同一条路径 */
  editing?: { rowKey: string | number; column: string } | null
  onEditingChange?: (editing: { rowKey: string | number; column: string } | null) => void
  /** 选中整列回调（点击列头时触发） */
  selectedColumn?: string | null
  onSelectColumn?: (column: string | null) => void
  /** 列元信息（主键/可空），用于列头左侧类型 icon；不传则不显示 icon */
  columnMeta?: Record<string, { isPrimaryKey?: boolean; nullable?: boolean }>
  /**
   * 列单元格编辑器声明（声明式单元格类型）。
   * 未声明的列在 editable 模式下沿用「双击 → 文本输入」；声明后按 kind 渲染内联控件。
   * - text：双击文本输入（与默认一致）
   * - select：内联下拉，change 即提交
   * - checkbox：内联勾选，change 即提交（'true'/'false'）
   * - disabled：只读灰显，不可编辑
   */
  columnEditors?: Record<string, ColumnEditor>
  /** 列筛选：当前生效的筛选值（列名 -> 值），用于列头筛选按钮高亮 */
  filters?: Record<string, string>
  /** 列头筛选输入回调（列名 -> 值，空字符串表示清除该列筛选） */
  onFilterChange?: (column: string, value: string) => void
  /** 底部额外滚动空间（px），让悬浮工具条不遮挡最后一行 */
  bottomPadding?: number
}

/** 声明式单元格编辑器配置 */
export interface ColumnEditor {
  kind: 'text' | 'select' | 'checkbox' | 'disabled'
  /** select 的选项（分组可选） */
  options?: { label: string; value: string; group?: string }[]
  /** checkbox 为 true 时的显示文本 */
  trueLabel?: string
  falseLabel?: string
  /** 禁用态：可按行条件禁用（返回 true 则该单元格不可交互） */
  isDisabled?: (rowKey: string | number) => boolean
}

/** 列头左侧类型 icon：主键 / 非空 / 可空 */
function ColumnTypeIcon({
  isPrimaryKey,
  nullable,
}: {
  isPrimaryKey?: boolean
  nullable?: boolean
}) {
  if (isPrimaryKey) {
    return <Key size={14} className="col-type-icon col-type-pk" />
  }
  if (nullable === false) {
    return <Columns3Cog size={14} className="col-type-icon col-type-notnull" />
  }
  return <Table2 size={14} className="col-type-icon col-type-nullable" />
}

/** 判断列类型是否为时间类型（date/datetime/timestamp/time 等） */
function isTemporalType(dataType: string): boolean {
  const t = dataType.toLowerCase()
  return (
    t === 'date' ||
    t === 'datetime' ||
    t === 'timestamp' ||
    t === 'time' ||
    t === 'year' ||
    t === 'timestamptz' ||
    t === 'datetimetz' ||
    t.startsWith('timestamp') ||
    t.startsWith('datetime')
  )
}

/** 渲染单个单元格值（只读模式） */
function CellRenderer({ value, dataType }: { value: RichValue; dataType: string }) {
  const [expanded, setExpanded] = useState(false)

  if (value === null || value === undefined) {
    return <span className="cell-null">NULL</span>
  }

  if (typeof value === 'object' && value !== null && '__binary' in value) {
    const bv = value as BinaryValue
    return (
      <span className="cell-binary" title={`${bv.length} bytes`}>
        0x{bv.hex.slice(0, 32)}
        {bv.hex.length > 32 ? '…' : ''} ({bv.length}B)
      </span>
    )
  }

  if (typeof value === 'object' && value !== null && '__json' in value) {
    const jv = value as JsonValue
    const text = JSON.stringify(jv.data, null, 2)
    const preview = JSON.stringify(jv.data)
    if (preview.length < 50) {
      return <span className="cell-json">{preview}</span>
    }
    return (
      <span className="cell-json-wrapper">
        <button
          className="cell-json-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(!expanded)
          }}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {preview.slice(0, 30)}…
        </button>
        {expanded && <pre className="cell-json-expanded">{text}</pre>}
      </span>
    )
  }

  if (typeof value === 'boolean') {
    return <span className="cell-bool">{value ? '✓' : '✗'}</span>
  }

  if (typeof value === 'string') {
    // 时间类型（date/datetime/timestamp/time）按数据库原始字面值显示，
    // 不做格式化或时区转换
    if (isTemporalType(dataType)) {
      return <span className="cell-datetime">{value}</span>
    }
    if (value.length > 100) {
      return (
        <span className="cell-text" title={value}>
          {value.slice(0, 100)}…
        </span>
      )
    }
    return <span className="cell-text">{value}</span>
  }

  if (typeof value === 'number') {
    return <span className="cell-number">{value.toLocaleString()}</span>
  }

  return <span>{String(value)}</span>
}

function stringifyEditValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function CellEditor({
  initialValue,
  rowKey,
  column,
  onCommit,
  onCancel,
}: {
  initialValue: unknown
  rowKey: string | number
  column: string
  onCommit?: (rowKey: string | number, column: string, value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(() => stringifyEditValue(initialValue))
  const composingRef = useRef(false)

  const commit = () => {
    onCommit?.(rowKey, column, value)
    onCancel()
  }

  return (
    <input
      className="cell-edit-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false
        setValue(e.currentTarget.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !composingRef.current && !e.nativeEvent.isComposing) {
          commit()
        }
        if (e.key === 'Escape') {
          onCancel()
        }
      }}
      autoFocus
    />
  )
}

/**
 * 声明式内联单元格控件（select / checkbox / disabled / text）。
 * 与双击触发的 CellEditor 不同：声明列始终以内联控件呈现，
 * 用于表结构编辑等需要每列不同控件类型的场景。
 *
 * text 列用本地非受控状态：输入期间不触发父组件重渲染（否则每次按键
 * 重渲染会让 input 失焦），仅在失焦/回车时提交。select/checkbox 即时提交。
 */
function InlineCellControl({
  editor,
  value,
  rowKey,
  column,
  onCommit,
}: {
  editor: ColumnEditor
  value: unknown
  rowKey: string | number
  column: string
  onCommit?: (rowKey: string | number, column: string, value: string) => void
}) {
  // text 列本地编辑态：外部 value 变化时同步（如切类型清空长度）
  const [textValue, setTextValue] = useState(() => stringifyEditValue(value))
  const composingRef = useRef(false)
  useEffect(() => {
    // 外部 value 变化时同步本地编辑态（如切类型清空长度）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTextValue(stringifyEditValue(value))
  }, [value])

  const disabled = editor.isDisabled?.(rowKey) ?? false
  const str = value === null || value === undefined ? '' : String(value)

  // 停止冒泡，避免触发单元格选中/排序等行为
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  if (editor.kind === 'disabled') {
    return (
      <input
        className="cell-edit-input cell-edit-disabled"
        value={str}
        disabled
        onClick={stop}
        readOnly
      />
    )
  }

  if (editor.kind === 'checkbox') {
    const checked = str === 'true' || str === '1'
    return (
      <label className="cell-checkbox" onClick={stop}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCommit?.(rowKey, column, String(e.target.checked))}
        />
        <span className="cell-checkbox-label">
          {checked ? (editor.trueLabel ?? '是') : (editor.falseLabel ?? '否')}
        </span>
      </label>
    )
  }

  if (editor.kind === 'select') {
    // 按 group 组织 optgroup
    const grouped: Record<string, typeof editor.options> = {}
    for (const opt of editor.options ?? []) {
      const g = opt.group ?? ''
      ;(grouped[g] ??= []).push(opt)
    }
    const groups = Object.keys(grouped)
    return (
      <select
        className="cell-edit-select"
        value={str}
        disabled={disabled}
        onClick={stop}
        onChange={(e) => onCommit?.(rowKey, column, e.target.value)}
      >
        {groups.map((g) =>
          g ? (
            <optgroup key={g} label={g}>
              {grouped[g]!.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            grouped[g]!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
    )
  }

  // text：本地非受控输入，失焦/回车提交，避免每次按键重渲染失焦
  const commit = () => onCommit?.(rowKey, column, textValue)
  return (
    <input
      className={`cell-edit-input${disabled ? ' cell-edit-disabled' : ''}`}
      value={textValue}
      disabled={disabled}
      onClick={stop}
      onChange={(e) => setTextValue(e.currentTarget.value)}
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false
        setTextValue(e.currentTarget.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !composingRef.current && !e.nativeEvent.isComposing) commit()
        if (e.key === 'Escape') setTextValue(stringifyEditValue(value))
      }}
    />
  )
}

export function DataGrid({
  result,
  editable = false,
  dirtyRowKeys,
  onCellChange,
  selectedRowKey,
  onSelectRow,
  selectedRowKeys,
  onSelectRows,
  onRowContextMenu,
  selectedCell,
  onSelectCell,
  onCellContextMenu,
  editing,
  onEditingChange,
  selectedColumn,
  onSelectColumn,
  columnMeta,
  columnEditors,
  filters,
  onFilterChange,
  bottomPadding = 0,
}: DataGridProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const containerRef = useRef<HTMLDivElement>(null)
  // 选中整列：优先使用受控 prop，未受控时回退到内部状态
  const [selectedColumnInternal, setSelectedColumnInternal] = useState<string | null>(null)
  const effectiveSelectedColumn = selectedColumn ?? selectedColumnInternal
  const setSelectedColumnState = (col: string | null) => {
    if (onSelectColumn) onSelectColumn(col)
    else setSelectedColumnInternal(col)
  }

  // ── 多选：以「可视行（排序后）索引」为锚点，跨页/虚拟滚动也能正确算区间 ──
  const multiSelectEnabled = !!onSelectRows
  // 上次普通/Cmd 点击的可视行索引，作为 Shift 区间起点
  const anchorIndexRef = useRef<number | null>(null)

  /**
   * 计算某 rowKey 在当前可视行（rows）中的索引。
   * rowKey 可能为 string/number；与每行 original.__row_key__ 比较，回退到 row.index。
   */
  const indexOfRowKey = (rowKey: string | number): number => {
    for (let k = 0; k < rows.length; k++) {
      const rk = (rows[k].original as Record<string, unknown>)['__row_key__'] ?? rows[k].index
      if (rk === rowKey) return k
    }
    return -1
  }

  /**
   * 统一的行选中处理（序号格点击 / 行空白点击共享）。
   * 多选语义：
   * - Cmd/Ctrl：切换单行
   * - Shift：从锚点到当前行区间全选
   * - 普通：单选当前行（清空其他）
   */
  const handleRowSelect = (
    rowKey: string | number,
    e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  ) => {
    // 单选模式：沿用原有受控回调
    if (!multiSelectEnabled) {
      onSelectRow?.(rowKey)
      return
    }
    const idx = indexOfRowKey(rowKey)
    const modifier = e.metaKey || e.ctrlKey
    const next = new Set<string | number>(selectedRowKeys ?? [])
    if (e.shiftKey && anchorIndexRef.current != null && idx >= 0) {
      const from = Math.min(anchorIndexRef.current, idx)
      const to = Math.max(anchorIndexRef.current, idx)
      // Shift 区间：在锚点基础上累加（macOS Finder 语义），不清空已有选择
      for (let k = from; k <= to; k++) {
        const rk = (rows[k].original as Record<string, unknown>)['__row_key__'] ?? rows[k].index
        next.add(rk as string | number)
      }
    } else if (modifier) {
      // Cmd/Ctrl：切换当前行
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      anchorIndexRef.current = idx >= 0 ? idx : null
    } else {
      // 普通：单选当前行
      next.clear()
      next.add(rowKey)
      anchorIndexRef.current = idx >= 0 ? idx : null
    }
    onSelectRows?.(next)
  }
  // 列头筛选弹窗：当前打开的列名 + 展开方向（右侧空间不足时向左展开）
  const [filterColumn, setFilterColumn] = useState<string | null>(null)
  const [filterAlign, setFilterAlign] = useState<'left' | 'right'>('right')
  const filterBtnRef = useRef<HTMLSpanElement>(null)
  const columns = useMemo<ColumnDef<Record<string, RichValue>>[]>(
    () =>
      result.columns.map((col: { name: string; dataType: string }) => ({
        id: col.name,
        accessorKey: col.name,
        header: col.name,
        cell: ({ getValue, row }: { getValue: () => unknown; row: { index: number } }) => {
          const v = getValue() as RichValue
          const originalRowKey = (row as { original?: Record<string, unknown> }).original?.[
            '__row_key__'
          ]
          const rowKey =
            typeof originalRowKey === 'string' || typeof originalRowKey === 'number'
              ? originalRowKey
              : row.index
          // 声明式内联控件（text/select/checkbox/disabled）：声明了 editor 就始终以内联控件呈现，
          // 不再依赖双击 + editing 受控状态（表结构编辑场景：每个单元格始终可编辑）
          const editor = columnEditors?.[col.name]
          if (editable && editor) {
            return (
              <InlineCellControl
                editor={editor}
                value={v}
                rowKey={rowKey}
                column={col.name}
                onCommit={onCellChange}
              />
            )
          }
          // 编辑模式（受控）：双击与右键「编辑」共用同一路径，按 rowKey 匹配，排序后仍稳定
          if (editing && editing.rowKey === rowKey && editing.column === col.name) {
            return (
              <CellEditor
                initialValue={v}
                rowKey={rowKey}
                column={col.name}
                onCommit={onCellChange}
                onCancel={() => onEditingChange?.(null)}
              />
            )
          }
          return <CellRenderer value={v} dataType={col.dataType} />
        },
        size: 150,
      })),
    [result.columns, editing, onEditingChange, onCellChange, editable, columnEditors],
  )

  const data = useMemo(() => result.rows as Record<string, RichValue>[], [result.rows])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table 官方用法
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const { rows } = table.getRowModel()

  const rowHeight = 32
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleScroll = () => {
      const scrollTop = container.scrollTop
      const viewHeight = container.clientHeight
      const start = Math.floor(scrollTop / rowHeight)
      const end = Math.min(rows.length, start + Math.ceil(viewHeight / rowHeight) + 10)
      setVisibleRange({ start, end })
    }
    container.addEventListener('scroll', handleScroll)
    handleScroll()
    return () => container.removeEventListener('scroll', handleScroll)
  }, [rows.length])

  // 点击表格外或滚动时关闭列头筛选弹窗
  useEffect(() => {
    if (!filterColumn) return
    const container = containerRef.current
    const close = () => setFilterColumn(null)
    const onPointerDown = (e: MouseEvent) => {
      if (container && !container.contains(e.target as Node)) close()
    }
    // 弹窗宽度估算（输入框 140 + 清除按钮 + 内边距 + 边框）
    const POP_WIDTH = 190
    // 判断按钮右侧空间是否足够；不足则向左展开
    const btn = filterBtnRef.current
    if (btn && container) {
      const btnRect = btn.getBoundingClientRect()
      const cRect = container.getBoundingClientRect()
      const spaceRight = cRect.right - btnRect.left
      setFilterAlign(spaceRight < POP_WIDTH ? 'left' : 'right')
    }
    window.addEventListener('pointerdown', onPointerDown)
    container?.addEventListener('scroll', close, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      container?.removeEventListener('scroll', close)
    }
  }, [filterColumn])

  const scrollBottomPad = bottomPadding
  const visibleRows = rows.slice(visibleRange.start, visibleRange.end)
  const topSpacerHeight = visibleRange.start * rowHeight
  const bottomSpacerHeight = Math.max(0, rows.length * rowHeight - visibleRange.end * rowHeight)

  if (result.rows.length === 0 && result.message) {
    return (
      <div className="grid-empty">
        <span className="grid-message">{result.message}</span>
      </div>
    )
  }

  const handleCellDoubleClick = (rowKey: string | number, colName: string) => {
    if (!editable) return
    // 已声明内联控件的列（含 text）始终可编辑，不走双击受控路径
    if (columnEditors?.[colName]) return
    onEditingChange?.({ rowKey, column: colName })
  }

  /** 点击列头：选中整列（再次点击同一列取消） */
  const handleHeaderClick = (colId: string) => {
    setSelectedColumnState(effectiveSelectedColumn === colId ? null : colId)
  }

  /**
   * Tab 导航（仅声明式内联编辑场景）：在表格内的可聚焦单元格间移动，
   * 到末尾/开头时停在最后一格/第一格，绝不让焦点溢出到表格外的按钮（避免误触发新增等操作）。
   * 数据查询页（无 columnEditors）不拦截，保留原生 Tab 行为。
   */
  const handleKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !editable || !columnEditors) return
    const container = containerRef.current
    if (!container) return
    // 收集表格内所有可聚焦的内联控件（input/select）
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        '.cell-edit-input:not([disabled]):not([readonly]), .cell-edit-select:not([disabled])',
      ),
    )
    if (focusables.length === 0) return
    const active = document.activeElement as HTMLElement | null
    const idx = active && container.contains(active) ? focusables.indexOf(active) : -1
    e.preventDefault()
    if (e.shiftKey) {
      // Shift+Tab：往前，到头停在第一格
      const prev = idx > 0 ? idx - 1 : 0
      focusables[prev]!.focus()
    } else {
      // Tab：往后，到尾停在最后一格
      const next = idx >= 0 && idx < focusables.length - 1 ? idx + 1 : focusables.length - 1
      focusables[next]!.focus()
    }
  }

  // 单个 table + sticky thead：表头与表体共享 colgroup，列宽天然对齐
  return (
    <div className="data-grid-container" ref={containerRef} onKeyDownCapture={handleKeyDownCapture}>
      <table className="data-grid-table">
        <colgroup>
          <col style={{ width: 32 }} />
          {table.getAllLeafColumns().map((column) => (
            <col key={column.id} style={{ width: column.getSize() }} />
          ))}
        </colgroup>
        <thead className="grid-head">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              <th className="grid-row-num">#</th>
              {hg.headers.map((header) => {
                const sortDir = header.column.getIsSorted()
                const isColSelected = effectiveSelectedColumn === header.id
                const meta = columnMeta?.[header.id]
                const hasFilter = filters?.[header.id] !== undefined && filters?.[header.id] !== ''
                const isFilterOpen = filterColumn === header.id
                return (
                  <th
                    key={header.id}
                    onClick={() => handleHeaderClick(header.id)}
                    className={`grid-th ${isColSelected ? 'grid-col-selected' : ''}`}
                    title="点击选中整列"
                  >
                    <span className="grid-th-inner">
                      {columnMeta && (
                        <ColumnTypeIcon
                          isPrimaryKey={meta?.isPrimaryKey}
                          nullable={meta?.nullable}
                        />
                      )}
                      <span className="grid-th-label">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {onFilterChange && (
                        <span className="filter-head-wrap" ref={filterBtnRef}>
                          <button
                            className={`col-head-btn filter-toggle ${
                              hasFilter || isFilterOpen ? 'col-head-btn-active' : ''
                            }`}
                            title="筛选"
                            onClick={(e) => {
                              e.stopPropagation()
                              setFilterColumn(isFilterOpen ? null : header.id)
                            }}
                          >
                            <Filter size={14} />
                          </button>
                          {isFilterOpen && (
                            <span
                              className={`filter-pop filter-pop-${filterAlign}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                className="filter-input"
                                autoFocus
                                placeholder={`${header.id} = …`}
                                defaultValue={filters?.[header.id] ?? ''}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    onFilterChange(header.id, e.currentTarget.value)
                                    setFilterColumn(null)
                                  }
                                  if (e.key === 'Escape') setFilterColumn(null)
                                }}
                              />
                              <button
                                className="filter-pop-clear"
                                title="清除"
                                onClick={() => {
                                  onFilterChange(header.id, '')
                                  setFilterColumn(null)
                                }}
                              >
                                <X size={12} />
                              </button>
                            </span>
                          )}
                        </span>
                      )}
                      <span className="grid-th-spacer" />
                      <button
                        className={`col-head-btn sort-toggle ${
                          sortDir ? 'col-head-btn-active' : ''
                        }`}
                        title="排序"
                        onClick={(e) => {
                          e.stopPropagation()
                          header.column.getToggleSortingHandler()?.(e)
                        }}
                      >
                        {sortDir === 'asc' ? (
                          <ArrowUp size={14} />
                        ) : sortDir === 'desc' ? (
                          <ArrowDown size={14} />
                        ) : (
                          <ChevronsUpDown size={14} />
                        )}
                      </button>
                    </span>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {topSpacerHeight > 0 && (
            <tr aria-hidden="true" style={{ height: topSpacerHeight }}>
              <td colSpan={result.columns.length + 1} style={{ padding: 0, border: 'none' }} />
            </tr>
          )}
          {visibleRows.map((row, i) => {
            const rowKey =
              (row.original as Record<string, unknown>)['__row_key__'] ?? visibleRange.start + i
            const isDirty = dirtyRowKeys?.has(rowKey as string | number)
            const isSelected = multiSelectEnabled
              ? (selectedRowKeys?.has(rowKey as string | number) ?? false) ||
                selectedCell?.rowKey === (rowKey as string | number)
              : selectedRowKey === rowKey
            return (
              <tr
                key={row.id}
                className={`grid-row ${isDirty ? 'grid-row-dirty' : ''} ${isSelected ? 'grid-row-selected' : ''}`}
                style={{ height: rowHeight }}
                onClick={(e) => handleRowSelect(rowKey as string | number, e)}
              >
                <td
                  className="grid-row-num-cell grid-row-selectable"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRowSelect(rowKey as string | number, e)
                  }}
                  onContextMenu={(e) => {
                    if (onRowContextMenu) onRowContextMenu(e, rowKey as number)
                  }}
                  title="点击选中行 · Cmd/Ctrl 增选 · Shift 区间选中 · 右键更多操作"
                >
                  {visibleRange.start + i + 1}
                </td>
                {row.getVisibleCells().map((cell) => {
                  const isEditing =
                    editing &&
                    editing.rowKey === (rowKey as string | number) &&
                    editing.column === cell.column.id
                  const isCellSelected =
                    !isEditing &&
                    selectedCell?.rowKey === (rowKey as string | number) &&
                    selectedCell?.column === cell.column.id
                  const isColSelected = effectiveSelectedColumn === cell.column.id
                  const cellValue = cell.getValue()
                  return (
                    <td
                      key={cell.id}
                      className={`grid-cell ${isEditing ? 'grid-cell-editing' : ''} ${isCellSelected ? 'grid-cell-selected' : ''} ${isColSelected ? 'grid-col-selected' : ''}`}
                      onClick={(e) => {
                        // 单元格点击仅做单元格选中，阻止冒泡到行的多选逻辑
                        // （行选中由序号格负责，避免与单元格选中互相清空）
                        e.stopPropagation()
                        // 选中单元格时清除列选中，保持两者互斥
                        if (effectiveSelectedColumn) setSelectedColumnState(null)
                        onSelectCell?.({
                          rowKey: rowKey as string | number,
                          column: cell.column.id,
                        })
                      }}
                      onDoubleClick={() =>
                        handleCellDoubleClick(rowKey as string | number, cell.column.id)
                      }
                      onContextMenu={(e) => {
                        if (onCellContextMenu)
                          onCellContextMenu(e, rowKey as string | number, cell.column.id, cellValue)
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          {bottomSpacerHeight > 0 && (
            <tr aria-hidden="true" style={{ height: bottomSpacerHeight }}>
              <td colSpan={result.columns.length + 1} style={{ padding: 0, border: 'none' }} />
            </tr>
          )}
          {scrollBottomPad > 0 && (
            <tr aria-hidden="true" style={{ height: scrollBottomPad }}>
              <td colSpan={result.columns.length + 1} style={{ padding: 0, border: 'none' }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
