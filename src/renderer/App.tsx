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
  ArrowLeftRight,
} from 'lucide-react'
import { type ConnectionListItem, type Table } from './api'
import { useConnectionStore } from './store/connections'
import { useTabStore } from './store/tabs'
import { useWorkspaceStore } from './store/workspace'
import { useSettingsStore } from './store/settings'
import { useLlmProviderStore } from './store/llm-providers'
import { useUpdateStore } from './store/update'
import { ObjectTree } from './components/ObjectTree'
import { TableData } from './components/TableData'
import { DatabaseDetail } from './components/DatabaseDetail'
import { TableDetail } from './components/TableDetail'
import { WorkspaceContainer } from './components/WorkspaceContainer'
import { AgentWorkspace } from './components/AgentWorkspace'
import { MigrationWorkspace } from './components/MigrationWorkspace'
import { ConnectionManager } from './pages/ConnectionManager'
import { Settings } from './pages/Settings'
import { WindowControls } from './components/WindowControls'
import { UpdateReadyBanner } from './components/UpdateReadyBanner'
import { useContextMenuClose } from './hooks/useContextMenu'
import logoUrl from './assets/logo.webp'

/** 主内容区的 tab 类型 */
interface Tab {
  id: string
  // workspace = 统一 AI 工作区（内部按全局模式切换编辑器/AGENT）
  // migration = 跨库迁移工作区（不绑定单个连接）
  kind: 'tableData' | 'tableDetail' | 'workspace' | 'database' | 'migration'
  conn: ConnectionListItem
  schema?: string
  table?: string
  /** workspace 预填 SQL（从保存的查询打开时） */
  initialSql?: string
  /** workspace 关联的保存查询 id（之后保存直接更新该记录） */
  savedQueryId?: string
  /** workspace 关联的保存查询名称（作为 tab 标题） */
  savedQueryName?: string
}

function getTabLabel(tab: Tab): string {
  if (tab.kind === 'migration') return '数据库迁移'
  if (tab.kind === 'workspace') {
    // 标题格式：查询名@数据库（已关联保存查询）/ 新建查询@数据库（尚未保存）
    const db = tab.conn.database || tab.conn.name
    const name = tab.savedQueryName ?? '新建查询'
    return `${name}@${db}`
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
  const refreshProviders = useLlmProviderStore((s) => s.refresh)
  useEffect(() => {
    loadProviders().catch(() => {})
  }, [loadProviders])

  // 初始化更新 store：同步当前状态 + 订阅主进程推送的更新事件
  const initUpdate = useUpdateStore((s) => s.init)
  useEffect(() => {
    const unsubscribe = initUpdate()
    return () => {
      // init 返回 Promise<取消订阅>，异步解析后执行取消；组件卸载时确保解绑
      unsubscribe.then((off) => off()).catch(() => {})
    }
  }, [initUpdate])

  const openTab = useCallback((tab: Tab, matchBy?: (t: Tab) => boolean) => {
    let activateId = tab.id
    setTabs((prev) => {
      // 默认按 id 去重；传入 matchBy 时按身份去重（如同一保存查询，无论 tab id 是否迁移过）
      const existing = matchBy ? prev.find((t) => matchBy(t)) : prev.find((t) => t.id === tab.id)
      if (existing) {
        activateId = existing.id
        return prev
      }
      return [...prev, tab]
    })
    // 在 setTabs 的 reducer 同步执行后 activateId 已是最终值，再触发激活
    setActiveTabId(activateId)
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

  /** 用预填 SQL 打开编辑器（从保存的查询打开时） */
  const handleOpenSqlWithContent = (
    conn: ConnectionListItem,
    sql: string,
    savedQuery?: { id: string; name: string },
  ) => {
    setWorkspaceMode('editor')
    const tabId = `${conn.id}:workspace:${savedQuery ? `sq:${savedQuery.id}` : `new:${Date.now()}`}`
    // 按保存查询身份去重：同一连接下同一查询，无论 tab 是双击打开(sq) 还是新建后保存(workspace)，
    // 都复用/激活同一个 tab，不重复打开。
    const matchBy = savedQuery
      ? (t: Tab) =>
          t.kind === 'workspace' && t.conn.id === conn.id && t.savedQueryId === savedQuery.id
      : undefined
    openTab(
      {
        id: tabId,
        kind: 'workspace',
        conn,
        initialSql: sql,
        savedQueryId: savedQuery?.id,
        savedQueryName: savedQuery?.name,
      },
      matchBy,
    )
  }

  /**
   * 新建查询首次保存后回调：把当前 tab 关联到刚创建的保存查询。
   * 保留原 tab id（迁移 id 会因 key 变化导致 SqlWorkspace 重挂载、丢失状态），
   * 只更新 savedQueryId/savedQueryName：
   * - tab 标题随之变为「查询名@数据库」
   * - 之后双击同一查询时，handleOpenSqlWithContent 的身份去重能命中本 tab 并激活
   */
  const handleQueryBound = useCallback(
    (currentTabId: string, savedQuery: { id: string; name: string }) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === currentTabId
            ? { ...t, savedQueryId: savedQuery.id, savedQueryName: savedQuery.name }
            : t,
        ),
      )
    },
    [],
  )

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
            className="btn-icon sidebar-migration-btn"
            onClick={() =>
              openTab({
                id: 'migration',
                kind: 'migration',
                conn: connections[0] ?? ({} as ConnectionListItem),
              })
            }
            title="数据库迁移：结构/数据 diff + 跨库迁移"
          >
            <ArrowLeftRight size={15} />
          </button>
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
                  const dirty = isTabDirty(tab.id)
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
                      {/* 脏标记：未保存修改时显示实心圆点 */}
                      {dirty && <span className="tab-dirty-dot" title="有未保存的修改" />}
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
                        <WorkspaceContainer
                          connection={tab.conn}
                          tabId={tab.id}
                          initialSql={tab.initialSql}
                          savedQueryId={tab.savedQueryId}
                          onQueryBound={(sq) => handleQueryBound(tab.id, sq)}
                        />
                      )}
                      {tab.kind === 'database' && (
                        <DatabaseDetail
                          connection={tab.conn}
                          schema={tab.schema}
                          onOpenSql={handleOpenSql}
                          onOpenSqlWithContent={handleOpenSqlWithContent}
                          onSelectTable={handleSelectTable}
                          onOpenTableDetail={handleOpenTableDetail}
                        />
                      )}
                      {tab.kind === 'migration' && <MigrationWorkspace />}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="welcome">
              <div className="welcome-card">
                <img className="welcome-logo" src={logoUrl} alt="AI DB Client" />
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
      {settingsOpen && (
        <Settings
          initialTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false)
            // 关闭设置后刷新 Provider 列表：确保 Agent 模式「选择模型」即时同步
            refreshProviders().catch(() => {})
          }}
        />
      )}

      {/* 更新就绪弹窗：任何界面下下载完成后均提示重启 */}
      <UpdateReadyBanner />

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
