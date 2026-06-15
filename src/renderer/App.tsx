/**
 * 应用根组件
 *
 * 布局：左侧边栏（对象树）+ 右侧主内容区（tab 视图）。
 * 连接管理以 modal 形式浮层展示，不遮挡主视图。
 */
import { useEffect, useState, useCallback } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { api, type ConnectionListItem, type Table } from './api'
import { useConnectionStore } from './store/connections'
import { ObjectTree } from './components/ObjectTree'
import { TableData } from './components/TableData'
import { TableDetail } from './components/TableDetail'
import { AiChat } from './components/AiChat'
import { ConnectionManager } from './pages/ConnectionManager'
import { Settings } from './pages/Settings'
import { SqlWorkspace } from './components/SqlWorkspace'

/** 主内容区的 tab 类型 */
interface Tab {
  id: string
  kind: 'tableData' | 'tableDetail' | 'sql' | 'chat'
  conn: ConnectionListItem
  schema?: string
  table?: string
}

function getTabLabel(tab: Tab): string {
  if (tab.kind === 'sql') return 'SQL查询'
  if (tab.kind === 'chat') return 'AI 对话'
  if (tab.kind === 'tableDetail') return '设计:' + tab.table
  return tab.table ?? ''
}

export default function App() {
  const { connections, loadConnections } = useConnectionStore()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [connectionModal, setConnectionModal] = useState<{
    mode: 'create' | 'edit'
    connection?: ConnectionListItem
  } | null>(null)
  const [bootInfo, setBootInfo] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    loadConnections()
    api['app:ping']()
      .then((r) => setBootInfo('v' + r.version))
      .catch(() => {})
  }, [loadConnections])

  const openTab = useCallback((tab: Tab) => {
    setTabs((prev) => {
      // 同连接同表/同查询只开一个 tab
      const existing = prev.find(
        (t) => t.conn.id === tab.conn.id && t.kind === tab.kind && t.table === tab.table,
      )
      return existing ? prev : [...prev, tab]
    })
    setActiveTabId(tab.id)
  }, [])

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId)
        const next = prev.filter((t) => t.id !== tabId)
        // 如果关的是当前 tab，切换到相邻 tab
        if (activeTabId === tabId) {
          const newActive = next[idx] ?? next[idx - 1] ?? null
          setActiveTabId(newActive?.id ?? null)
        }
        return next
      })
    },
    [activeTabId],
  )

  const handleSelectTable = (
    conn: ConnectionListItem,
    schema: string | undefined,
    table: Table,
  ) => {
    // 点击表 → 默认展示数据
    openTab({
      id: `${conn.id}:${schema ?? ''}:${table.name}:data`,
      kind: 'tableData',
      conn,
      schema,
      table: table.name,
    })
  }

  const handleOpenTableDetail = (
    conn: ConnectionListItem,
    schema: string | undefined,
    table: string,
  ) => {
    openTab({
      id: `${conn.id}:${schema ?? ''}:${table}:detail`,
      kind: 'tableDetail',
      conn,
      schema,
      table,
    })
  }

  const handleOpenSql = (conn: ConnectionListItem) => {
    openTab({
      id: `${conn.id}:sql:${Date.now()}`,
      kind: 'sql',
      conn,
    })
  }

  const handleOpenChat = (conn: ConnectionListItem) => {
    openTab({
      id: `${conn.id}:chat:${Date.now()}`,
      kind: 'chat',
      conn,
    })
  }

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div className="app-root">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-name">AI DB Client</span>
          {bootInfo && <span className="brand-version">{bootInfo}</span>}
          <button
            className="btn-icon sidebar-settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="设置"
          >
            <SettingsIcon size={15} />
          </button>
        </div>
        <ObjectTree
          selectedTable={
            activeTab?.table ? { connectionId: activeTab.conn.id, table: activeTab.table } : null
          }
          onSelectTable={handleSelectTable}
          onCreateConnection={() => setConnectionModal({ mode: 'create' })}
          onEditConnection={(connection) => setConnectionModal({ mode: 'edit', connection })}
          onOpenSql={handleOpenSql}
          onOpenChat={handleOpenChat}
          onOpenTableDetail={handleOpenTableDetail}
        />
      </aside>

      <main className="main-content">
        {tabs.length > 0 ? (
          <div className="tab-container">
            {/* Tab 栏 */}
            <div className="tab-bar">
              {tabs.map((tab) => {
                const label = getTabLabel(tab)
                return (
                  <div
                    key={tab.id}
                    className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    <span className="tab-label" data-label={label}>
                      {label}
                    </span>
                    <button
                      className="tab-close"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
            {/* Tab 内容 */}
            <div className="tab-content">
              {activeTab?.kind === 'tableData' && activeTab.table && (
                <TableData
                  connection={activeTab.conn}
                  schema={activeTab.schema}
                  tableName={activeTab.table}
                />
              )}
              {activeTab?.kind === 'tableDetail' && activeTab.table && (
                <TableDetail
                  connection={activeTab.conn}
                  schema={activeTab.schema}
                  table={{ name: activeTab.table, type: 'table' }}
                />
              )}
              {activeTab?.kind === 'sql' && <SqlWorkspace connection={activeTab.conn} />}
              {activeTab?.kind === 'chat' && <AiChat connection={activeTab.conn} />}
            </div>
          </div>
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
                  <span className="feature-icon">📊</span>
                  <span>点击表名查看数据，右键查看设计/DDL</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">📝</span>
                  <span>SQL 编辑器 + 数据网格</span>
                </div>
                <div className="feature muted-feature">
                  <span className="feature-icon">🤖</span>
                  <span>AI 对话 + MCP Server（开发中）</span>
                </div>
              </div>
              <p className="welcome-hint">
                {connections.length === 0
                  ? '点击左侧「+」创建你的第一个连接'
                  : '点击左侧连接开始浏览，或点 📝 打开 SQL 查询'}
              </p>
            </div>
          </div>
        )}
      </main>

      {/* 连接管理 modal */}
      {connectionModal && (
        <ConnectionManager
          initial={connectionModal.connection ?? null}
          onClose={() => {
            setConnectionModal(null)
            loadConnections()
          }}
        />
      )}

      {/* 设置 modal */}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
