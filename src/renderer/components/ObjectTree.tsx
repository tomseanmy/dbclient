/**
 * 对象树组件（侧边栏）
 *
 * 展示：连接节点 → schema → 表/视图。
 * 懒加载：点击连接才连库，点击 schema 才加载表。
 */
import { useState } from 'react'
import { ChevronRight, Database, Server, Table2, Eye, Loader2, AlertCircle } from 'lucide-react'
import { useConnectionStore, DB_LABELS, ENV_COLORS } from '../store/connections'
import type { ConnectionListItem, Table } from '../api'

interface ObjectTreeProps {
  selectedTable: { connectionId: string; schema?: string; table: string } | null
  onSelectTable: (conn: ConnectionListItem, schema: string | undefined, table: Table) => void
  onManageConnections: () => void
  onOpenSql: (conn: ConnectionListItem) => void
}

export function ObjectTree({
  selectedTable,
  onSelectTable,
  onManageConnections,
  onOpenSql,
}: ObjectTreeProps) {
  const { connections, states, connectDb, disconnectDb, loadSchemas, loadTables } =
    useConnectionStore()
  const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set())
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())

  const toggleConn = async (conn: ConnectionListItem) => {
    const key = conn.id
    const isOpen = expandedConns.has(key)
    if (isOpen) {
      // 收起 + 断开
      setExpandedConns((prev) => new Set([...prev].filter((k) => k !== key)))
      await disconnectDb(conn.id)
    } else {
      // 展开 + 连接 + 加载 schema
      setExpandedConns((prev) => new Set(prev).add(key))
      const state = states[key]
      if (!state?.connected) {
        const ok = await connectDb(conn.id)
        if (ok) await loadSchemas(conn.id)
      } else {
        await loadSchemas(conn.id)
      }
    }
  }

  const toggleSchema = async (connId: string, schemaName: string) => {
    const key = `${connId}:${schemaName}`
    const isOpen = expandedSchemas.has(key)
    if (isOpen) {
      setExpandedSchemas((prev) => new Set([...prev].filter((k) => k !== key)))
    } else {
      setExpandedSchemas((prev) => new Set(prev).add(key))
      await loadTables(connId, schemaName)
    }
  }

  return (
    <div className="object-tree">
      <div className="tree-header">
        <span className="tree-title">连接</span>
        <button className="btn-icon" onClick={onManageConnections} title="管理连接">
          +
        </button>
      </div>

      {connections.length === 0 && (
        <div className="tree-empty">
          <p>暂无连接</p>
          <button className="btn btn-primary btn-sm" onClick={onManageConnections}>
            新建连接
          </button>
        </div>
      )}

      {connections.map((conn) => {
        const state = states[conn.id]
        const isOpen = expandedConns.has(conn.id)
        const schemas = state?.schemas ?? []
        const isConnecting = state?.connecting
        const connError = state?.error

        return (
          <div key={conn.id} className="tree-node-group">
            {/* 连接节点 */}
            <div
              className={`tree-node tree-conn ${isOpen ? 'expanded' : ''}`}
              onClick={() => toggleConn(conn)}
            >
              <ChevronRight size={14} className={`chevron ${isOpen ? 'rotated' : ''}`} />
              <span
                className="conn-dot"
                style={{ background: state?.connected ? '#16a34a' : '#9ca3af' }}
              />
              <Database size={14} />
              <span className="conn-name">{conn.name}</span>
              <span className="conn-type">{DB_LABELS[conn.type]}</span>
              <span
                className="conn-env"
                style={{ color: ENV_COLORS[conn.environment] }}
                title={`${conn.environment} 环境`}
              >
                {conn.environment}
              </span>
              <button
                className="conn-query-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenSql(conn)
                }}
                title="打开 SQL 查询"
              >
                📝
              </button>
            </div>

            {/* 连接中 */}
            {isOpen && isConnecting && (
              <div className="tree-loading">
                <Loader2 size={12} className="spin" /> 连接中…
              </div>
            )}

            {/* 连接错误 */}
            {isOpen && connError && !isConnecting && (
              <div className="tree-error">
                <AlertCircle size={12} /> {connError}
              </div>
            )}

            {/* Schema 列表 */}
            {isOpen && !isConnecting && !connError && (
              <div className="tree-children">
                {schemas.map((schema) => {
                  const schemaKey = `${conn.id}:${schema.name}`
                  const isSchemaOpen = expandedSchemas.has(schemaKey)
                  const tables = state?.tables?.[schema.name] ?? []

                  return (
                    <div key={schema.name}>
                      <div
                        className={`tree-node tree-schema ${isSchemaOpen ? 'expanded' : ''}`}
                        onClick={() => toggleSchema(conn.id, schema.name)}
                      >
                        <ChevronRight
                          size={12}
                          className={`chevron ${isSchemaOpen ? 'rotated' : ''}`}
                        />
                        <Server size={12} />
                        <span>{schema.name}</span>
                      </div>
                      {isSchemaOpen && (
                        <div className="tree-children">
                          {tables.map((table) => (
                            <div
                              key={table.name}
                              className={`tree-node tree-table ${
                                selectedTable?.connectionId === conn.id &&
                                selectedTable?.table === table.name
                                  ? 'selected'
                                  : ''
                              }`}
                              onClick={() => onSelectTable(conn, schema.name, table)}
                            >
                              {table.type === 'view' ? <Eye size={12} /> : <Table2 size={12} />}
                              <span>{table.name}</span>
                              {table.estimatedRows !== undefined && (
                                <span className="row-count">
                                  {table.estimatedRows.toLocaleString()} 行
                                </span>
                              )}
                            </div>
                          ))}
                          {tables.length === 0 && <div className="tree-empty-sm">无表</div>}
                        </div>
                      )}
                    </div>
                  )
                })}
                {schemas.length === 0 && <div className="tree-empty-sm">无 schema</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
