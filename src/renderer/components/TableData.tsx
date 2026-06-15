/**
 * 表数据浏览组件
 *
 * 点击表名时默认展示：自动执行 SELECT * FROM table LIMIT 100。
 * 复用 DataGrid 展示结果，带刷新和「查看设计」入口。
 */
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Loader2, Table2, AlertCircle } from 'lucide-react'
import { api, type ConnectionListItem, type QueryResult } from '../api'
import { DataGrid } from './DataGrid'

interface TableDataProps {
  connection: ConnectionListItem
  schema?: string
  tableName: string
}

export function TableData({ connection, schema, tableName }: TableDataProps) {
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 构造 SELECT，带 schema 前缀（PG）或直接表名
      const qualified =
        connection.type === 'postgres' && schema
          ? `"${schema}"."${tableName}"`
          : connection.type === 'sqlite'
            ? `"${tableName}"`
            : `\`${tableName}\``
      const sql = `SELECT * FROM ${qualified} LIMIT 100`
      const res = await api['db:executeQuery']({
        connectionId: connection.id,
        sql,
        limit: 100,
      })
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [connection.id, connection.type, schema, tableName])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换表时加载数据是合法模式
    loadData()
  }, [loadData])

  return (
    <div className="table-data-view">
      <div className="table-data-header">
        <h2>
          <Table2 size={16} /> {tableName}
        </h2>
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

      {result && !loading && !error && (
        <div className="table-data-grid-wrapper">
          {result.rows.length > 0 ? (
            <DataGrid result={result} />
          ) : (
            <div className="empty-state">
              <p>表 {tableName} 没有数据</p>
            </div>
          )}
          <div className="table-data-footer">
            {result.rowCount} 行（最多显示 100 行）
            {result.durationMs > 0 && ` · ${result.durationMs}ms`}
          </div>
        </div>
      )}
    </div>
  )
}
