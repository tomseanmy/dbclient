/**
 * 应用设置 store（Zustand）
 *
 * 加载/更新应用设置，并把主题偏好应用到 <html data-theme>。
 *
 * 说明：本次仅实现「主题偏好持久化」——
 * - 偏好（深/浅/跟随系统）写入 app_settings；
 * - <html data-theme> 会被设为解析后的值（system 时读 prefers-color-scheme）；
 * - 但暂未定义浅色调色板，故 data-theme=light 时视觉仍为深色。
 *   待后续补齐浅色 CSS 变量后即可即时生效，无需改动此 store。
 */
import { create } from 'zustand'
import { api } from '../api'
import { DEFAULT_SETTINGS, type AppSettings, type ThemeMode } from '@shared/types/settings'

interface SettingsStore {
  /** 当前设置（加载前为 null，UI 用 DEFAULT 兜底） */
  settings: AppSettings
  /** 是否已从主进程加载过一次 */
  loaded: boolean
  /** 首次加载（App 启动时调用一次） */
  load: () => Promise<void>
  /** 增量更新（深合并 notifications），写库 + 应用主题 */
  update: (patch: Partial<AppSettings>) => Promise<void>
}

/** 解析主题偏好为实际的 data-theme 值。system 时跟随操作系统。 */
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  // system：读 prefers-color-scheme（不支持时默认深色）
  const prefersLight =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  return prefersLight ? 'light' : 'dark'
}

/** 把解析后的主题写到 <html data-theme>。 */
function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', resolveTheme(mode))
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const settings = await api['settings:getAll']()
      set({ settings, loaded: true })
      applyTheme(settings.theme)
    } catch {
      // 设置加载失败不应阻塞应用启动
      set({ loaded: true })
    }
  },

  update: async (patch) => {
    const settings = await api['settings:update'](patch)
    set({ settings })
    if (patch.theme) applyTheme(settings.theme)
  },
}))
