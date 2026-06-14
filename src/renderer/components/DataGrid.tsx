/**
 * 数据网格组件
 *
 * TanStack Table v8 + 虚拟滚动，只读浏览。
 * 支持：列排序、JSON 美化、布尔/二进制/null 特殊渲染、导出。
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

interface DataGridProps {
  result: QueryResult
}

/** 渲染单个单元格值 */
function CellRenderer({ value }: { value: RichValue }) {
  const [expanded, setExpanded] = useState(false)

  if (value === null) {
    return <span className="cell-null">NULL</span>
  }

  // 二进制
  if (typeof value === 'object' && value !== null && '__binary' in value) {
    const bv = value as BinaryValue
    return (
      <span className="cell-binary" title={`${bv.length} bytes`}>
        0x{bv.hex.slice(0, 32)}
        {bv.hex.length > 32 ? '…' : ''} ({bv.length}B)
      </span>
    )
  }

  // JSON
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

  // 布尔
  if (typeof value === 'boolean') {
    return <span className="cell-bool">{value ? '✓' : '✗'}</span>
  }

  // 字符串
  if (typeof value === 'string') {
    // 检测 datetime（ISO 格式）
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

  // 数字
  if (typeof value === 'number') {
    return <span className="cell-number">{value.toLocaleString()}</span>
  }

  return <span>{String(value)}</span>
}

export function DataGrid({ result }: DataGridProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const columns = useMemo<ColumnDef<Record<string, RichValue>>[]>(
    () =>
      result.columns.map((col: { name: string; dataType: string }) => ({
        id: col.name,
        accessorKey: col.name,
        header: col.name,
        cell: ({ getValue }: { getValue: () => unknown }) => (
          <CellRenderer value={getValue() as RichValue} />
        ),
        size: 150,
      })),
    [result.columns],
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

  // 虚拟滚动
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

  if (result.rows.length === 0 && result.message) {
    return (
      <div className="grid-empty">
        <span className="grid-message">{result.message}</span>
      </div>
    )
  }

  return (
    <div className="data-grid-container" ref={containerRef}>
      <table className="data-grid-table">
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
                    style={{ width: header.getSize() }}
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
      <div className="grid-body" style={{ height: totalHeight, position: 'relative' }}>
        <table className="data-grid-table">
          <tbody>
            {visibleRows.map((row, i) => (
              <tr
                key={row.id}
                className="grid-row"
                style={{
                  height: rowHeight,
                  position: 'absolute',
                  top: (visibleRange.start + i) * rowHeight,
                  left: 0,
                  right: 0,
                }}
              >
                <td className="grid-row-num-cell">{visibleRange.start + i + 1}</td>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="grid-cell" style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
