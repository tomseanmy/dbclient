/**
 * 应用设置 store（Zustand）
 *
 * 加载/更新应用设置，并把主题偏好同时应用到：
 * - <html data-theme>（解析后的实际值，驱动 CSS 变量切换深/浅色调色板）；
 * - 主进程 nativeTheme.themeSource（通过 theme:apply IPC，使 Win/Linux
 *   原生标题栏、系统 select 弹层等 OS 绘制的控件配色与应用一致）。
 *
 * system 模式下订阅 prefers-color-scheme，系统切换深浅时实时跟随，
 * 无需重启应用。
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

/**
 * 把主题偏好同时应用到渲染层与原生层。
 * - <html data-theme> 写解析后的值（light/dark），驱动 CSS 调色板；
 * - theme:apply 写原生 ThemeMode（system/light/dark），让 nativeTheme
 *   在 system 模式下自行跟随系统，无需渲染层代理解析。
 */
function applyTheme(mode: ThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolveTheme(mode))
  }
  // 失败不应阻塞主题切换（渲染层仍已生效）
  api['theme:apply'](mode).catch(() => {})
}

/**
 * system 模式下监听系统深浅变化：仅更新 <html data-theme>，
 * 主进程 nativeTheme.themeSource 已是 'system' 会自行跟随，无需再通知。
 * 模块级单例，只注册一次。
 */
let systemThemeListenerBound = false
function ensureSystemThemeListener(): void {
  if (systemThemeListenerBound || typeof window === 'undefined' || !window.matchMedia) return
  const mql = window.matchMedia('(prefers-color-scheme: light)')
  const onChange = () => {
    const { settings } = useSettingsStore.getState()
    // 仅 system 偏好才需要跟随；显式 light/dark 不受系统影响
    if (settings.theme === 'system') {
      document.documentElement.setAttribute('data-theme', resolveTheme('system'))
    }
  }
  // addEventListener 在较新 Chromium 可用；老版本回退 addListener
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange)
  } else {
    // 旧 API（Safari < 14）；Electron 现代 Chromium 走不到此分支
    mql.addListener(onChange)
  }
  systemThemeListenerBound = true
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const settings = await api['settings:getAll']()
      set({ settings, loaded: true })
      applyTheme(settings.theme)
      ensureSystemThemeListener()
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
