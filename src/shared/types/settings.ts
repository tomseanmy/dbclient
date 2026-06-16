/**
 * 应用级设置类型（主进程与渲染进程共享）
 *
 * 持久化在本地库 app_settings 表（KV），handler 层负责 AppSettings ↔ 扁平 KV 的映射。
 */
export type ThemeMode = 'system' | 'light' | 'dark'

export type Language = 'zh-CN' | 'en'

export interface NotificationSettings {
  /** 总开关 */
  enabled: boolean
  /** 查询执行完成 */
  queryComplete: boolean
  /** AGENT 任务完成 */
  agentComplete: boolean
  /** 后台任务（连通性测试等）完成 */
  backgroundTask: boolean
}

export interface AppSettings {
  theme: ThemeMode
  language: Language
  notifications: NotificationSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'zh-CN',
  notifications: {
    enabled: true,
    queryComplete: true,
    agentComplete: true,
    backgroundTask: true,
  },
}
