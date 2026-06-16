/**
 * app:* / settings:* IPC handler —— 应用级信息查询、桌面通知、应用设置
 *
 * - app:openUserDataFolder / app:openExternal：shell 打开目录/外链
 * - app:notify：显示原生桌面通知（渲染进程无 Notification 权限，委托主进程）
 * - settings:getAll / settings:update：读取/更新应用设置（KV ↔ AppSettings 映射）
 */
import { app, shell, Notification } from 'electron'
import { registerHandler } from './registry'
import { getAllSettings, setSetting } from '@main/infra/storage/settings-dao'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { AppSettings, ModelDefault, ThemeMode, Language } from '@shared/types/settings'
import { logger } from '@main/infra/logger'

/** 默认模型在 KV 里的 key */
const KV_DEFAULT_AGENT_MODEL = 'model.default.agent'
const KV_DEFAULT_CHAT_MODEL = 'model.default.chat'

/** 把 KV 里的默认模型字符串解析为 ModelDefault；非法或缺省返回 undefined */
function parseModelDefault(raw: string | undefined): ModelDefault | undefined {
  if (!raw) return undefined
  try {
    const obj = JSON.parse(raw) as unknown
    if (
      obj &&
      typeof obj === 'object' &&
      typeof (obj as ModelDefault).providerId === 'string' &&
      typeof (obj as ModelDefault).model === 'string'
    ) {
      return obj as ModelDefault
    }
  } catch {
    // 忽略损坏的旧值
  }
  return undefined
}

/** 把 ModelDefault 序列化为 KV 字符串（undefined → 不写） */
function stringifyModelDefault(d: ModelDefault | undefined): string | undefined {
  return d ? JSON.stringify(d) : undefined
}

/** 把 KV 映射为 AppSettings（缺失项用默认值兜底）。 */
function mapToSettings(kv: Record<string, string>): AppSettings {
  const parseBool = (v: string | undefined, fallback: boolean): boolean =>
    v === undefined ? fallback : v === 'true'

  // 枚举值用白名单校验：非法/缺失时回退默认值，避免逐个等值判断漏掉合法值
  const validThemes: ReadonlyArray<ThemeMode> = ['system', 'light', 'dark']
  const validLanguages: ReadonlyArray<Language> = ['zh-CN', 'en']

  return {
    theme: validThemes.includes(kv.theme as ThemeMode)
      ? (kv.theme as ThemeMode)
      : DEFAULT_SETTINGS.theme,
    language: validLanguages.includes(kv.language as Language)
      ? (kv.language as Language)
      : DEFAULT_SETTINGS.language,
    notifications: {
      enabled: parseBool(kv['notif.enabled'], DEFAULT_SETTINGS.notifications.enabled),
      queryComplete: parseBool(
        kv['notif.queryComplete'],
        DEFAULT_SETTINGS.notifications.queryComplete,
      ),
      agentComplete: parseBool(
        kv['notif.agentComplete'],
        DEFAULT_SETTINGS.notifications.agentComplete,
      ),
      backgroundTask: parseBool(
        kv['notif.backgroundTask'],
        DEFAULT_SETTINGS.notifications.backgroundTask,
      ),
    },
    defaultAgentModel: parseModelDefault(kv[KV_DEFAULT_AGENT_MODEL]),
    defaultChatModel: parseModelDefault(kv[KV_DEFAULT_CHAT_MODEL]),
  }
}

/** 把 AppSettings 拆成扁平 KV 写入。 */
function writeSettings(settings: AppSettings): void {
  setSetting('theme', settings.theme)
  setSetting('language', settings.language)
  const n = settings.notifications
  setSetting('notif.enabled', String(n.enabled))
  setSetting('notif.queryComplete', String(n.queryComplete))
  setSetting('notif.agentComplete', String(n.agentComplete))
  setSetting('notif.backgroundTask', String(n.backgroundTask))
  const agent = stringifyModelDefault(settings.defaultAgentModel)
  const chat = stringifyModelDefault(settings.defaultChatModel)
  // 清空默认模型时写入空串覆盖旧值（保留 key，表示「已显式清空」）
  setSetting(KV_DEFAULT_AGENT_MODEL, agent ?? '')
  setSetting(KV_DEFAULT_CHAT_MODEL, chat ?? '')
}

export function registerSettingsHandlers(): void {
  // 打开 userData 目录（本地库 app.db、日志等所在地）
  registerHandler('app:openUserDataFolder', async () => {
    await shell.openPath(app.getPath('userData'))
    return { ok: true as const }
  })

  // 用系统默认浏览器打开外链
  registerHandler('app:openExternal', async (_event, req) => {
    await shell.openExternal(req.url)
    return { ok: true as const }
  })

  // 显示原生桌面通知
  registerHandler('app:notify', (_event, req) => {
    if (!Notification.isSupported()) {
      logger.warn('当前系统不支持桌面通知')
      return { ok: true as const }
    }
    const noti = new Notification({ title: req.title, body: req.body ?? '', silent: false })
    noti.show()
    return { ok: true as const }
  })

  // 读取全部应用设置
  registerHandler('settings:getAll', () => mapToSettings(getAllSettings()))

  // 增量更新应用设置（深合并 notifications），返回完整设置
  registerHandler('settings:update', (_event, patch) => {
    const current = mapToSettings(getAllSettings())
    const merged: AppSettings = {
      theme: patch.theme ?? current.theme,
      language: patch.language ?? current.language,
      notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
      // 默认模型整体替换（patch 传 undefined 表示清空，不传表示不变）
      defaultAgentModel: patch.defaultAgentModel ?? current.defaultAgentModel,
      defaultChatModel: patch.defaultChatModel ?? current.defaultChatModel,
    }
    writeSettings(merged)
    return merged
  })
}
