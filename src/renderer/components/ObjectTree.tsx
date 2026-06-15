/**
 * 对象树组件（侧边栏）
 *
 * 展示：连接节点 → schema → 表/视图。
 * - 点击表 → 默认展示数据
 * - 右键表 → 菜单（设计/转DDL/删除表/重命名）
 * - 连接节点：刷新按钮 + 查询按钮
 */
import { useState, useEffect, useCallback } from 'react'
import {
  ChevronRight,
  Database,
  Server,
  Table2,
  Eye,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { useConnectionStore, DB_LABELS, ENV_COLORS } from '../store/connections'
import type { ConnectionListItem, Table } from '../api'

interface ObjectTreeProps {
  selectedTable: { connectionId: string; schema?: string; table: string } | null
  onSelectTable: (conn: ConnectionListItem, schema: string | undefined, table: Table) => void
  onManageConnections: () => void
  onOpenSql: (conn: ConnectionListItem) => void
  onOpenTableDetail: (conn: ConnectionListItem, schema: string | undefined, table: string) => void
}

/** 右键菜单位置 */
interface ContextMenu {
  x: number
  y: number
  conn: ConnectionListItem
  schema?: string
  table: string
}

export function ObjectTree({
  selectedTable,
  onSelectTable,
  onManageConnections,
  onOpenSql,
  onOpenTableDetail,
}: ObjectTreeProps) {
  const {
    connections,
    states,
    connectDb,
    disconnectDb,
    loadSchemas,
    loadTables,
    refreshConnection,
    refreshTick,
  } = useConnectionStore()
  const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set())
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [refreshingConn, setRefreshingConn] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null)

  useEffect(() => {
    if (refreshTick === 0) return
    expandedConns.forEach((connId) => {
      const state = states[connId]
      if (state?.connected) refreshConnection(connId)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])

  // 点击其他地方关闭右键菜单
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

  const toggleConn = async (conn: ConnectionListItem) => {
    const key = conn.id
    const isOpen = expandedConns.has(key)
    if (isOpen) {
      setExpandedConns((prev) => new Set([...prev].filter((k) => k !== key)))
      await disconnectDb(conn.id)
    } else {
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

  const handleRefresh = useCallback(
    async (connId: string) => {
      setRefreshingConn(connId)
      try {
        await refreshConnection(connId)
      } finally {
        setRefreshingConn(null)
      }
    },
    [refreshConnection],
  )

  const handleTableContextMenu = (
    e: React.MouseEvent,
    conn: ConnectionListItem,
    schema: string | undefined,
    table: string,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, conn, schema, table })
  }

  const handleCtxAction = (action: string) => {
    if (!ctxMenu) return
    const { conn, schema, table } = ctxMenu
    switch (action) {
      case 'data':
        onSelectTable(conn, schema, { name: table, type: 'table' })
        break
      case 'design':
        onOpenTableDetail(conn, schema, table)
        break
      case 'ddl':
        onOpenTableDetail(conn, schema, table)
        break
      case 'drop':
        // 通过 SQL 工作区执行 DROP（走安全检查）
        handleDropTable(conn, schema, table)
        break
      case 'copyName':
        navigator.clipboard.writeText(table)
        break
    }
    setCtxMenu(null)
  }

  const handleDropTable = async (
    conn: ConnectionListItem,
    schema: string | undefined,
    table: string,
  ) => {
    const qualified =
      conn.type === 'postgres' && schema
        ? `"${schema}"."${table}"`
        : conn.type === 'sqlite'
          ? `"${table}"`
          : `\`${table}\``
    // 打开 SQL 工作区并预填 DROP 语句（走安全检查流程）
    onOpenSql(conn)
    // 通过全局事件把 SQL 填入编辑器（简单方案：用 prompt 确认）
    setTimeout(() => {
      window.confirm(`将执行 DROP TABLE ${qualified}，请到 SQL 查询中确认执行`)
    }, 100)
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
        const isRefreshing = refreshingConn === conn.id

        return (
          <div key={conn.id} className="tree-node-group">
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
              {isOpen && state?.connected && (
                <button
                  className="conn-refresh-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRefresh(conn.id)
                  }}
                  title="刷新"
                  disabled={isRefreshing}
                >
                  <RefreshCw size={11} className={isRefreshing ? 'spin' : ''} />
                </button>
              )}
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

            {isOpen && isConnecting && (
              <div className="tree-loading">
                <Loader2 size={12} className="spin" /> 连接中…
              </div>
            )}

            {isOpen && connError && !isConnecting && (
              <div className="tree-error">
                <AlertCircle size={12} /> {connError}
              </div>
            )}

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
                              onContextMenu={(e) =>
                                handleTableContextMenu(e, conn, schema.name, table.name)
                              }
                              title="左键查看数据 · 右键更多操作"
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

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          className="context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button className="ctx-item" onClick={() => handleCtxAction('data')}>
            <Table2 size={12} /> 查看数据
          </button>
          <button className="ctx-item" onClick={() => handleCtxAction('design')}>
            <Eye size={12} /> 查看设计
          </button>
          <button className="ctx-item" onClick={() => handleCtxAction('ddl')}>
            <Table2 size={12} /> 转 DDL
          </button>
          <div className="ctx-divider" />
          <button className="ctx-item" onClick={() => handleCtxAction('copyName')}>
            📋 复制表名
          </button>
          <div className="ctx-divider" />
          <button className="ctx-item ctx-danger" onClick={() => handleCtxAction('drop')}>
            🗑 删除表
          </button>
        </div>
      )}
    </div>
  )
}
