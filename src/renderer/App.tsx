import { useEffect, useState } from 'react'
import { api } from './api'

interface PingResult {
  pong: string
  ts: number
  version: string
}

interface AppInfo {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  platform: string
  userDataPath: string
}

export default function App() {
  const [ping, setPing] = useState<PingResult | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api['app:ping']()
      .then(setPing)
      .catch((e) => setError(String(e)))
    api['app:getInfo']()
      .then(setInfo)
      .catch((e) => setError(String(e)))
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI DB Client</h1>
        <p className="subtitle">开源的 AI 原生数据库工具 · M0 骨架</p>
      </header>

      <main className="app-main">
        <section className="card">
          <h2>IPC 连通性测试</h2>
          {error ? (
            <p className="error">❌ {error}</p>
          ) : !ping ? (
            <p className="muted">正在 ping 主进程…</p>
          ) : (
            <p className="success">
              ✅ {ping.pong} · v{ping.version} · {new Date(ping.ts).toLocaleTimeString()}
            </p>
          )}
        </section>

        <section className="card">
          <h2>运行环境</h2>
          {!info ? (
            <p className="muted">加载中…</p>
          ) : (
            <dl className="info-grid">
              <dt>App 版本</dt>
              <dd>{info.appVersion}</dd>
              <dt>Electron</dt>
              <dd>{info.electronVersion}</dd>
              <dt>Node</dt>
              <dd>{info.nodeVersion}</dd>
              <dt>平台</dt>
              <dd>{info.platform}</dd>
              <dt>用户数据目录</dt>
              <dd className="mono">{info.userDataPath}</dd>
            </dl>
          )}
        </section>

        <section className="card placeholder">
          <p className="muted">
            🚧 后续模块（M1 连接管理 / M2 SQL 编辑器 / M4 AI 对话 / M5 MCP Server）开发中
          </p>
        </section>
      </main>
    </div>
  )
}
