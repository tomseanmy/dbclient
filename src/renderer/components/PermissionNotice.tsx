/**
 * 权限拒绝提示 + 临时提权入口
 *
 * 当 prod 连接的写操作被拒绝时，提示原因并提供提权按钮。
 */
import { useState, useEffect } from 'react'
import { ShieldOff, Unlock, Lock } from 'lucide-react'
import { api, type SecurityCheckResult } from '../api'

interface PermissionNoticeProps {
  check: SecurityCheckResult
  connectionId: string
  onElevated: () => void
  onDismiss: () => void
}

export function PermissionNotice({
  check,
  connectionId,
  onElevated,
  onDismiss,
}: PermissionNoticeProps) {
  const [elevating, setElevating] = useState(false)
  const [elevated, setElevated] = useState(false)
  const [remainingMin, setRemainingMin] = useState(0)

  // 检查当前提权状态
  useEffect(() => {
    api['connection:getElevation']({ connectionId }).then((status) => {
      setElevated(status.elevated)
      setRemainingMin(Math.ceil(status.remainingMs / 60000))
    })
  }, [connectionId])

  const handleElevate = async () => {
    setElevating(true)
    try {
      const result = await api['connection:elevate']({ connectionId })
      setElevated(true)
      setRemainingMin(Math.ceil(result.remainingMs / 60000))
      onElevated()
    } finally {
      setElevating(false)
    }
  }

  if (elevated) {
    return (
      <div className="perm-notice perm-elevated">
        <Unlock size={14} />
        <span>已临时提权（剩余 {remainingMin} 分钟）</span>
        <button
          className="btn-text"
          onClick={async () => {
            await api['connection:revokeElevation']({ connectionId })
            setElevated(false)
          }}
        >
          <Lock size={12} /> 撤销提权
        </button>
      </div>
    )
  }

  return (
    <div className="perm-notice perm-denied">
      <ShieldOff size={14} />
      <div className="perm-content">
        <strong>操作被拒绝</strong>
        <span>{check.reason}</span>
      </div>
      {check.canElevate && (
        <button className="btn btn-warning btn-sm" onClick={handleElevate} disabled={elevating}>
          <Unlock size={12} /> {elevating ? '提权中…' : '临时提权'}
        </button>
      )}
      <button className="btn-text" onClick={onDismiss}>
        关闭
      </button>
    </div>
  )
}
