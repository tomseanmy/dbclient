/**
 * 关于（设置 modal 中的「关于」面板）
 *
 * 展示应用信息：名称、版本、作者、开源地址、运行环境。
 * 版本/平台/环境取自主进程 app:getInfo。
 * 「检查更新」基于 electron-updater：状态驱动 UI
 *   idle → 检查更新
 *   checking → 检查中…（spinner）
 *   up-to-date → 已是最新版本
 *   available / downloading → 自动后台下载，显示进度条
 *   downloaded → 「重启以更新」按钮（点击调 installUpdate）
 *   error → 检查更新失败 + 重试
 */
import { useState, useEffect } from 'react'
import {
  ExternalLink,
  RefreshCw,
  Download,
  RotateCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { api } from '../../api'
import { useUpdateStore } from '../../store/update'
import logoUrl from '../../assets/logo.webp'

const REPO_URL = 'https://github.com/tomseanmy/dbclient'

export function AboutPanel() {
  const [info, setInfo] = useState<{
    appVersion: string
    electronVersion: string
    nodeVersion: string
    platform: string
  } | null>(null)

  // 更新状态机（来自 store，事件驱动）
  const status = useUpdateStore((s) => s.status)
  const progress = useUpdateStore((s) => s.progress)
  const updateInfo = useUpdateStore((s) => s.info)
  const errorMessage = useUpdateStore((s) => s.errorMessage)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const installUpdate = useUpdateStore((s) => s.installUpdate)

  useEffect(() => {
    api['app:getInfo']()
      .then((i) =>
        setInfo({
          appVersion: i.appVersion,
          electronVersion: i.electronVersion,
          nodeVersion: i.nodeVersion,
          platform: i.platform,
        }),
      )
      .catch(() => {})
  }, [])

  const platformLabel = info
    ? info.platform === 'darwin'
      ? 'macOS'
      : info.platform === 'win32'
        ? 'Windows'
        : info.platform === 'linux'
          ? 'Linux'
          : info.platform
    : ''

  const busy = status === 'checking' || status === 'downloading'
  const newVersionLabel = updateInfo?.version ? `v${updateInfo.version}` : '新版本'

  return (
    <div className="about-panel">
      <div className="about-head">
        <div className="about-logo">
          <img src={logoUrl} alt="AI DB Client" />
        </div>
        <div className="about-title">
          <h2>DB Client</h2>
          <span className="about-tagline">开源 · AI 原生数据库客户端</span>
        </div>
      </div>

      <dl className="about-list">
        <div className="about-list-row">
          <dt>版本</dt>
          <dd>v{info?.appVersion ?? '—'}</dd>
        </div>
        <div className="about-list-row">
          <dt>作者</dt>
          <dd>tomsean</dd>
        </div>
        <div className="about-list-row">
          <dt>开源协议</dt>
          <dd>MIT License</dd>
        </div>
        <div className="about-list-row">
          <dt>开源地址</dt>
          <dd>
            <button
              className="about-link"
              onClick={() => api['app:openExternal']({ url: REPO_URL }).catch(() => {})}
              title="在浏览器中打开"
            >
              github.com/tomseanmy/dbclient <ExternalLink size={11} />
            </button>
          </dd>
        </div>
        <div className="about-list-row">
          <dt>运行环境</dt>
          <dd>
            {info
              ? `Electron ${info.electronVersion} · Node ${info.nodeVersion} · ${platformLabel}`
              : '加载中…'}
          </dd>
        </div>
      </dl>

      <div className="about-update">
        {/* 状态驱动的主按钮 */}
        {status === 'downloaded' ? (
          <button className="btn btn-primary btn-sm" onClick={installUpdate}>
            <RotateCw size={12} />
            重启以更新
          </button>
        ) : status === 'downloading' ? (
          <button className="btn btn-secondary btn-sm" disabled>
            <Download size={12} className="spin" />
            下载中… {progress}%
          </button>
        ) : status === 'available' ? (
          <button className="btn btn-secondary btn-sm" disabled>
            <Download size={12} className="spin" />
            正在下载 {newVersionLabel}
          </button>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={checkForUpdates} disabled={busy}>
            <RefreshCw size={12} className={busy ? 'spin' : ''} />
            {status === 'checking' ? '检查中…' : '检查更新'}
          </button>
        )}

        {/* 状态文字提示 */}
        {status === 'checking' && <span className="about-update-hint">正在查询最新版本…</span>}
        {status === 'available' && (
          <span className="about-update-hint">发现新版本 {newVersionLabel}，正在后台下载</span>
        )}
        {status === 'downloading' && (
          <span className="about-update-hint">正在下载新版本 {newVersionLabel}</span>
        )}
        {status === 'downloaded' && (
          <span className="about-update-success">
            <CheckCircle2 size={12} /> 新版本 {newVersionLabel} 已就绪，重启后生效
          </span>
        )}
        {status === 'up-to-date' && (
          <span className="about-update-success">
            <CheckCircle2 size={12} /> 已是最新版本
          </span>
        )}
        {status === 'error' && (
          <span className="about-update-error" title={errorMessage}>
            <AlertCircle size={12} /> 检查更新失败，请稍后重试
          </span>
        )}
      </div>

      {/* 下载进度条 */}
      {(status === 'downloading' || status === 'available') && (
        <div className="about-update-progress">
          <div className="about-update-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  )
}
