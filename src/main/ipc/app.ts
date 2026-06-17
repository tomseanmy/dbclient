/** app:* IPC handler —— 应用级信息查询 */
import { app } from 'electron'
import { registerHandler } from './registry'

export function registerAppHandlers(): void {
  // 健康检查 / 连通性测试
  registerHandler('app:ping', () => ({
    pong: 'pong',
    ts: Date.now(),
    version: app.getVersion(),
  }))

  // 应用环境信息（供「关于」面板、调试使用）
  registerHandler('app:getInfo', () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    nodeVersion: process.versions.node ?? 'unknown',
    platform: process.platform,
    userDataPath: app.getPath('userData'),
  }))

  // 重启应用：relaunch 后立即退出当前实例（切换语言后让用户主动触发）
  registerHandler('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
    return { ok: true as const }
  })
}
