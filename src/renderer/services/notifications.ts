/**
 * 桌面通知服务（渲染层统一收口）
 *
 * 行为约定：
 * - 仅当对应 scope 在设置中开启时才发送；
 * - 仅当窗口处于后台（document.hidden）时发送，前台时不打扰；
 * - 通知显示委托主进程（渲染进程无 Notification 权限）。
 *
 * 调用方只需在「任务完成」时机调用 notify(scope, title, body?)，
 * 是否真正弹出由本服务按用户偏好 + 窗口状态决定。
 */
import { api } from '../api'
import { useSettingsStore } from '../store/settings'

export type NotifyScope = 'queryComplete' | 'agentComplete' | 'backgroundTask'

/**
 * 按需发送桌面通知。
 * @param scope  通知场景，对应设置中的开关
 * @param title  标题
 * @param body   可选正文
 */
export async function notify(scope: NotifyScope, title: string, body?: string): Promise<void> {
  const { settings } = useSettingsStore.getState()

  // 总开关或对应场景关闭 → 不发
  if (!settings.notifications.enabled) return
  if (!settings.notifications[scope]) return

  // 前台时不打扰（仅窗口失焦时弹通知）
  if (!document.hidden) return

  try {
    await api['app:notify']({ title, body })
  } catch {
    // 通知失败静默忽略，不影响主流程
  }
}
