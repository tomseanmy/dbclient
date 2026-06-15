/**
 * 表详情面板
 *
 * 选中表后展示：列、索引、外键、DDL。
 * 对于 Redis 连接，展示 key 概览。
 */
import { useEffect, useState } from 'react'
import { Copy, Loader2, Eye, KeyRound } from 'lucide-react'
import {
  api,
  type ConnectionListItem,
  type Table,
  type TableMeta,
  type RedisKeyOverview,
} from '../api'
import { DB_LABELS } from '../store/connections'

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

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换表时重置加载状态是合法模式
    setLoading(true)
    setError(null)
    setMeta(null)
    setRedisOverview(null)

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
  }, [connection.id, connection.type, schema, table.name])

  const copyDdl = async () => {
    if (meta?.ddl) {
      await navigator.clipboard.writeText(meta.ddl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  // Redis 概览视图
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

  return (
    <div className="table-detail">
      <div className="detail-header">
        <div>
          <h2>
            {table.type === 'view' ? (
              <Eye size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
            ) : (
              <Copy size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
            )}{' '}
            {schema ? `${schema}.` : ''}
            {table.name}
          </h2>
          {table.comment && <p className="table-comment">{table.comment}</p>}
          {table.estimatedRows !== undefined && (
            <span className="row-badge">≈ {table.estimatedRows.toLocaleString()} 行</span>
          )}
        </div>
      </div>

      {loading && (
        <div className="detail-loading">
          <Loader2 size={16} className="spin" /> 加载表结构…
        </div>
      )}
      {error && <div className="detail-error">{error}</div>}

      {meta && (
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
