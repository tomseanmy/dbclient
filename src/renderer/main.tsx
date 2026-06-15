// Monaco 本地加载配置必须在最前面 import（CSP 不允许 CDN）
import './config/monaco'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// 首屏前写入平台标识，供 CSS 用 [data-platform="win32"] 等做平台分支，避免闪烁
document.documentElement.dataset.platform = window.platform

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
