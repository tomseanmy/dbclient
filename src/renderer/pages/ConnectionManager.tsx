/**
 * 连接管理（modal 弹窗）
 *
 * 以浮层形式展示，不遮挡主视图。
 * 列出所有连接，支持新建/编辑/删除/克隆。
 */
import { useState } from 'react'
import { Plus, Pencil, Trash2, Copy, X } from 'lucide-react'
import { api, type ConnectionListItem } from '../api'
import { useConnectionStore, DB_LABELS, ENV_LABELS, ENV_COLORS } from '../store/connections'
import { ConnectionForm } from '../components/ConnectionForm'

interface ConnectionManagerProps {
  onClose: () => void
}

export function ConnectionManager({ onClose }: ConnectionManagerProps) {
  const { connections, loadConnections } = useConnectionStore()
  const [editing, setEditing] = useState<ConnectionListItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<ConnectionListItem | null>(null)

  const handleSaved = async () => {
    await loadConnections()
    setCreating(false)
    setEditing(null)
  }

  const handleDelete = async (conn: ConnectionListItem) => {
    await api['connection:delete']({ id: conn.id })
    await loadConnections()
    setDeleteConfirm(null)
  }

  const handleClone = async (conn: ConnectionListItem) => {
    await api['connection:create']({
      name: conn.name + ' (副本)',
      type: conn.type,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      database: conn.database,
      environment: conn.environment,
      color: conn.color,
      sortOrder: conn.sortOrder,
    })
    await loadConnections()
  }

  // 新建/编辑表单视图
  if (creating || editing) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="connection-manager-modal" onClick={(e) => e.stopPropagation()}>
          <div className="page-connection-manager">
            <div className="page-header">
              <h1>{editing ? '编辑连接' : '新建连接'}</h1>
              <button
                className="btn-icon"
                onClick={() => {
                  setCreating(false)
                  setEditing(null)
                }}
              >
                <X size={18} />
              </button>
            </div>
            <ConnectionForm
              initial={editing}
              onSave={handleSaved}
              onCancel={() => {
                setCreating(false)
                setEditing(null)
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  // 列表视图
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="connection-manager-modal" onClick={(e) => e.stopPropagation()}>
        <div className="page-connection-manager">
          <div className="page-header">
            <h1>连接管理</h1>
            <div className="page-header-actions">
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> 新建连接
              </button>
              <button className="btn-icon" onClick={onClose}>
                <X size={18} />
              </button>
            </div>
          </div>

          {connections.length === 0 ? (
            <div className="empty-state">
              <p>还没有任何连接</p>
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                创建第一个连接
              </button>
            </div>
          ) : (
            <div className="connection-grid">
              {connections.map((conn) => (
                <div key={conn.id} className="connection-card">
                  <div className="card-top">
                    <span
                      className="conn-type-badge"
                      style={{ background: conn.color || '#6b7280' }}
                    >
                      {DB_LABELS[conn.type]}
                    </span>
                    <span
                      className="env-badge"
                      style={{
                        background: ENV_COLORS[conn.environment] + '20',
                        color: ENV_COLORS[conn.environment],
                      }}
                    >
                      {ENV_LABELS[conn.environment]}
                    </span>
                  </div>
                  <h3 className="card-name">{conn.name}</h3>
                  <p className="card-detail">
                    {conn.type === 'sqlite' ? conn.database : conn.host + ':' + conn.port}
                  </p>
                  {conn.username && <p className="card-detail muted">@{conn.username}</p>}
                  {conn.database && conn.type !== 'sqlite' && (
                    <p className="card-detail muted">/{conn.database}</p>
                  )}
                  <div className="card-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(conn)}>
                      <Pencil size={12} /> 编辑
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleClone(conn)}>
                      <Copy size={12} /> 克隆
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setDeleteConfirm(conn)}
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 删除确认弹窗 */}
          {deleteConfirm && (
            <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>确认删除</h3>
                <p>确定要删除连接「{deleteConfirm.name}」吗？此操作不可撤销。</p>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>
                    取消
                  </button>
                  <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>
                    删除
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
