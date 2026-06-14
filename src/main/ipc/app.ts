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
}
