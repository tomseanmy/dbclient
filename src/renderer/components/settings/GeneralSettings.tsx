/**
 * 常规设置（设置 modal 中的「常规」面板）
 *
 * 分组：
 * - 外观：界面主题（深/浅/跟随系统）。本次仅持久化偏好，浅色视觉待后续补齐。
 * - 存储：只读展示本地数据目录（app.db 等）+ 「在 Finder 中打开」。
 * - 语言：界面语言（本次仅简体中文可用，English 规划中）。
 * - 通知：桌面通知总开关 + 三个场景开关（仅窗口后台时弹出）。
 */
import { useState, useEffect } from 'react'
import { FolderOpen } from 'lucide-react'
import { api } from '../../api'
import { useSettingsStore } from '../../store/settings'
import type { Language, ThemeMode } from '@shared/types/settings'

export function GeneralSettings() {
  const { settings, update } = useSettingsStore()
  const [userDataPath, setUserDataPath] = useState<string>('')

  useEffect(() => {
    api['app:getInfo']()
      .then((info) => setUserDataPath(info.userDataPath))
      .catch(() => {})
  }, [])

  const notif = settings.notifications

  return (
    <>
      {/* 外观 */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>外观</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">主题</span>
            <span className="settings-row-desc">界面配色，可跟随系统切换深浅模式</span>
          </div>
          <select
            className="settings-select"
            value={settings.theme}
            onChange={(e) => void update({ theme: e.target.value as ThemeMode })}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>
      </div>

      {/* 存储 */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>存储</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">本地数据目录</span>
            <span className="settings-row-desc">
              本地数据库（app.db）、查询历史、日志均存放于此
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => api['app:openUserDataFolder']().catch(() => {})}
            title="在系统文件管理器中打开"
          >
            <FolderOpen size={12} /> 打开
          </button>
        </div>
        <div className="settings-row-path">{userDataPath || '加载中…'}</div>
      </div>

      {/* 语言 */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>语言</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">界面语言</span>
            <span className="settings-row-desc">应用界面的显示语言</span>
          </div>
          <select
            className="settings-select"
            value={settings.language}
            onChange={(e) => void update({ language: e.target.value as Language })}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en" disabled>
              English（敬请期待）
            </option>
          </select>
        </div>
      </div>

      {/* 通知 */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>通知</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">启用桌面通知</span>
            <span className="settings-row-desc">仅在窗口处于后台时显示通知，避免打扰</span>
          </div>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={notif.enabled}
            onChange={(e) =>
              void update({ notifications: { ...notif, enabled: e.target.checked } })
            }
          />
        </div>
        <div className={`settings-row settings-sub-row ${notif.enabled ? '' : 'disabled'}`}>
          <div className="settings-row-label">
            <span className="settings-row-name">查询执行完成</span>
          </div>
          <input
            type="checkbox"
            className="settings-toggle"
            disabled={!notif.enabled}
            checked={notif.enabled && notif.queryComplete}
            onChange={(e) =>
              void update({ notifications: { ...notif, queryComplete: e.target.checked } })
            }
          />
        </div>
        <div className={`settings-row settings-sub-row ${notif.enabled ? '' : 'disabled'}`}>
          <div className="settings-row-label">
            <span className="settings-row-name">AGENT 任务完成</span>
          </div>
          <input
            type="checkbox"
            className="settings-toggle"
            disabled={!notif.enabled}
            checked={notif.enabled && notif.agentComplete}
            onChange={(e) =>
              void update({ notifications: { ...notif, agentComplete: e.target.checked } })
            }
          />
        </div>
        <div className={`settings-row settings-sub-row ${notif.enabled ? '' : 'disabled'}`}>
          <div className="settings-row-label">
            <span className="settings-row-name">后台任务完成</span>
            <span className="settings-row-desc">连通性测试等异步操作结束</span>
          </div>
          <input
            type="checkbox"
            className="settings-toggle"
            disabled={!notif.enabled}
            checked={notif.enabled && notif.backgroundTask}
            onChange={(e) =>
              void update({ notifications: { ...notif, backgroundTask: e.target.checked } })
            }
          />
        </div>
      </div>
    </>
  )
}
