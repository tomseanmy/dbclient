/**
 * 连接配置 modal。
 *
 * 新建从侧栏 + 打开；编辑从连接节点右键打开。
 */
import { X } from 'lucide-react'
import type { ConnectionListItem } from '../api'
import { useConnectionStore } from '../store/connections'
import { ConnectionForm } from '../components/ConnectionForm'

interface ConnectionManagerProps {
  initial?: ConnectionListItem | null
  onClose: () => void
}

export function ConnectionManager({ initial, onClose }: ConnectionManagerProps) {
  const { loadConnections } = useConnectionStore()

  const handleSaved = async () => {
    await loadConnections()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="connection-manager-modal" onClick={(e) => e.stopPropagation()}>
        <div className="page-connection-manager">
          <div className="page-header">
            <h1>{initial ? '编辑连接' : '新建连接'}</h1>
            <button className="btn-icon" onClick={onClose} title="关闭">
              <X size={18} />
            </button>
          </div>
          <ConnectionForm initial={initial} onSave={handleSaved} onCancel={onClose} />
        </div>
      </div>
    </div>
  )
}
