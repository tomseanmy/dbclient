/**
 * update:* IPC handler —— 应用更新控制
 *
 * - update:checkForUpdates：手动 / 自动触发检查更新
 * - update:installUpdate：下载完成后触发「重启并安装」
 * - update:getStatus：查询当前更新状态（渲染层初始化同步）
 *
 * 状态变化与下载进度通过 update:stateChanged / update:downloadProgress
 * 事件主动推送（见 domain/updater.ts），本 handler 仅处理请求/响应式调用。
 */
import { registerHandler } from './registry'
import { checkForUpdates, quitAndInstall, getStatus } from '@main/domain/updater'

export function registerUpdateHandlers(): void {
  // 检查更新（silent=false 时无更新会提示「已是最新」）
  registerHandler('update:checkForUpdates', async (_event, req) => {
    const result = await checkForUpdates(req?.silent ?? false)
    return result
  })

  // 重启并安装（仅 downloaded 状态下有意义）
  registerHandler('update:installUpdate', () => {
    quitAndInstall()
  })

  // 查询当前状态（渲染层挂载时同步，避免错过启动期推送的事件）
  registerHandler('update:getStatus', () => getStatus())
}
