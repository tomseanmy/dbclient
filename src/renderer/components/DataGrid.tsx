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
import { ArrowUp, ArrowDown, ChevronDown, ChevronRight } from 'lucide-react'
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
  /** 选中行变化回调 */
  selectedRowKey?: string | number | null
  onSelectRow?: (rowKey: string | number) => void
  /** 序号列右键菜单回调 */
  onRowContextMenu?: (e: React.MouseEvent, rowKey: number) => void
}

/** 渲染单个单元格值（只读模式） */
function CellRenderer({ value }: { value: RichValue }) {
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
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) {
      return (
        <span className="cell-datetime" title={value}>
          {value.replace('T', ' ').slice(0, 19)}
        </span>
      )
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

export function DataGrid({
  result,
  editable = false,
  dirtyRowKeys,
  onCellChange,
  selectedRowKey,
  onSelectRow,
  onRowContextMenu,
}: DataGridProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null)

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
          // 编辑模式
          if (editing && editing.row === row.index && editing.col === col.name) {
            return (
              <CellEditor
                initialValue={v}
                rowKey={rowKey}
                column={col.name}
                onCommit={onCellChange}
                onCancel={() => setEditing(null)}
              />
            )
          }
          return <CellRenderer value={v} />
        },
        size: 150,
      })),
    [result.columns, editing, onCellChange],
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

  const totalHeight = rows.length * rowHeight
  const visibleRows = rows.slice(visibleRange.start, visibleRange.end)
  const topSpacerHeight = visibleRange.start * rowHeight
  const bottomSpacerHeight = Math.max(0, totalHeight - visibleRange.end * rowHeight)

  if (result.rows.length === 0 && result.message) {
    return (
      <div className="grid-empty">
        <span className="grid-message">{result.message}</span>
      </div>
    )
  }

  const handleCellDoubleClick = (rowIndex: number, colName: string) => {
    if (!editable) return
    setEditing({ row: rowIndex, col: colName })
  }

  return (
    <div className="data-grid-container" ref={containerRef}>
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
                return (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className="grid-th"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {sortDir === 'asc' && <ArrowUp size={10} className="sort-icon" />}
                    {sortDir === 'desc' && <ArrowDown size={10} className="sort-icon" />}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
      </table>
      <div className="grid-body">
        <table className="data-grid-table">
          <colgroup>
            <col style={{ width: 32 }} />
            {table.getAllLeafColumns().map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
          </colgroup>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={result.columns.length + 1}
                  style={{ height: topSpacerHeight, padding: 0 }}
                />
              </tr>
            )}
            {visibleRows.map((row, i) => {
              const rowKey =
                (row.original as Record<string, unknown>)['__row_key__'] ?? visibleRange.start + i
              const isDirty = dirtyRowKeys?.has(rowKey as string | number)
              const isSelected = selectedRowKey === rowKey
              return (
                <tr
                  key={row.id}
                  className={`grid-row ${isDirty ? 'grid-row-dirty' : ''} ${isSelected ? 'grid-row-selected' : ''}`}
                  style={{ height: rowHeight }}
                  onClick={() => onSelectRow?.(rowKey as string | number)}
                >
                  <td
                    className="grid-row-num-cell grid-row-selectable"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectRow?.(rowKey as string | number)
                    }}
                    onContextMenu={(e) => {
                      if (onRowContextMenu) onRowContextMenu(e, rowKey as number)
                    }}
                    title="点击选中行 · 右键更多操作"
                  >
                    {visibleRange.start + i + 1}
                  </td>
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`grid-cell ${
                        editing && editing.row === row.index && editing.col === cell.column.id
                          ? 'grid-cell-editing'
                          : ''
                      }`}
                      onDoubleClick={() => handleCellDoubleClick(row.index, cell.column.id)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
            {bottomSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={result.columns.length + 1}
                  style={{ height: bottomSpacerHeight, padding: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
