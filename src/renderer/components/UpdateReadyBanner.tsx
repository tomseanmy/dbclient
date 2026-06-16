/**
 * 更新就绪提示弹窗
 *
 * 当更新下载完成（status === 'downloaded'）时弹出，提示用户重启更新。
 * - 「立即重启」：调 installUpdate，退出并启动安装（重启即新版本）
 * - 「稍后」：关闭弹窗，autoInstallOnAppQuit=true 会确保下次退出时自动安装
 *
 * 在 App.tsx 挂载，确保任何界面下都能收到「更新就绪」通知。
 * 用 dismissed 本地状态避免用户点「稍后」后反复弹出。
 */
import { useState } from 'react'
import { RotateCw, Download } from 'lucide-react'
import { useUpdateStore } from '../store/update'

export function UpdateReadyBanner() {
  const status = useUpdateStore((s) => s.status)
  const info = useUpdateStore((s) => s.info)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const [dismissed, setDismissed] = useState(false)

  // 非 downloaded 状态重置 dismissed，便于下次更新再次提示
  if (status !== 'downloaded') {
    if (dismissed) setDismissed(false)
    return null
  }
  if (dismissed) return null

  const version = info?.version ? `v${info.version}` : '新版本'

  return (
    <div className="modal-overlay update-ready-overlay" onClick={() => setDismissed(true)}>
      <div
        className="modal update-ready-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        <div className="confirm-header">
          <Download size={20} color="var(--accent, #0a84ff)" />
          <h3>更新已就绪</h3>
        </div>
        <p className="confirm-reason">
          新版本 {version} 已下载完成，重启应用后即可生效。是否立即重启？
        </p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => setDismissed(true)}>
            稍后（下次退出时更新）
          </button>
          <button className="btn btn-primary" onClick={installUpdate}>
            <RotateCw size={12} />
            立即重启
          </button>
        </div>
      </div>
    </div>
  )
}
