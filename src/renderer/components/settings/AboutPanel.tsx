/**
 * 关于（设置 modal 中的「关于」面板）
 *
 * 展示应用信息：名称、版本、作者、开源地址、运行环境。
 * 版本/平台/环境取自主进程 app:getInfo。
 * 「检查更新」本次不实现，点击后显示内联提示。
 */
import { useState, useEffect } from 'react'
import { Database, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../../api'

const REPO_URL = 'https://github.com/tomseanmy/dbclient'

export function AboutPanel() {
  const [info, setInfo] = useState<{
    appVersion: string
    electronVersion: string
    nodeVersion: string
    platform: string
  } | null>(null)
  const [checking, setChecking] = useState(false)

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

  const handleCheckUpdate = () => {
    setChecking(true)
    // 本次不实现真实检查，仅展示提示，2 秒后恢复
    setTimeout(() => setChecking(false), 2000)
  }

  const platformLabel = info
    ? info.platform === 'darwin'
      ? 'macOS'
      : info.platform === 'win32'
        ? 'Windows'
        : info.platform === 'linux'
          ? 'Linux'
          : info.platform
    : ''

  return (
    <div className="about-panel">
      <div className="about-head">
        <div className="about-logo">
          <Database size={36} />
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
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleCheckUpdate}
          disabled={checking}
        >
          <RefreshCw size={12} className={checking ? 'spin' : ''} />
          {checking ? '检查中…' : '检查更新'}
        </button>
        {checking && <span className="about-update-hint">检查更新功能即将推出</span>}
      </div>
    </div>
  )
}
