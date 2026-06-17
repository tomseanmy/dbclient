/**
 * 自绘窗口控制按钮（仅 win/linux 渲染）
 *
 * macOS 由系统原生红绿灯接管（见 main 进程 titleBarStyle:'hiddenInset'），
 * 本组件在 mac 上直接 return null。
 *
 * win/linux 下放在左上角（mac 红绿灯同位置），采用独立 button 样式，
 * 不占用右侧 tab 栏空间，避免与内容重叠；通过 window:* IPC 控制窗口；
 * 最大化图标随窗口状态切换（监听 resize，最大化必触发）。
 */
import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'

export function WindowControls() {
  // 首屏同步判断平台，mac 不渲染任何东西
  if (window.platform === 'darwin') return null
  return <WindowControlsInner />
}

function WindowControlsInner() {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)

  // 初次 + 窗口尺寸变化时刷新最大化状态（最大化/还原都会触发 resize）
  useEffect(() => {
    let active = true
    const refresh = () => {
      api['window:isMaximized']().then((v) => {
        if (active) setMaximized(v)
      })
    }
    refresh()
    window.addEventListener('resize', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.removeEventListener('resize', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className="window-controls">
      <button
        className="wc-btn"
        title={t('windowControls.minimize')}
        onClick={() => api['window:minimize']()}
      >
        <Minus size={15} />
      </button>
      <button
        className="wc-btn"
        title={maximized ? t('windowControls.restore') : t('windowControls.maximize')}
        onClick={() => api['window:maximizeToggle']()}
      >
        {maximized ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button
        className="wc-btn wc-close"
        title={t('windowControls.close')}
        onClick={() => api['window:close']()}
      >
        <X size={16} />
      </button>
    </div>
  )
}
