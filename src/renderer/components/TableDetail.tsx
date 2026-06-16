/**
 * 表详情面板
 *
 * 选中表后：
 * - SQL 数据库（MySQL/PG/SQLite）的 table：直接进入表结构编辑器（行内编辑列/索引/外键），
 *   下方实时生成 DDL 预览，点「保存」时经安全检查后执行该 DDL。
 * - view：只读展示结构（不可改）。
 * - Redis：展示 key 概览。
 */
import { useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, KeyRound, Save, AlertTriangle } from 'lucide-react'
import {
  api,
  type ConnectionListItem,
  type Table,
  type TableMeta,
  type RedisKeyOverview,
  type SecurityCheckResult,
} from '../api'
import { DB_LABELS } from '../store/connections'
import { TableStructureEditor, toDraftMeta } from './table-edit/TableStructureEditor'
import {
  buildAlterStatements,
  diffTableMeta,
  type DraftTableMeta,
  type TableDialect,
} from '@shared/db/alter-generator'
import { ConfirmDialog } from './ConfirmDialog'
import { PermissionNotice } from './PermissionNotice'

interface TableDetailProps {
  connection: ConnectionListItem
  schema?: string
  table: Table
}

export function TableDetail({ connection, schema, table }: TableDetailProps) {
  const [meta, setMeta] = useState<TableMeta | null>(null)
  const [redisOverview, setRedisOverview] = useState<RedisKeyOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'columns' | 'indexes' | 'foreignKeys' | 'ddl'>('columns')
  const [copied, setCopied] = useState(false)

  // ---- 编辑状态（SQL table 默认进入编辑，点开即编辑） ----
  const [draft, setDraft] = useState<DraftTableMeta | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmCheck, setConfirmCheck] = useState<SecurityCheckResult | null>(null)
  const [confirmSql, setConfirmSql] = useState('')
  const [deniedCheck, setDeniedCheck] = useState<SecurityCheckResult | null>(null)

  /** SQL 数据库（Redis 无 SQL，view 不改结构） */
  const isSqlTable =
    (connection.type === 'mysql' ||
      connection.type === 'postgres' ||
      connection.type === 'sqlite') &&
    table.type === 'table'
  const dialect = connection.type as TableDialect

  /** 当前未保存变更数（保存按钮启用判定） */
  const changedCount = useMemo(() => {
    if (!meta || !draft) return 0
    const d = diffTableMeta(meta, draft)
    return (
      d.columns.added.length +
      d.columns.removed.length +
      d.columns.changed.length +
      d.indexes.added.length +
      d.indexes.removed.length +
      d.indexes.changed.length +
      d.foreignKeys.added.length +
      d.foreignKeys.removed.length +
      d.foreignKeys.changed.length
    )
  }, [meta, draft])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换表时重置状态是合法模式
    setLoading(true)
    setError(null)
    setMeta(null)
    setRedisOverview(null)
    setDraft(null)
    setEditError(null)

    if (connection.type === 'redis') {
      api['db:getRedisOverview']({ connectionId: connection.id })
        .then((overview) => {
          if (!cancelled) {
            setRedisOverview(overview)
            setLoading(false)
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err))
            setLoading(false)
          }
        })
      return () => {
        cancelled = true
      }
    }

    api['db:describeTable']({ connectionId: connection.id, schema, table: table.name })
      .then((m) => {
        if (!cancelled) {
          setMeta(m)
          // SQL table：加载完成即进入编辑（草稿 = 原始结构的副本）
          if (isSqlTable) setDraft(toDraftMeta(m))
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [connection.id, connection.type, schema, table.name, isSqlTable])

  const copyDdl = async () => {
    if (meta?.ddl) {
      await navigator.clipboard.writeText(meta.ddl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  /**
   * 保存：生成 ALTER → 一次安全预检（checkSql）→ 按 allow/confirm/deny 分流。
   * 镜像 SqlWorkspace.handleExecute/handleConfirm 的既有写法。
   * 实际执行逐条走 db:confirmExecute（规避 SQLite 多语句限制；单条 DROP 仍需关键词）。
   */
  const handleSave = async () => {
    if (!meta || !draft) return
    setEditError(null)
    setSaving(true)
    try {
      const { statements } = buildAlterStatements(dialect, meta, draft)
      if (statements.length === 0) {
        setEditError('没有可生成的变更')
        setSaving(false)
        return
      }
      // 合并脚本仅用于一次安全预检（展示 + 风险判定）
      const joined = statements.join(';\n') + ';'

      const check = await api['db:checkSql']({ connectionId: connection.id, sql: joined })
      if (check.denied) {
        setDeniedCheck(check)
        setSaving(false)
        return
      }
      // 需要确认，或含 DROP/TRUNCATE 等最高危操作（即便环境允许，单条仍需关键词）→ 走确认弹窗
      if (check.confirmRequired || check.requireKeywordConfirm) {
        setConfirmCheck(check)
        setConfirmSql(joined)
        setSaving(false)
        return
      }
      await runStatements(statements)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  /** 逐条执行 ALTER。keyword 用于 DROP/TRUNCATE 等需关键词确认的单条语句。 */
  const runStatements = async (statements: string[], keyword?: string) => {
    setSaving(true)
    setEditError(null)
    try {
      for (const stmt of statements) {
        await api['db:confirmExecute']({
          connectionId: connection.id,
          sql: stmt,
          confirmedKeyword: keyword,
        })
      }
      // 成功 → 重新拉取结构，草稿重置为新结构的副本
      const fresh = await api['db:describeTable']({
        connectionId: connection.id,
        schema,
        table: table.name,
      })
      setMeta(fresh)
      setDraft(toDraftMeta(fresh))
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  /** 确认弹窗确认后执行（带关键词，逐条仍需关键词） */
  const handleConfirm = async (keyword?: string) => {
    setConfirmCheck(null)
    try {
      const { statements } = buildAlterStatements(dialect, meta!, draft!)
      await runStatements(statements, keyword)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
    }
  }

  // ===== Redis 概览视图 =====
  if (connection.type === 'redis') {
    return (
      <div className="table-detail">
        <div className="detail-header">
          <h2>
            {DB_LABELS[connection.type]} · {connection.name}
          </h2>
        </div>
        {loading && (
          <div className="detail-loading">
            <Loader2 size={16} className="spin" /> 加载中…
          </div>
        )}
        {error && <div className="detail-error">{error}</div>}
        {redisOverview && (
          <div className="redis-overview">
            {redisOverview.serverInfo && (
              <p className="server-info">服务器版本：Redis {redisOverview.serverInfo}</p>
            )}
            <table className="data-table">
              <thead>
                <tr>
                  <th>DB Index</th>
                  <th>Key 数量</th>
                </tr>
              </thead>
              <tbody>
                {redisOverview.databases
                  .filter((d) => d.keyCount > 0)
                  .map((d) => (
                    <tr key={d.index}>
                      <td>db{d.index}</td>
                      <td>{d.keyCount.toLocaleString()}</td>
                    </tr>
                  ))}
                {redisOverview.databases.filter((d) => d.keyCount > 0).length === 0 && (
                  <tr>
                    <td colSpan={2} className="empty">
                      无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ===== 通用头部 =====
  // const renderHeader = (extra?: React.ReactNode) => (
  //   <div className="detail-header">
  //     <div>
  //       <h2>
  //         {table.type === 'view' ? (
  //           <Eye size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
  //         ) : (
  //           <Copy size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
  //         )}{' '}
  //         {schema ? `${schema}.` : ''}
  //         {table.name}
  //       </h2>
  //       {table.comment && <p className="table-comment">{table.comment}</p>}
  //       {table.estimatedRows !== undefined && (
  //         <span className="row-badge">≈ {table.estimatedRows.toLocaleString()} 行</span>
  //       )}
  //     </div>
  //     {extra}
  //   </div>
  // )

  return (
    <div className="table-detail">
      {/* {renderHeader()} */}

      {loading && (
        <div className="detail-loading">
          <Loader2 size={16} className="spin" /> 加载表结构…
        </div>
      )}
      {error && <div className="detail-error">{error}</div>}

      {editError && (
        <div className="detail-error edit-error-bar">
          <AlertTriangle size={14} /> {editError}
        </div>
      )}
      {deniedCheck && (
        <PermissionNotice
          check={deniedCheck}
          connectionId={connection.id}
          onElevated={() => setDeniedCheck(null)}
          onDismiss={() => setDeniedCheck(null)}
        />
      )}
      {confirmCheck && (
        <ConfirmDialog
          check={confirmCheck}
          sql={confirmSql}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmCheck(null)}
        />
      )}

      {/* SQL table：直接进入表结构编辑器（DDL 预览在编辑器内部） */}
      {meta && isSqlTable && draft && (
        <TableStructureEditor
          original={meta}
          draft={draft}
          onChange={setDraft}
          dialect={dialect}
          headerExtra={
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={saving || changedCount === 0}
              title={changedCount === 0 ? '无变更' : `保存 ${changedCount} 项变更`}
            >
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            </button>
          }
        />
      )}

      {/* view / 非 table：只读结构展示 */}
      {meta && !isSqlTable && (
        <>
          <div className="detail-tabs">
            <button
              className={`tab ${tab === 'columns' ? 'active' : ''}`}
              onClick={() => setTab('columns')}
            >
              列 ({meta.columns.length})
            </button>
            <button
              className={`tab ${tab === 'indexes' ? 'active' : ''}`}
              onClick={() => setTab('indexes')}
            >
              索引 ({meta.indexes.length})
            </button>
            {meta.foreignKeys.length > 0 && (
              <button
                className={`tab ${tab === 'foreignKeys' ? 'active' : ''}`}
                onClick={() => setTab('foreignKeys')}
              >
                外键 ({meta.foreignKeys.length})
              </button>
            )}
            {meta.ddl && (
              <button
                className={`tab ${tab === 'ddl' ? 'active' : ''}`}
                onClick={() => setTab('ddl')}
              >
                DDL
              </button>
            )}
          </div>

          {tab === 'columns' && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>列名</th>
                  <th>类型</th>
                  <th>可空</th>
                  <th>主键</th>
                  <th>默认值</th>
                  <th>注释</th>
                </tr>
              </thead>
              <tbody>
                {meta.columns.map((col) => (
                  <tr key={col.name}>
                    <td className="col-name">
                      {col.isPrimaryKey && (
                        <span className="pk-badge" title="主键">
                          <KeyRound size={10} style={{ display: 'inline' }} />
                        </span>
                      )}
                      {col.name}
                    </td>
                    <td>
                      <span className={`type-badge type-${col.unifiedType}`}>
                        {col.dataType}
                        {col.length ? `(${col.length})` : ''}
                      </span>
                    </td>
                    <td>
                      {col.nullable ? (
                        <span className="yes">是</span>
                      ) : (
                        <span className="no">否</span>
                      )}
                    </td>
                    <td>{col.isPrimaryKey ? '✓' : ''}</td>
                    <td className="mono">
                      {col.defaultValue ?? (col.autoIncrement ? '自增' : '')}
                    </td>
                    <td className="muted">{col.comment ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'indexes' && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>索引名</th>
                  <th>列</th>
                  <th>唯一</th>
                  <th>类型</th>
                </tr>
              </thead>
              <tbody>
                {meta.indexes.map((idx) => (
                  <tr key={idx.name}>
                    <td className="col-name">
                      {idx.isPrimaryKey && (
                        <span className="pk-badge">
                          <KeyRound size={10} style={{ display: 'inline' }} />
                        </span>
                      )}
                      {idx.name}
                    </td>
                    <td>{idx.columns.join(', ')}</td>
                    <td>{idx.isUnique ? '✓' : ''}</td>
                    <td className="muted">
                      {(idx.type ?? idx.isPrimaryKey) ? 'PRIMARY' : 'BTREE'}
                    </td>
                  </tr>
                ))}
                {meta.indexes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">
                      无索引
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {tab === 'foreignKeys' && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>列</th>
                  <th>引用表</th>
                  <th>引用列</th>
                  <th>ON DELETE</th>
                </tr>
              </thead>
              <tbody>
                {meta.foreignKeys.map((fk) => (
                  <tr key={fk.name}>
                    <td>{fk.name}</td>
                    <td>{fk.columns.join(', ')}</td>
                    <td className="col-name">{fk.referencesTable}</td>
                    <td>{fk.referencesColumns.join(', ')}</td>
                    <td className="muted">{fk.onDelete ?? 'NO ACTION'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'ddl' && meta.ddl && (
            <div className="ddl-section">
              <button className="btn btn-secondary btn-sm" onClick={copyDdl}>
                <Copy size={12} /> {copied ? '已复制!' : '复制 DDL'}
              </button>
              <pre className="ddl-code">{meta.ddl}</pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}
