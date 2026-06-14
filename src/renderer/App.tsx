import { useEffect, useState } from 'react'
import { api, type ConnectionListItem, type Table } from './api'
import { useConnectionStore } from './store/connections'
import { ObjectTree } from './components/ObjectTree'
import { TableDetail } from './components/TableDetail'
import { ConnectionManager } from './pages/ConnectionManager'
import { SqlWorkspace } from './components/SqlWorkspace'

type View =
  | { type: 'welcome' }
  | { type: 'tableDetail'; conn: ConnectionListItem; schema?: string; table: string }
  | { type: 'sqlWorkspace'; conn: ConnectionListItem }

export default function App() {
  const { connections, loadConnections } = useConnectionStore()
  const [page, setPage] = useState<'workspace' | 'manage'>('workspace')
  const [view, setView] = useState<View>({ type: 'welcome' })
  const [bootInfo, setBootInfo] = useState<string | null>(null)

  useEffect(() => {
    loadConnections()
    api['app:ping']()
      .then((r) => setBootInfo(`v${r.version}`))
      .catch(() => {})
  }, [loadConnections])

  const handleSelectTable = (
    conn: ConnectionListItem,
    schema: string | undefined,
    table: Table,
  ) => {
    setView({ type: 'tableDetail', conn, schema, table: table.name })
  }

  const handleOpenSql = (conn: ConnectionListItem) => {
    setView({ type: 'sqlWorkspace', conn })
  }

  const handleManageConnections = () => setPage('manage')

  return (
    <div className="app-root">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-name">AI DB Client</span>
          {bootInfo && <span className="brand-version">{bootInfo}</span>}
        </div>
        <ObjectTree
          selectedTable={
            view.type === 'tableDetail' ? { connectionId: view.conn.id, table: view.table } : null
          }
          onSelectTable={handleSelectTable}
          onManageConnections={handleManageConnections}
          onOpenSql={handleOpenSql}
        />
      </aside>

      <main className="main-content">
        {page === 'manage' ? (
          <ConnectionManager
            onClose={() => {
              setPage('workspace')
              loadConnections()
            }}
          />
        ) : view.type === 'sqlWorkspace' ? (
          <SqlWorkspace connection={view.conn} />
        ) : view.type === 'tableDetail' ? (
          <TableDetail
            connection={view.conn}
            schema={view.schema}
            table={{ name: view.table, type: 'table' }}
          />
        ) : (
          <div className="welcome">
            <div className="welcome-card">
              <h1>AI DB Client</h1>
              <p className="welcome-subtitle">开源的 AI 原生数据库工具</p>
              <div className="welcome-features">
                <div className="feature">
                  <span className="feature-icon">🔌</span>
                  <span>多数据库连接（MySQL / PostgreSQL / SQLite / Redis）</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">📝</span>
                  <span>SQL 编辑器 + 数据网格</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">🌳</span>
                  <span>对象浏览与表结构查看</span>
                </div>
                <div className="feature muted-feature">
                  <span className="feature-icon">🤖</span>
                  <span>AI 对话 + MCP Server（开发中）</span>
                </div>
              </div>
              <p className="welcome-hint">
                {connections.length === 0
                  ? '点击左侧「+」创建你的第一个连接'
                  : '点击左侧连接的「查询」按钮开始写 SQL'}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
