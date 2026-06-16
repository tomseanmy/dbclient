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

/** 默认模型：指向某个 Provider 的具体模型（非 Provider 列表里的第一个） */
export interface ModelDefault {
  providerId: string
  model: string
}

/** 默认模型用途分类 */
export type DefaultModelKind = 'agent' | 'chat'

export interface AppSettings {
  theme: ThemeMode
  language: Language
  notifications: NotificationSettings
  /** 默认 Agent 模型（AGENT 模式用，需要工具调用能力） */
  defaultAgentModel?: ModelDefault
  /** 默认补全模型（AiChat 普通对话/辅助用） */
  defaultChatModel?: ModelDefault
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
  // defaultAgentModel / defaultChatModel 默认 undefined：未配置时回退到第一个 Provider 的第一个模型
}
