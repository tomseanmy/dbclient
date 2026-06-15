/**
 * 数据库详情页
 *
 * 点击数据库连接后显示所有表的列表。
 * 工具栏：新建 SQL 查询 / 新建表 / 删除表 / 编辑表 / 导入 / 导出 / 刷新
 * 表列表：表名（带图标）、类型、行数估算、注释
 * 双击表名进入表数据页
 */
import { useState, useEffect, useCallback } from 'react'
import {
  FileText,
  Plus,
  Trash2,
  Pencil,
  Upload,
  Download,
  RefreshCw,
  Loader2,
  Table2,
  Eye,
  Search,
} from 'lucide-react'
import { api, type ConnectionListItem, type Table } from '../api'

interface DatabaseDetailProps {
  connection: ConnectionListItem
  onOpenSql: (conn: ConnectionListItem) => void
  onSelectTable: (conn: ConnectionListItem, schema: string | undefined, table: Table) => void
  onOpenTableDetail: (conn: ConnectionListItem, schema: string | undefined, table: string) => void
}

export function DatabaseDetail({
  connection,
  onOpenSql,
  onSelectTable,
  onOpenTableDetail,
}: DatabaseDetailProps) {
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const schemas = await api['db:listSchemas']({ connectionId: connection.id })
      const allTables: Table[] = []
      for (const schema of schemas) {
        const ts = await api['db:listTables']({ connectionId: connection.id, schema: schema.name })
        for (const t of ts) {
          allTables.push({ ...t, schema: schema.name })
        }
      }
      // SQLite/MySQL 单 schema 时也可能直接 listTables
      if (allTables.length === 0) {
        const ts = await api['db:listTables']({ connectionId: connection.id })
        allTables.push(...ts)
      }
      allTables.sort((a, b) => a.name.localeCompare(b.name))
      setTables(allTables)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始加载是合法模式
    loadData()
  }, [loadData])

  const filtered = tables.filter(
    (t) => !search || t.name.toLowerCase().includes(search.toLowerCase()),
  )

  const handleDeleteTable = async (tableName: string) => {
    if (!confirm(`确认删除表 ${tableName}？此操作不可恢复。`)) return
    // 通过 SQL 执行 DROP，走安全层
    try {
      const quote = connection.type === 'postgres' || connection.type === 'sqlite' ? '"' : '`'
      const sql = `DROP TABLE ${quote}${tableName}${quote}`
      await api['db:confirmExecute']({ connectionId: connection.id, sql })
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="database-detail-view">
      {/* 工具栏 */}
      <div className="table-data-toolbar-bar">
        <abbr title="新建 SQL 查询">
          <button className="icon-btn" onClick={() => onOpenSql(connection)}>
            <FileText size={14} />
          </button>
        </abbr>
        <abbr title="新建表（开发中）">
          <button className="icon-btn" disabled>
            <Plus size={14} />
          </button>
        </abbr>
        <abbr title="删除选中表">
          <button
            className="icon-btn"
            onClick={() => selectedTable && handleDeleteTable(selectedTable)}
            disabled={!selectedTable}
          >
            <Trash2 size={14} />
          </button>
        </abbr>
        <abbr title="编辑表结构">
          <button
            className="icon-btn"
            onClick={() => selectedTable && onOpenTableDetail(connection, undefined, selectedTable)}
            disabled={!selectedTable}
          >
            <Pencil size={14} />
          </button>
        </abbr>
        <abbr title="导入数据">
          <button className="icon-btn" disabled>
            <Upload size={14} />
          </button>
        </abbr>
        <div className="export-wrapper">
          <abbr title="导出">
            <button className="icon-btn" onClick={() => setExportOpen((v) => !v)}>
              <Download size={14} />
            </button>
          </abbr>
          {exportOpen && (
            <div className="export-menu" onClick={(e) => e.stopPropagation()}>
              <button>CSV（开发中）</button>
              <button>JSON（开发中）</button>
            </div>
          )}
        </div>
        <div className="toolbar-spacer" />
        <abbr title="刷新">
          <button className="icon-btn" onClick={loadData} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </abbr>
      </div>

      {/* 搜索框 */}
      <div className="db-detail-search-bar">
        <Search size={12} />
        <input
          className="db-detail-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索表名…"
        />
        <span className="db-detail-count">{filtered.length} 张表</span>
      </div>

      {/* 表列表 */}
      {loading && (
        <div className="detail-loading">
          <Loader2 size={16} className="spin" /> 加载表列表…
        </div>
      )}

      {error && <div className="detail-error">{error}</div>}

      {!loading && !error && (
        <div className="db-detail-table-list">
          {filtered.map((table) => (
            <div
              key={`${table.schema ?? ''}.${table.name}`}
              className={`db-detail-row ${selectedTable === table.name ? 'db-detail-row-selected' : ''}`}
              onClick={() => setSelectedTable(table.name)}
              onDoubleClick={() => onSelectTable(connection, table.schema, table)}
            >
              <span className="db-detail-table-icon">
                {table.type === 'view' ? <Eye size={15} /> : <Table2 size={15} />}
              </span>
              <span className="db-detail-name">{table.name}</span>
              {table.schema && <span className="db-detail-schema">{table.schema}</span>}
              {table.estimatedRows !== undefined && (
                <span className="db-detail-rows">{table.estimatedRows.toLocaleString()} 行</span>
              )}
              {table.comment && <span className="db-detail-comment">{table.comment}</span>}
              <div className="toolbar-spacer" />
              <abbr title="查看数据">
                <button
                  className="icon-btn db-detail-action"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectTable(connection, table.schema, table)
                  }}
                >
                  <Table2 size={13} />
                </button>
              </abbr>
              <abbr title="表结构">
                <button
                  className="icon-btn db-detail-action"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenTableDetail(connection, table.schema, table.name)
                  }}
                >
                  <Pencil size={13} />
                </button>
              </abbr>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="db-detail-empty">{search ? '未找到匹配的表' : '暂无表'}</div>
          )}
        </div>
      )}
    </div>
  )
}
