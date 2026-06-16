/**
 * 数据库详情页
 *
 * 顶部 Tab 切换三个视图：
 * - 表：所有表/视图列表（工具栏：新建 SQL / 新建表 / 删除 / 编辑 / 导入 / 导出 / 刷新）
 * - 查询：该连接下保存的 SQL（可打开到编辑器）
 * - 角色：数据库中的角色 / 用户（无权限则提示）
 */
import { useState, useEffect, useCallback } from 'react'
import {
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
  ShieldCheck,
  ShieldOff,
  Play,
  SquarePen,
  UserRoundCog,
  StickyNotes,
} from 'lucide-react'
import {
  api,
  type ConnectionListItem,
  type Table,
  type DatabaseRole,
  type SavedQueryRecord,
} from '../api'
import { useConnectionStore } from '../store/connections'

type DetailTab = 'tables' | 'queries' | 'roles'

interface DatabaseDetailProps {
  connection: ConnectionListItem
  /** 详情页对应的 schema（MySQL 库 / PG schema / SQLite main） */
  schema: string | undefined
  onOpenSql: (conn: ConnectionListItem) => void
  /** 用预填 SQL 打开编辑器（从保存的查询打开；可携带保存查询信息用于关联） */
  onOpenSqlWithContent: (
    conn: ConnectionListItem,
    sql: string,
    savedQuery?: { id: string; name: string },
  ) => void
  onSelectTable: (conn: ConnectionListItem, schema: string | undefined, table: Table) => void
  onOpenTableDetail: (conn: ConnectionListItem, schema: string | undefined, table: string) => void
}

