/**
 * 应用根组件
 *
 * 布局：左侧边栏（对象树）+ 右侧主内容区（tab 视图）。
 * 连接管理以 modal 形式浮层展示，不遮挡主视图。
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Settings as SettingsIcon, Plug, Table2, FileText, Bot, X } from 'lucide-react'
import { api, type ConnectionListItem, type Table } from './api'
import { useConnectionStore } from './store/connections'
import { useTabStore } from './store/tabs'
import { ObjectTree } from './components/ObjectTree'
import { TableData } from './components/TableData'
import { DatabaseDetail } from './components/DatabaseDetail'
import { TableDetail } from './components/TableDetail'
import { AiChat } from './components/AiChat'
import { ConnectionManager } from './pages/ConnectionManager'
import { Settings } from './pages/Settings'
import { SqlWorkspace } from './components/SqlWorkspace'
import { WindowControls } from './components/WindowControls'

/** 主内容区的 tab 类型 */
interface Tab {
  id: string
  kind: 'tableData' | 'tableDetail' | 'sql' | 'chat' | 'database'
  conn: ConnectionListItem
  schema?: string
  table?: string
}

function getTabLabel(tab: Tab): string {
  if (tab.kind === 'sql') {
    const db = tab.conn.database || tab.conn.name
    return db + '@' + tab.conn.name
  }
  if (tab.kind === 'database') {
    const db = tab.conn.database || tab.conn.name
    return tab.schema ? `${db}@${tab.schema}` : db
  }
  if (tab.kind === 'chat') return 'AI 对话'
  if (tab.kind === 'tableDetail') {
    return tab.schema ? `设计:${tab.table}@${tab.schema}` : `设计:${tab.table}`
  }
  // 表数据：表名@库名（schema 为表所属库，来自点击时的对象树）
  return tab.schema ? `${tab.table}@${tab.schema}` : (tab.table ?? '')
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
  const tabBarRef = useRef<HTMLDivElement>(null)

  // 激活 tab 变化时，把 active tab 滚进可视区（横向滚动条跟随）
  useEffect(() => {
    if (!activeTabId || !tabBarRef.current) return
    const activeEl = tabBarRef.current.querySelector<HTMLDivElement>('.tab-item.active')
    activeEl?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activeTabId])

  useEffect(() => {
    loadConnections()
    api['app:ping']()
      .then((r) => setBootInfo('v' + r.version))
      .catch(() => {})
  }, [loadConnections])

  const openTab = useCallback((tab: Tab) => {
    setTabs((prev) => {
      // 同连接同类型同 schema/表只开一个 tab（id 已含 conn+schema+table+kind 维度）
      const existing = prev.find((t) => t.id === tab.id)
      return existing ? prev : [...prev, tab]
    })
    setActiveTabId(tab.id)
  }, [])

  const clearDirty = useTabStore((s) => s.clearDirty)

  /** 关闭一批 tab：移除并清理脏标记，重新选择 activeTab */
  const closeTabs = useCallback(
    (idsToClose: Set<string>) => {
      if (idsToClose.size === 0) return
      idsToClose.forEach((id) => clearDirty(id))
      setTabs((prev) => {
        const next = prev.filter((t) => !idsToClose.has(t.id))
        // 若 activeTab 被关，切到剩余列表中相邻位置
        if (activeTabId && idsToClose.has(activeTabId)) {
          const prevActiveIdx = prev.findIndex((t) => t.id === activeTabId)
          // 在剩余列表里找原 active 位置附近第一个存活的 tab
          const candidate =
            next.find((_, i) => i >= prevActiveIdx) ??
            [...next].reverse().find((_, i) => next.length - 1 - i < prevActiveIdx) ??
            null
          setActiveTabId(candidate?.id ?? null)
        }
        return next
      })
    },
    [activeTabId, clearDirty],
  )

  const closeTab = useCallback(
    (tabId: string) => {
      closeTabs(new Set([tabId]))
    },
    [closeTabs],
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

  const handleOpenDatabase = (conn: ConnectionListItem, schema: string) => {
    openTab({
      id: `${conn.id}:${schema}:database`,
      kind: 'database',
      conn,
      schema,
    })
  }

  /** Tab 右键菜单 */
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const isTabDirty = useTabStore((s) => s.isDirty)

  // 点击任意处 / 触发其他右键菜单时关闭 Tab 菜单
  useEffect(() => {
    if (!tabMenu) return
    const close = () => setTabMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [tabMenu])

  const handleTabContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setActiveTabId(tabId)
    setTabMenu({ x: e.clientX, y: e.clientY, tabId })
  }

  // —— 6 个关闭操作 ——
  const closeOthers = (tabId: string) =>
    closeTabs(new Set(tabs.filter((t) => t.id !== tabId).map((t) => t.id)))
  const closeAll = () => closeTabs(new Set(tabs.map((t) => t.id)))
  const closeUnedited = () =>
    closeTabs(new Set(tabs.filter((t) => !isTabDirty(t.id)).map((t) => t.id)))
  const closeLeft = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId)
    closeTabs(new Set(tabs.slice(0, idx).map((t) => t.id)))
  }
  const closeRight = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId)
    closeTabs(new Set(tabs.slice(idx + 1).map((t) => t.id)))
  }

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div className="app-root">
      <WindowControls />
      <aside className="sidebar">
        <ObjectTree
          selectedTable={
            activeTab?.table ? { connectionId: activeTab.conn.id, table: activeTab.table } : null
          }
          onSelectTable={handleSelectTable}
          onCreateConnection={() => setConnectionModal({ mode: 'create' })}
          onEditConnection={(connection) => setConnectionModal({ mode: 'edit', connection })}
          onOpenSql={handleOpenSql}
          onOpenChat={handleOpenChat}
          onOpenDatabase={handleOpenDatabase}
          onOpenTableDetail={handleOpenTableDetail}
        />
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
      </aside>

      <main className="main-content">
        {tabs.length > 0 ? (
          <div className="tab-container">
            {/* Tab 栏 */}
            <div className="tab-bar" ref={tabBarRef}>
              {tabs.map((tab) => {
                const label = getTabLabel(tab)
                return (
                  <div
                    key={tab.id}
                    className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
                    onClick={() => setActiveTabId(tab.id)}
                    onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                  >
                    <span className="tab-label" data-label={label} title={label}>
                      {tab.kind === 'tableData' || tab.kind === 'tableDetail' ? (
                        <>
                          {tab.table}
                          {tab.schema && <span className="tab-label-suffix">@{tab.schema}</span>}
                        </>
                      ) : (
                        label
                      )}
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
            {/* Tab 内容：保持所有 tab 挂载，切换时用 CSS 隐藏（不销毁状态） */}
            <div className="tab-content">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId
                return (
                  <div key={tab.id} className={`tab-panel ${isActive ? 'tab-panel-active' : ''}`}>
                    {tab.kind === 'tableData' && tab.table && (
                      <TableData
                        connection={tab.conn}
                        schema={tab.schema}
                        tableName={tab.table}
                        tabId={tab.id}
                      />
                    )}
                    {tab.kind === 'tableDetail' && tab.table && (
                      <TableDetail
                        connection={tab.conn}
                        schema={tab.schema}
                        table={{ name: tab.table, type: 'table' }}
                      />
                    )}
                    {tab.kind === 'sql' && <SqlWorkspace connection={tab.conn} tabId={tab.id} />}
                    {tab.kind === 'chat' && <AiChat connection={tab.conn} />}
                    {tab.kind === 'database' && (
                      <DatabaseDetail
                        connection={tab.conn}
                        schema={tab.schema}
                        onOpenSql={handleOpenSql}
                        onSelectTable={handleSelectTable}
                        onOpenTableDetail={handleOpenTableDetail}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="welcome">
            <div className="welcome-card">
              <h1>AI DB Client</h1>
              <p className="welcome-subtitle">开源的 AI 原生数据库工具</p>
              <div className="welcome-features">
                <div className="feature">
                  <span className="feature-icon">
                    <Plug size={20} />
                  </span>
                  <span>多数据库连接（MySQL / PostgreSQL / SQLite / Redis）</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">
                    <Table2 size={20} />
                  </span>
                  <span>点击表名查看数据，右键查看设计/DDL</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">
                    <FileText size={20} />
                  </span>
                  <span>SQL 编辑器 + 数据网格</span>
                </div>
                <div className="feature muted-feature">
                  <span className="feature-icon">
                    <Bot size={20} />
                  </span>
                  <span>AI 对话 + MCP Server（开发中）</span>
                </div>
              </div>
              <p className="welcome-hint">
                {connections.length === 0
                  ? '点击左侧「+」创建你的第一个连接'
                  : '点击左侧连接开始浏览，右键打开 SQL 查询'}
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

      {/* Tab 右键菜单 */}
      {tabMenu && (
        <div
          className="context-menu"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="ctx-item"
            disabled={tabs.length === 0}
            onClick={() => {
              closeTab(tabMenu.tabId)
              setTabMenu(null)
            }}
          >
            <X size={12} /> 关闭当前
          </button>
          <div className="ctx-divider" />
          <button
            className="ctx-item"
            disabled={tabs.length <= 1}
            onClick={() => {
              closeOthers(tabMenu.tabId)
              setTabMenu(null)
            }}
          >
            关闭其他
          </button>
          <button
            className="ctx-item"
            disabled={tabs.every((t) => isTabDirty(t.id)) || tabs.length === 0}
            onClick={() => {
              closeUnedited()
              setTabMenu(null)
            }}
          >
            关闭未编辑
          </button>
          <div className="ctx-divider" />
          <button
            className="ctx-item"
            disabled={tabs.findIndex((t) => t.id === tabMenu.tabId) === 0}
            onClick={() => {
              closeLeft(tabMenu.tabId)
              setTabMenu(null)
            }}
          >
            关闭左侧
          </button>
          <button
            className="ctx-item"
            disabled={tabs.findIndex((t) => t.id === tabMenu.tabId) === tabs.length - 1}
            onClick={() => {
              closeRight(tabMenu.tabId)
              setTabMenu(null)
            }}
          >
            关闭右侧
          </button>
          <div className="ctx-divider" />
          <button
            className="ctx-item"
            disabled={tabs.length === 0}
            onClick={() => {
              closeAll()
              setTabMenu(null)
            }}
          >
            全部关闭
          </button>
        </div>
      )}
    </div>
  )
}
