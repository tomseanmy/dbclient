/**
 * 常规设置（设置 modal 中的「常规」面板）
 *
 * 分组：
 * - 外观：界面主题（深/浅/跟随系统），已支持完整深浅色调色板 + 原生控件同步。
 * - 存储：只读展示本地数据目录（app.db 等）+ 「在 Finder 中打开」。
 * - 语言：界面语言（本次仅简体中文可用，English 规划中）。
 * - 通知：桌面通知总开关 + 三个场景开关（仅窗口后台时弹出）。
 */
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { FolderOpen } from 'lucide-react'
import { api } from '../../api'
import { useSettingsStore } from '../../store/settings'
import type { Language, ThemeMode } from '@shared/types/settings'
import { LanguageRestartDialog } from './LanguageRestartDialog'

/** 语言值 → 展示名（用于重启弹窗文案） */
const LANG_LABEL: Record<Language, string> = {
  'zh-CN': '简体中文',
  en: 'English',
}

export function GeneralSettings() {
  const { t } = useTranslation()
  const { settings, update } = useSettingsStore()
  const [userDataPath, setUserDataPath] = useState<string>('')
  /** 切换语言后待确认的目标语言（null 表示不弹窗） */
  const [pendingLang, setPendingLang] = useState<Language | null>(null)

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
          <h2>{t('settings.appearance')}</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">{t('settings.theme')}</span>
            <span className="settings-row-desc">{t('settings.themeDesc')}</span>
          </div>
          <select
            className="settings-select"
            value={settings.theme}
            onChange={(e) => void update({ theme: e.target.value as ThemeMode })}
          >
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </select>
        </div>
      </div>

      {/* 存储 */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>{t('settings.storage')}</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">{t('settings.localDataDir')}</span>
            <span className="settings-row-desc">{t('settings.localDataDirDesc')}</span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => api['app:openUserDataFolder']().catch(() => {})}
            title={t('settings.openInFinder')}
          >
            <FolderOpen size={12} /> {t('settings.open')}
          </button>
        </div>
        <div className="settings-row-path">{userDataPath || t('common.loading')}</div>
      </div>

      {/* 语言 */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>{t('settings.language')}</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">{t('settings.interfaceLanguage')}</span>
            <span className="settings-row-desc">{t('settings.interfaceLanguageDesc')}</span>
          </div>
          <select
            className="settings-select"
            value={settings.language}
            onChange={(e) => {
              const lang = e.target.value as Language
              if (lang === settings.language) return
              void update({ language: lang }).then(() => setPendingLang(lang))
            }}
          >
            <option value="zh-CN">{t('settings.langZhCN')}</option>
            <option value="en">{t('settings.langEn')}</option>
          </select>
          <span className="settings-row-hint">{t('settings.languageRestartHint')}</span>
        </div>
      </div>

      {/* 通知 */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>{t('settings.notifications')}</h2>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">{t('settings.enableNotifications')}</span>
            <span className="settings-row-desc">{t('settings.notificationsDesc')}</span>
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
            <span className="settings-row-name">{t('settings.notifQueryComplete')}</span>
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
            <span className="settings-row-name">{t('settings.notifAgentComplete')}</span>
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
            <span className="settings-row-name">{t('settings.notifBackgroundTask')}</span>
            <span className="settings-row-desc">{t('settings.notifBackgroundTaskDesc')}</span>
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
      {pendingLang && (
        <LanguageRestartDialog
          langLabel={LANG_LABEL[pendingLang]}
          onClose={() => setPendingLang(null)}
        />
      )}
    </>
  )
}
