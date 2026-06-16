/**
 * 应用根组件
 *
 * 布局：左侧边栏（对象树）+ 右侧主内容区（tab 视图）。
 * 连接管理以 modal 形式浮层展示，不遮挡主视图。
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Settings as SettingsIcon,
  Plug,
  Table2,
  FileText,
  Bot,
  X,
  Code2,
  Sparkles,
} from 'lucide-react'
import { type ConnectionListItem, type Table } from './api'
import { useConnectionStore } from './store/connections'
import { useTabStore } from './store/tabs'
import { useWorkspaceStore } from './store/workspace'
import { useSettingsStore } from './store/settings'
import { useLlmProviderStore } from './store/llm-providers'
import { ObjectTree } from './components/ObjectTree'
import { TableData } from './components/TableData'
import { DatabaseDetail } from './components/DatabaseDetail'
import { TableDetail } from './components/TableDetail'
import { WorkspaceContainer } from './components/WorkspaceContainer'
import { AgentWorkspace } from './components/AgentWorkspace'
import { ConnectionManager } from './pages/ConnectionManager'
import { Settings } from './pages/Settings'
import { WindowControls } from './components/WindowControls'
import { useContextMenuClose } from './hooks/useContextMenu'

/** 主内容区的 tab 类型 */
interface Tab {
  id: string
  // workspace = 统一 AI 工作区（内部按全局模式切换编辑器/AGENT）
  kind: 'tableData' | 'tableDetail' | 'workspace' | 'database'
  conn: ConnectionListItem
  schema?: string
  table?: string
}

function getTabLabel(tab: Tab): string {
  if (tab.kind === 'workspace') {
    const db = tab.conn.database || tab.conn.name
    return db + '@' + tab.conn.name
  }
  if (tab.kind === 'database') {
    const db = tab.conn.database || tab.conn.name
    return tab.schema ? `${db}@${tab.schema}` : db
  }
  if (tab.kind === 'tableDetail') {
    return tab.schema ? `设计:${tab.table}@${tab.schema}` : `设计:${tab.table}`
  }
  // 表数据：表名@库名（schema 为表所属库，来自点击时的对象树）
  return tab.schema ? `${tab.table}@${tab.schema}` : (tab.table ?? '')
}

export default function App() {
  const { connections, loadConnections } = useConnectionStore()
  const workspaceMode = useWorkspaceStore((s) => s.mode)
  const setWorkspaceMode = useWorkspaceStore((s) => s.setMode)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  /** AGENT 覆盖层要求带入输入框的初始文本（如 `#db_a 统计订单`） */
  const [pendingAgentInput, setPendingAgentInput] = useState<string>('')
  const [connectionModal, setConnectionModal] = useState<{
    mode: 'create' | 'edit'
    connection?: ConnectionListItem
  } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 打开设置时默认定位的 tab（如 Agent 模式「配置模型」直达模型设置） */
  const [settingsTab, setSettingsTab] = useState<'general' | 'model' | 'about'>('general')
  const tabBarRef = useRef<HTMLDivElement>(null)

  // 激活 tab 变化时，把 active tab 滚进可视区（横向滚动条跟随）
  useEffect(() => {
    if (!activeTabId || !tabBarRef.current) return
    const activeEl = tabBarRef.current.querySelector<HTMLDivElement>('.tab-item.active')
    activeEl?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activeTabId])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  // 首屏加载应用设置（主题偏好等），失败不阻塞应用启动
  const loadSettings = useSettingsStore((s) => s.load)
  useEffect(() => {
    loadSettings().catch(() => {})
  }, [loadSettings])

  // 首屏加载 LLM Provider 列表（Agent 模式左下角「选择模型」依赖它）
  const loadProviders = useLlmProviderStore((s) => s.load)
  useEffect(() => {
    loadProviders().catch(() => {})
  }, [loadProviders])

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
    setWorkspaceMode('editor')
    openTab({
      id: `${conn.id}:workspace:${Date.now()}`,
      kind: 'workspace',
      conn,
    })
  }

  const handleOpenChat = (conn: ConnectionListItem) => {
    // AGENT 是全局覆盖层：切到 agent 模式，带入 `#数据库名 ` 前缀
    setPendingAgentInput(`#${conn.name} `)
    setWorkspaceMode('agent')
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
  useContextMenuClose(tabMenu !== null, () => setTabMenu(null))

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
          {/* 全局工作区模式切换（Segmented） */}
          <div className="mode-segmented" role="tablist" aria-label="工作区模式">
            <button
              role="tab"
              aria-selected={workspaceMode === 'editor'}
              className={`mode-seg-btn ${workspaceMode === 'editor' ? 'active' : ''}`}
              onClick={() => setWorkspaceMode('editor')}
              title="编辑器模式：人主导，AI 辅助补全/生成 SQL"
            >
              <Code2 size={13} /> 编辑器
            </button>
            <button
              role="tab"
              aria-selected={workspaceMode === 'agent'}
              className={`mode-seg-btn ${workspaceMode === 'agent' ? 'active' : ''}`}
              onClick={() => setWorkspaceMode('agent')}
              title="AGENT 模式：AI 主导，自主调用工具完成任务"
            >
              <Sparkles size={13} /> AGENT
            </button>
          </div>
          <div className="brand-spacer" />
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
        {/* AGENT 全局覆盖层：独立于 tab 系统，模式切换即显隐，带过渡动画 */}
        <div
          className={`agent-overlay ${workspaceMode === 'agent' ? 'agent-overlay-visible' : ''}`}
        >
          <AgentWorkspace
            initialInput={pendingAgentInput}
            onOpenSettings={() => {
              setSettingsTab('model')
              setSettingsOpen(true)
            }}
          />
        </div>

        {/* 常规主区（编辑器/表格/数据库详情） */}
        <div className={`main-area ${workspaceMode === 'agent' ? 'main-area-hidden' : ''}`}>
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
                      {tab.kind === 'workspace' && (
                        <WorkspaceContainer connection={tab.conn} tabId={tab.id} />
                      )}
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
                    <span>SQL 编辑器 + AI 补全（编辑器模式）</span>
                  </div>
                  <div className="feature">
                    <span className="feature-icon">
                      <Bot size={20} />
                    </span>
                    <span>AI AGENT：自然语言驱动，自主查询与分析数据（AGENT 模式）</span>
                  </div>
                </div>
                <p className="welcome-hint">
                  {connections.length === 0
                    ? '点击左侧「+」创建你的第一个连接'
                    : '右键点击左侧连接 → 「SQL 查询（编辑器）」或「AI AGENT」开始'}
                </p>
              </div>
            </div>
          )}
        </div>
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
      {settingsOpen && <Settings initialTab={settingsTab} onClose={() => setSettingsOpen(false)} />}

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
