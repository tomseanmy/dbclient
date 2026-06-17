/**
 * 语言切换重启确认弹窗
 *
 * 切换语言后立即弹出（i18n 本身仍按「重启生效」策略，不热切换）：
 * - 「立即重启」：调 app:relaunch，relaunch + exit 重启到新语言
 * - 「稍后」：关闭弹窗，下次手动重启时生效
 *
 * 选定语言对应的展示名由调用方传入（langLabel），避免本组件感知 locale 映射。
 */
import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react'
import { api } from '../../api'

interface LanguageRestartDialogProps {
  /** 切换后的语言展示名（如「English」/「简体中文」），用于文案 */
  langLabel: string
  onClose: () => void
}

export function LanguageRestartDialog({ langLabel, onClose }: LanguageRestartDialogProps) {
  const { t } = useTranslation()

  const handleRestart = () => {
    void api['app:relaunch']().catch(() => {
      // relaunch 失败时静默关闭（主进程已 exit，通常不会走到这）
      onClose()
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="confirm-header">
          <RotateCw size={20} color="var(--accent, #0a84ff)" />
          <h3>{t('settings.restartTitle')}</h3>
        </div>
        <p className="confirm-reason">{t('settings.restartDesc', { lang: langLabel })}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('settings.restartLater')}
          </button>
          <button className="btn btn-primary" onClick={handleRestart}>
            <RotateCw size={12} />
            {t('settings.restartNow')}
          </button>
        </div>
      </div>
    </div>
  )
}
