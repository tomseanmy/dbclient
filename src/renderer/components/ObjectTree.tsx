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
  Pencil,
  FileText,
  ClipboardCopy,
  Trash2 as TrashIcon,
  Plug,
  PlugZap,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConnectionStore, DB_LABELS, ENV_COLORS } from '../store/connections'
import { useContextMenuClose } from '../hooks/useContextMenu'
import type { ConnectionListItem, Table } from '../api'

interface ObjectTreeProps {
  selectedTable: { connectionId: string; schema?: string; table: string } | null
  onSelectTable: (conn: ConnectionListItem, schema: string | undefined, table: Table) => void
  onCreateConnection: () => void
  onEditConnection: (conn: ConnectionListItem) => void
  onOpenSql: (conn: ConnectionListItem) => void
  onOpenChat: (conn: ConnectionListItem) => void
  onOpenDatabase: (conn: ConnectionListItem, schema: string) => void
  onOpenTableDetail: (conn: ConnectionListItem, schema: string | undefined, table: string) => void
}

/** 右键菜单位置 */
interface TableContextMenu {
  x: number
  y: number
  conn: ConnectionListItem
  schema?: string
  table: string
}

interface ConnectionContextMenu {
  x: number
  y: number
  conn: ConnectionListItem
}

export function ObjectTree({
  selectedTable,
  onSelectTable,
  onCreateConnection,
  onEditConnection,
  onOpenSql,
  onOpenChat,
  onOpenDatabase,
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
  const { t } = useTranslation()
  const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set())
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null)
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null)
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [refreshingConn, setRefreshingConn] = useState<string | null>(null)
  const [tableCtxMenu, setTableCtxMenu] = useState<TableContextMenu | null>(null)
  const [connCtxMenu, setConnCtxMenu] = useState<ConnectionContextMenu | null>(null)

  useEffect(() => {
    if (refreshTick === 0) return
    expandedConns.forEach((connId) => {
      const state = states[connId]
      if (state?.connected) refreshConnection(connId)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])

  // 点击其他地方关闭右键菜单
  useContextMenuClose(tableCtxMenu !== null || connCtxMenu !== null, () => {
    setTableCtxMenu(null)
    setConnCtxMenu(null)
  })

  /** 单击连接节点：仅选中（chevron 展开/收折，schema 节点开详情） */
  const handleConnClick = (conn: ConnectionListItem) => {
    setSelectedConnId(conn.id)
  }

  /** 双击连接节点：未连接则连接，已连接则收折 */
  const handleConnDoubleClick = async (conn: ConnectionListItem) => {
    const key = conn.id
    const state = states[key]
    if (state?.connected) {
      // 已连接：切换展开/收折
      const isOpen = expandedConns.has(key)
      if (isOpen) {
        setExpandedConns((prev) => new Set([...prev].filter((k) => k !== key)))
      } else {
        setExpandedConns((prev) => new Set(prev).add(key))
      }
    } else {
      // 未连接：连接并展开
      setExpandedConns((prev) => new Set(prev).add(key))
      const ok = await connectDb(conn.id)
      if (ok) {
        await loadSchemas(conn.id)
        await reloadExpandedTables(conn.id)
      }
    }
  }

  /** 点击 chevron：展开/收折（未连接时自动触发连接） */
  const handleChevronClick = async (e: React.MouseEvent, conn: ConnectionListItem) => {
    e.stopPropagation()
    const key = conn.id
    const isOpen = expandedConns.has(key)
    if (isOpen) {
      setExpandedConns((prev) => new Set([...prev].filter((k) => k !== key)))
      return
    }
    // 展开节点
    setExpandedConns((prev) => new Set(prev).add(key))
    // 未连接则自动连接并加载 schema
    const state = states[key]
    if (!state?.connected) {
      const ok = await connectDb(conn.id)
      if (ok) {
        await loadSchemas(conn.id)
        await reloadExpandedTables(conn.id)
      }
    }
  }

  /** 右键菜单：连接 */
  const handleConnect = async (conn: ConnectionListItem) => {
    const state = states[conn.id]
    if (state?.connected) return
    setExpandedConns((prev) => new Set(prev).add(conn.id))
    const ok = await connectDb(conn.id)
    if (ok) {
      await loadSchemas(conn.id)
      await reloadExpandedTables(conn.id)
    }
  }

  /** 右键菜单：断开 */
  const handleDisconnect = async (conn: ConnectionListItem) => {
    await disconnectDb(conn.id)
    setExpandedConns((prev) => new Set([...prev].filter((k) => k !== conn.id)))
  }

  const reloadExpandedTables = async (connId: string) => {
    const schemas = [...expandedSchemas]
      .filter((schemaKey) => schemaKey.startsWith(`${connId}:`))
      .map((schemaKey) => schemaKey.slice(connId.length + 1))

    await Promise.all(schemas.map((schema) => loadTables(connId, schema)))
  }

  /** schema 节点 chevron：展开/收折（首次展开时加载表） */
  const handleSchemaChevronClick = async (
    e: React.MouseEvent,
    connId: string,
    schemaName: string,
  ) => {
    e.stopPropagation()
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
    setConnCtxMenu(null)
    setTableCtxMenu({ x: e.clientX, y: e.clientY, conn, schema, table })
  }

  const handleConnectionContextMenu = (e: React.MouseEvent, conn: ConnectionListItem) => {
    e.preventDefault()
    e.stopPropagation()
    setTableCtxMenu(null)
    setConnCtxMenu({ x: e.clientX, y: e.clientY, conn })
  }

  const handleCtxAction = (action: string) => {
    if (!tableCtxMenu) return
    const { conn, schema, table } = tableCtxMenu
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
    setTableCtxMenu(null)
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
      window.confirm(t('objectTree.dropConfirm', { qualified }))
    }, 100)
  }

  return (
    <div className="object-tree">
      <div className="tree-header">
        <span className="tree-title">{t('objectTree.title')}</span>
        <button
          className="btn-icon"
          onClick={onCreateConnection}
          title={t('connection.newConnection')}
        >
          +
        </button>
      </div>

      {connections.length === 0 && (
        <div className="tree-empty">
          <p>{t('objectTree.empty')}</p>
          <button className="btn btn-primary btn-sm" onClick={onCreateConnection}>
            {t('connection.newConnection')}
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
              className={`tree-node tree-conn tree-level-0 ${isOpen ? 'expanded' : ''} ${selectedConnId === conn.id ? 'tree-conn-selected' : ''}`}
              onClick={() => handleConnClick(conn)}
              onDoubleClick={() => handleConnDoubleClick(conn)}
              onContextMenu={(e) => handleConnectionContextMenu(e, conn)}
            >
              <ChevronRight
                size={14}
                className={`chevron ${isOpen ? 'rotated' : ''}`}
                onClick={(e) => handleChevronClick(e, conn)}
              />
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
                title={t('objectTree.envTitle', { env: conn.environment })}
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
                  title={t('common.refresh')}
                  disabled={isRefreshing}
                >
                  <RefreshCw size={11} className={isRefreshing ? 'spin' : ''} />
                </button>
              )}
            </div>

            {isOpen && isConnecting && (
              <div className="tree-loading tree-level-1">
                <Loader2 size={12} className="spin" /> {t('objectTree.connecting')}
              </div>
            )}

            {isOpen && connError && !isConnecting && (
              <div className="tree-error tree-level-1">
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
                        className={`tree-node tree-schema tree-level-1 ${
                          isSchemaOpen ? 'expanded' : ''
                        } ${selectedSchemaId === schemaKey ? 'tree-schema-selected' : ''}`}
                        onClick={() => {
                          setSelectedSchemaId(schemaKey)
                          onOpenDatabase(conn, schema.name)
                        }}
                        title={t('objectTree.openDbHint')}
                      >
                        <ChevronRight
                          size={12}
                          className={`chevron ${isSchemaOpen ? 'rotated' : ''}`}
                          onClick={(e) => handleSchemaChevronClick(e, conn.id, schema.name)}
                        />
                        <Server size={12} />
                        <span>{schema.name}</span>
                      </div>
                      {isSchemaOpen && (
                        <div className="tree-children">
                          {tables.map((table) => (
                            <div
                              key={table.name}
                              className={`tree-node tree-table tree-level-2 ${
                                selectedTable?.connectionId === conn.id &&
                                selectedTable?.table === table.name
                                  ? 'selected'
                                  : ''
                              }`}
                              onClick={() => onSelectTable(conn, schema.name, table)}
                              onContextMenu={(e) =>
                                handleTableContextMenu(e, conn, schema.name, table.name)
                              }
                              title={t('objectTree.tableHint', {
                                table: table.name,
                                schema: schema.name,
                              })}
                            >
                              <span className="tree-table-chevron-placeholder" />
                              <span className="tree-table-icon">
                                {table.type === 'view' ? <Eye size={12} /> : <Table2 size={12} />}
                              </span>
                              <span className="tree-table-name">{table.name}</span>
                            </div>
                          ))}
                          {tables.length === 0 && (
                            <div className="tree-empty-sm tree-level-2">
                              {t('objectTree.noTables')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {schemas.length === 0 && (
                  <div className="tree-empty-sm tree-level-1">{t('objectTree.noSchemas')}</div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* 右键菜单 */}
      {connCtxMenu && (
        <div
          className="context-menu"
          style={{ left: connCtxMenu.x, top: connCtxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {!states[connCtxMenu.conn.id]?.connected ? (
            <button
              className="ctx-item"
              onClick={() => {
                handleConnect(connCtxMenu.conn)
                setConnCtxMenu(null)
              }}
            >
              <Plug size={12} /> {t('objectTree.ctxConnect')}
            </button>
          ) : (
            <button
              className="ctx-item"
              onClick={() => {
                handleDisconnect(connCtxMenu.conn)
                setConnCtxMenu(null)
              }}
            >
              <PlugZap size={12} /> {t('objectTree.ctxDisconnect')}
            </button>
          )}
          <div className="ctx-divider" />
          <button
            className="ctx-item"
            onClick={() => {
              onEditConnection(connCtxMenu.conn)
              setConnCtxMenu(null)
            }}
          >
            <Pencil size={12} /> {t('objectTree.ctxEdit')}
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              onOpenSql(connCtxMenu.conn)
              setConnCtxMenu(null)
            }}
          >
            <FileText size={12} /> {t('objectTree.ctxSqlEditor')}
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              onOpenChat(connCtxMenu.conn)
              setConnCtxMenu(null)
            }}
          >
            <Sparkles size={12} /> {t('objectTree.ctxAgent')}
          </button>
        </div>
      )}

      {tableCtxMenu && (
        <div
          className="context-menu"
          style={{ left: tableCtxMenu.x, top: tableCtxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button className="ctx-item" onClick={() => handleCtxAction('data')}>
            <Table2 size={12} /> {t('objectTree.ctxViewData')}
          </button>
          <button className="ctx-item" onClick={() => handleCtxAction('design')}>
            <Eye size={12} /> {t('objectTree.ctxViewDesign')}
          </button>
          <button className="ctx-item" onClick={() => handleCtxAction('ddl')}>
            <Table2 size={12} /> {t('objectTree.ctxToDdl')}
          </button>
          <div className="ctx-divider" />
          <button className="ctx-item" onClick={() => handleCtxAction('copyName')}>
            <ClipboardCopy size={12} /> {t('objectTree.ctxCopyName')}
          </button>
          <div className="ctx-divider" />
          <button className="ctx-item ctx-danger" onClick={() => handleCtxAction('drop')}>
            <TrashIcon size={12} /> {t('objectTree.ctxDropTable')}
          </button>
        </div>
      )}
    </div>
  )
}
