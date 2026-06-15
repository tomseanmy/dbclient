/**
 * 表数据浏览与编辑组件
 *
 * 点击表名时展示数据，支持：
 * - 刷新（重新查询）
 * - 行内编辑（双击单元格）
 * - 新增行 / 删除行
 * - 提交（生成 SQL 批量执行，走安全检查）/ 回滚
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  RefreshCw,
  Loader2,
  Table2,
  AlertCircle,
  Plus,
  Trash2,
  Check,
  Undo2,
  Pencil,
} from 'lucide-react'
import { api, type ConnectionListItem, type QueryResult } from '../api'
import { DataGrid } from './DataGrid'

interface TableDataProps {
  connection: ConnectionListItem
  schema?: string
  tableName: string
}

/** 变更类型 */
type ChangeType = 'update' | 'insert' | 'delete'

/** 单条变更 */
interface Change {
  type: ChangeType
  rowKey: number
  /** update: 修改的列 → 新值 */
  values?: Record<string, string>
  /** update/delete: 原始行（用于 WHERE 条件） */
  original?: Record<string, unknown>
  /** insert: 新行的值 */
  newValues?: Record<string, string>
}

export function TableData({ connection, schema, tableName }: TableDataProps) {
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [changes, setChanges] = useState<Map<number, Change>>(new Map())
  const [selectedRowKey, setSelectedRowKey] = useState<number | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<string | null>(null)

  /** 构造限定表名 */
  const qualifiedName = useMemo(() => {
    if (connection.type === 'postgres' && schema) return `"${schema}"."${tableName}"`
    if (connection.type === 'sqlite') return `"${tableName}"`
    return '`' + tableName + '`'
  }, [connection.type, schema, tableName])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setChanges(new Map())
    setCommitResult(null)
    try {
      const sql = `SELECT * FROM ${qualifiedName} LIMIT 100`
      const res = await api['db:executeQuery']({
        connectionId: connection.id,
        sql,
        limit: 100,
      })
      // 为每行注入 __row_key__（用索引）
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

  /** 单元格编辑回调 */
  const handleCellChange = (rowIndex: number, column: string, value: string) => {
    setChanges((prev) => {
      const next = new Map(prev)
      const existing = next.get(rowIndex)
      const originalRow = result?.rows[rowIndex]
      if (existing && existing.type === 'update') {
        existing.values = { ...existing.values, [column]: value }
      } else if (existing && existing.type === 'insert') {
        existing.newValues = { ...existing.newValues, [column]: value }
      } else {
        // 新 update
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

  /** 新增行 */
  const handleAddRow = () => {
    setChanges((prev) => {
      const next = new Map(prev)
      const newKey = -1 * (Date.now() % 1000000)
      // 用空值初始化所有列
      const newValues: Record<string, string> = {}
      result?.columns.forEach((c) => (newValues[c.name] = ''))
      next.set(newKey, {
        type: 'insert',
        rowKey: newKey,
        newValues,
      })
      return next
    })
  }

  /** 删除选中行 */
  const handleDeleteRow = () => {
    if (selectedRowKey === null || selectedRowKey >= 0) return
    // 找到选中的 insert 行，直接从变更队列移除
    if (selectedRowKey < 0) {
      const change = changes.get(selectedRowKey)
      if (change?.type === 'insert') {
        setChanges((prev) => {
          const next = new Map(prev)
          next.delete(selectedRowKey)
          return next
        })
        setSelectedRowKey(null)
        return
      }
    }
    // 对已有行标记删除
    if (selectedRowKey !== null && selectedRowKey >= 0) {
      const originalRow = result?.rows[selectedRowKey]
      if (!originalRow) return
      const original: Record<string, unknown> = {}
      for (const k of Object.keys(originalRow)) {
        if (k !== '__row_key__') original[k] = originalRow[k]
      }
      setChanges((prev) => {
        const next = new Map(prev)
        next.set(selectedRowKey, {
          type: 'delete',
          rowKey: selectedRowKey,
          original,
        })
        return next
      })
    }
  }

  /** 生成 SQL 并提交 */
  const handleCommit = async () => {
    if (changes.size === 0) return
    setCommitting(true)
    setCommitResult(null)
    try {
      const stmts: string[] = []
      changes.forEach((change) => {
        if (change.type === 'insert' && change.newValues) {
          const cols = Object.keys(change.newValues).filter((k) => change.newValues![k] !== '')
          const vals = cols.map((k) => escapeSqlValue(change.newValues![k] as string)).join(', ')
          stmts.push(`INSERT INTO ${qualifiedName} (${cols.join(', ')}) VALUES (${vals})`)
        } else if (change.type === 'update' && change.values && change.original) {
          const sets = Object.entries(change.values)
            .map(([k, v]) => `${quoteIdent(k)} = ${escapeSqlValue(v)}`)
            .join(', ')
          const where = buildWhereClause(change.original)
          stmts.push(`UPDATE ${qualifiedName} SET ${sets} WHERE ${where}`)
        } else if (change.type === 'delete' && change.original) {
          const where = buildWhereClause(change.original)
          stmts.push(`DELETE FROM ${qualifiedName} WHERE ${where}`)
        }
      })

      // 逐条执行（走安全检查）
      const results: string[] = []
      for (const stmt of stmts) {
        const check = await api['db:checkSql']({ connectionId: connection.id, sql: stmt })
        if (check.denied) {
          results.push(`❌ 拒绝: ${check.reason}`)
          break
        }
        if (check.confirmRequired) {
          // 自动确认（用户已点提交，视为确认；高危除外）
          if (check.requireKeywordConfirm) {
            results.push(`⏭ 跳过高危: ${stmt.slice(0, 50)}…`)
            continue
          }
        }
        try {
          await api['db:confirmExecute']({
            connectionId: connection.id,
            sql: stmt,
            confirmedKeyword: undefined,
          })
          results.push('✓ ' + stmt.slice(0, 60))
        } catch (err) {
          results.push('❌ ' + (err instanceof Error ? err.message : String(err)))
        }
      }

      setCommitResult(results.join('\n'))
      // 提交后重新加载
      await loadData()
    } catch (err) {
      setCommitResult('提交失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCommitting(false)
    }
  }

  /** 回滚所有未提交变更 */
  const handleRollback = () => {
    setChanges(new Map())
    setSelectedRowKey(null)
    setCommitResult(null)
  }

  const dirtyRowKeys = useMemo(() => new Set(changes.keys()), [changes])

  // 合并 insert 行到显示数据
  const displayResult = useMemo(() => {
    if (!result) return null
    const insertRows = [...changes.values()]
      .filter((c) => c.type === 'insert')
      .map((c) => {
        const row: Record<string, unknown> = { __row_key__: c.rowKey }
        if (c.newValues) {
          for (const [k, v] of Object.entries(c.newValues)) row[k] = v
        }
        return row
      })
    if (insertRows.length === 0) return result as QueryResult
    return { ...result, rows: [...insertRows, ...result.rows] } as QueryResult
  }, [result, changes])

  return (
    <div className="table-data-view">
      <div className="table-data-header">
        <h2>
          <Table2 size={16} /> {tableName}
        </h2>
        <div className="table-data-toolbar">
          <button
            className={`btn btn-sm ${editMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setEditMode(!editMode)}
            title="切换编辑模式"
          >
            <Pencil size={12} /> {editMode ? '退出编辑' : '编辑'}
          </button>
          {editMode && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={handleAddRow} title="新增行">
                <Plus size={12} /> 增
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleDeleteRow}
                title="删除选中行"
                disabled={selectedRowKey === null}
              >
                <Trash2 size={12} /> 删
              </button>
              <button
                className="btn btn-sm"
                style={{
                  background: changes.size > 0 ? 'var(--success)' : 'var(--bg-hover)',
                  color: changes.size > 0 ? 'white' : 'var(--text-muted)',
                  border: '1px solid transparent',
                }}
                onClick={handleCommit}
                disabled={changes.size === 0 || committing}
                title="提交变更"
              >
                {committing ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                提交 {changes.size > 0 ? `(${changes.size})` : ''}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRollback}
                disabled={changes.size === 0}
                title="回滚未提交变更"
              >
                <Undo2 size={12} /> 回滚
              </button>
            </>
          )}
          <button className="btn btn-secondary btn-sm" onClick={loadData} disabled={loading}>
            {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            刷新
          </button>
        </div>
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
            editable={editMode}
            dirtyRowKeys={dirtyRowKeys}
            onCellChange={handleCellChange}
            selectedRowKey={selectedRowKey}
            onSelectRow={(k) => setSelectedRowKey(typeof k === 'number' ? k : Number(k))}
          />
          <div className="table-data-footer">
            {result?.rowCount ?? 0} 行（最多显示 100 行）
            {result && result.durationMs > 0 && ` · ${result.durationMs}ms`}
            {changes.size > 0 && <span className="changes-badge">{changes.size} 个未提交变更</span>}
          </div>
        </div>
      )}

      {commitResult && (
        <div className="commit-log">
          <pre>{commitResult}</pre>
        </div>
      )}
    </div>
  )
}

/** 转义 SQL 值 */
function escapeSqlValue(v: string): string {
  if (v === '' || v.toLowerCase() === 'null') return 'NULL'
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  return "'" + v.replace(/'/g, "''") + "'"
}

/** 引用标识符 */
function quoteIdent(name: string): string {
  return '`' + name + '`'
}

/** 用原始行构造 WHERE 子句（用所有列匹配） */
function buildWhereClause(original: Record<string, unknown>): string {
  const conds = Object.entries(original)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      const sv = typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"
      return quoteIdent(k) + ' = ' + sv
    })
  return conds.length > 0 ? conds.join(' AND ') : '1=1'
}
