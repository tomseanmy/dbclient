/**
 * 设置页（左右结构 modal）
 *
 * 左侧菜单：常规 / 模型设置 / 关于
 * 右侧内容区：按选中项切换对应面板组件。
 *
 * 原来的 LLM Provider 管理 + Token 用量已迁出至
 * components/settings/ModelSettings.tsx。
 */
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { X, Settings2, Bot, Info } from 'lucide-react'
import { GeneralSettings } from '../components/settings/GeneralSettings'
import { ModelSettings } from '../components/settings/ModelSettings'
import { AboutPanel } from '../components/settings/AboutPanel'

interface SettingsProps {
  onClose: () => void
  /** 初始打开的 tab（如 Agent 模式「配置模型」入口直达模型设置） */
  initialTab?: SettingsTab
}

type SettingsTab = 'general' | 'model' | 'about'

export function Settings({ onClose, initialTab }: SettingsProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general')

  const NAV_ITEMS: { key: SettingsTab; label: string; icon: typeof Settings2 }[] = [
    { key: 'general', label: t('settings.navGeneral'), icon: Settings2 },
    { key: 'model', label: t('settings.navModel'), icon: Bot },
    { key: 'about', label: t('settings.navAbout'), icon: Info },
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-layout">
          {/* 左侧菜单 */}
          <aside className="settings-nav">
            <div className="settings-nav-header">
              <span className="settings-nav-title">{t('settings.navTitle')}</span>
              <button className="btn-icon" onClick={onClose} title={t('common.close')}>
                <X size={16} />
              </button>
            </div>
            <nav className="settings-nav-list">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.key}
                    className={`settings-nav-item ${tab === item.key ? 'active' : ''}`}
                    onClick={() => setTab(item.key)}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>
          </aside>

          {/* 右侧内容 */}
          <section className="settings-content">
            {tab === 'general' && <GeneralSettings />}
            {tab === 'model' && <ModelSettings />}
            {tab === 'about' && <AboutPanel />}
          </section>
        </div>
      </div>
    </div>
  )
}
