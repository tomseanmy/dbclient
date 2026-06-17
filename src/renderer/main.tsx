// Monaco 本地加载配置必须在最前面 import（CSP 不允许 CDN）
import './config/monaco'

import React from 'react'
import ReactDOM from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import App from './App'
import { useSettingsStore } from './store/settings'
import { resources, DEFAULT_LOCALE } from '@shared/i18n'
import './styles/global.css'

// 首屏前写入平台标识，供 CSS 用 [data-platform="win32"] 等做平台分支，避免闪烁
document.documentElement.dataset.platform = window.platform

// FOUC 防护：bootstrap() 要 await DB 读取 + i18n init，期间首帧若不带
// data-theme 会按 :root（暗色）渲染，系统浅色用户会看到一瞬深色闪烁。
// 这里先按系统偏好同步写入，bootstrap 完成后由 store.load() 用真实偏好覆盖。
;(function preapplyTheme() {
  const prefersLight =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  document.documentElement.setAttribute('data-theme', prefersLight ? 'light' : 'dark')
})()

/**
 * 渲染前初始化 i18n。
 *
 * 采用「重启生效」策略：i18n 在首屏渲染前 init 一次，读取已持久化的 settings.language。
 * 切换语言后需重启应用，不做运行时热切换。
 *
 * 必须在 createRoot().render 之前完成，确保首屏所有组件 t() 即为正确语言。
 * settings 加载失败时回退默认语言（zh-CN），不阻塞启动。
 */
async function bootstrap(): Promise<void> {
  try {
    await useSettingsStore.getState().load()
  } catch {
    // 设置加载失败不阻塞启动（store 内部已置 loaded=true 兜底）
  }
  const lng = useSettingsStore.getState().settings.language || DEFAULT_LOCALE
  await i18next.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
  })

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