export function DatabaseDetail({
  connection,
  schema,
  onOpenSql,
  onOpenSqlWithContent,
  onSelectTable,
  onOpenTableDetail,
}: DatabaseDetailProps) {
  const [tab, setTab] = useState<DetailTab>('tables')

  const TABS: { key: DetailTab; label: string; icon: typeof Table2 }[] = [
    { key: 'tables', label: '表', icon: Table2 },
    { key: 'queries', label: '查询', icon: StickyNotes },
    { key: 'roles', label: '角色', icon: UserRoundCog },
  ]

  return (
    <div className="database-detail-view">
      {/* 顶部 Tab：icon 在上、文字在下 */}
      <div className="db-detail-tabs" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              className={`db-detail-tab ${active ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <Icon size={22} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {tab === 'tables' && (
        <TablesTab
          connection={connection}
          schema={schema}
          onOpenSql={onOpenSql}
          onSelectTable={onSelectTable}
          onOpenTableDetail={onOpenTableDetail}
        />
      )}
      {tab === 'queries' && (
        <QueriesTab
          connection={connection}
          onOpenSql={onOpenSql}
          onOpenSqlWithContent={onOpenSqlWithContent}
        />
      )}
      {tab === 'roles' && <RolesTab connection={connection} />}
    </div>
  )
}

// ===== 表 Tab =====

interface TablesTabProps {
  connection: ConnectionListItem
  schema: string | undefined
  onOpenSql: (conn: ConnectionListItem) => void
  onSelectTable: (conn: ConnectionListItem, schema: string | undefined, table: Table) => void
  onOpenTableDetail: (conn: ConnectionListItem, schema: string | undefined, table: string) => void
}

function TablesTab({ connection, schema, onSelectTable, onOpenTableDetail }: TablesTabProps) {
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const loadData = useCallback(async () => {
    if (!schema) return
    setLoading(true)
    setError(null)
    try {
      const ts = await api['db:listTables']({ connectionId: connection.id, schema })
      const allTables = ts
        .map((t) => ({ ...t, schema }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setTables(allTables)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [connection.id, schema])

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
      const qualified =
        connection.type === 'postgres' && schema
          ? `"${schema}"."${tableName}"`
          : connection.type === 'mysql' && schema
            ? `\`${schema}\`.\`${tableName}\``
            : `"${tableName}"`
      const sql = `DROP TABLE ${qualified}`
      await api['db:confirmExecute']({ connectionId: connection.id, sql })
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {/* 工具栏 */}
      <div className="table-data-toolbar-bar">
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
              <span className="db-detail-name" title={`${table.name}（${table.schema ?? ''}）`}>
                {table.name}
              </span>
              {table.estimatedRows !== undefined && (
                <span className="db-detail-rows">{table.estimatedRows.toLocaleString()} 行</span>
              )}
              {table.comment && (
                <span className="db-detail-comment" title={table.comment}>
                  {table.comment}
                </span>
              )}
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
    </>
  )
}

// ===== 查询 Tab =====

interface QueriesTabProps {
  connection: ConnectionListItem
  onOpenSql: (conn: ConnectionListItem) => void
  onOpenSqlWithContent: (
    conn: ConnectionListItem,
    sql: string,
    savedQuery?: { id: string; name: string },
  ) => void
}

function QueriesTab({ connection, onOpenSql, onOpenSqlWithContent }: QueriesTabProps) {
  const [records, setRecords] = useState<SavedQueryRecord[]>([])
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = keyword.trim()
        ? await api['savedQuery:search']({ keyword })
        : await api['savedQuery:list']({ connectionId: connection.id })
      setRecords(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [connection.id, keyword])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入查询 tab 时加载是合法模式
    load()
  }, [load])

  // 保存查询（在 SQL 编辑器中 Cmd/Ctrl+S）会自增全局 refreshTick，据此刷新列表
  const refreshTick = useConnectionStore((s) => s.refreshTick)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部保存后刷新列表是合法模式
    if (refreshTick > 0) load()
  }, [refreshTick, load])

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除此保存的查询？')) return
    try {
      await api['savedQuery:delete']({ id })
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <div className="table-data-toolbar-bar">
        <abbr title="新建 SQL 查询">
          <button className="icon-btn" onClick={() => onOpenSql(connection)}>
            <SquarePen size={14} />
          </button>
        </abbr>
        <div className="toolbar-spacer" />
        <abbr title="刷新">
          <button className="icon-btn" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </abbr>
      </div>

      {/* 搜索框 */}
      <div className="db-detail-search-bar">
        <Search size={12} />
        <input
          className="db-detail-search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索保存的查询…"
        />
        <span className="db-detail-count">{records.length} 条</span>
      </div>

      {loading && (
        <div className="detail-loading">
          <Loader2 size={16} className="spin" /> 加载保存的查询…
        </div>
      )}
      {error && <div className="detail-error">{error}</div>}

      {!loading && !error && (
        <div className="db-detail-table-list">
          {records.map((r) => (
            <div
              key={r.id}
              className="db-detail-row db-saved-query-row"
              onDoubleClick={() =>
                onOpenSqlWithContent(connection, r.sqlText, { id: r.id, name: r.name })
              }
              title="双击在编辑器中打开"
            >
              <span className="db-detail-table-icon">
                <Table2 size={14} />
              </span>
              <div className="db-saved-query-text">
                <span className="db-saved-query-name" title={r.name}>
                  {r.name}
                </span>
              </div>
              <div className="toolbar-spacer" />
              <abbr title="在编辑器中打开">
                <button
                  className="icon-btn db-detail-action"
                  onClick={() =>
                    onOpenSqlWithContent(connection, r.sqlText, { id: r.id, name: r.name })
                  }
                >
                  <Play size={13} />
                </button>
              </abbr>
              <abbr title="删除">
                <button className="icon-btn db-detail-action" onClick={() => handleDelete(r.id)}>
                  <Trash2 size={13} />
                </button>
              </abbr>
            </div>
          ))}
          {records.length === 0 && (
            <div className="db-detail-empty">
              {keyword ? '未找到匹配的查询' : '暂无保存的查询'}
              <div className="db-detail-empty-hint">在 SQL 编辑器中点击「保存」可收藏常用查询</div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ===== 角色 Tab =====

interface RolesTabProps {
  connection: ConnectionListItem
}

function RolesTab({ connection }: RolesTabProps) {
  const [roles, setRoles] = useState<DatabaseRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 是否因无权限而失败（消息含权限相关关键词） */
  const [denied, setDenied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setDenied(false)
    try {
      const list = await api['db:listRoles']({ connectionId: connection.id })
      setRoles(list)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      // 权限不足的典型信号：access denied / permission denied / must be / 不允许
      setDenied(/denied|permission|must be|不允许|无权|权限/i.test(msg))
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入角色 tab 时加载是合法模式
    load()
  }, [load])

  return (
    <>
      <div className="table-data-toolbar-bar">
        <div className="toolbar-spacer" />
        <abbr title="刷新">
          <button className="icon-btn" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </abbr>
      </div>

      {loading && (
        <div className="detail-loading">
          <Loader2 size={16} className="spin" /> 加载角色列表…
        </div>
      )}

      {!loading && denied && (
        <div className="db-detail-role-denied">
          <ShieldOff size={28} />
          <div className="db-detail-role-denied-title">无权限读取角色</div>
          <div className="db-detail-role-denied-desc">
            当前连接的数据库用户没有查询角色/用户列表的权限。
          </div>
          {error && <div className="db-detail-role-denied-detail">{error}</div>}
        </div>
      )}

      {!loading && !denied && error && <div className="detail-error">{error}</div>}

      {!loading && !error && !denied && (
        <div className="db-detail-table-list">
          {roles.map((role) => (
            <div key={role.name} className="db-detail-row db-role-row">
              <span className="db-detail-table-icon">
                <ShieldCheck size={15} />
              </span>
              <span className="db-detail-name" title={role.name}>
                {role.name}
              </span>
              {role.kind && <span className="db-role-kind">{role.kind}</span>}
              {role.canLogin !== undefined && (
                <span className={`db-role-login ${role.canLogin ? 'yes' : 'no'}`}>
                  {role.canLogin ? '可登录' : '不可登录'}
                </span>
              )}
              {role.memberCount !== undefined && (
                <span className="db-role-members">{role.memberCount} 成员</span>
              )}
              {role.comment && (
                <span className="db-detail-comment" title={role.comment}>
                  {role.comment}
                </span>
              )}
            </div>
          ))}
          {roles.length === 0 && (
            <div className="db-detail-empty">
              暂无角色
              <div className="db-detail-empty-hint">该数据库类型没有角色/用户概念</div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
