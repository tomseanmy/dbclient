// Monaco 本地加载配置必须在最前面 import（CSP 不允许 CDN）
import './config/monaco'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
