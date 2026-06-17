/**
 * 主进程 i18n
 *
 * 启动时从本地设置读取 language，初始化 i18next 实例。
 * 主进程各处通过 tMain() 翻译字符串（如原生菜单 label、保存对话框标题、
 * 以及需要直接产出译文而非 key 的场景）。
 *
 * 跨 IPC 边界的「原因/错误」字段优先产出 i18n key（见 @shared/i18n/keys），
 * 由渲染层 t() 翻译；仅在主进程内部直接展示的场景（原生菜单、对话框）用 tMain()。
 *
 * 注意：采用「重启生效」策略——语言切换后不热更新主进程实例，
 * 需重启应用。settings:update 中若 language 变化，前端提示重启。
 */
import i18next from 'i18next'
import { resources, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@shared/i18n'
import type { Language } from '@shared/types/settings'

let initialized = false

/**
 * 初始化主进程 i18n 实例。
 * @param locale 从本地设置读到的 language；非法时回退默认语言。
 *
 * 在 initDb() 之后调用（依赖 settings 表）。重复调用安全（幂等，忽略后续 locale）。
 */
export async function initMainI18n(locale?: string): Promise<void> {
  if (initialized) return
  const lng = SUPPORTED_LOCALES.includes(locale as Language) ? (locale as Language) : DEFAULT_LOCALE
  await i18next.init({
    resources,
    lng,
    interpolation: { escapeValue: false },
  })
  initialized = true
}

/** 当前主进程 locale（未初始化时返回默认语言） */
export function getMainLocale(): Language {
  return (i18next.language as Language) || DEFAULT_LOCALE
}

/**
 * 主进程翻译函数。
 * 与渲染层 t() 同语义：支持插值 {{name}}、复数后缀 _one/_other。
 */
export function tMain(key: string, opts?: Record<string, unknown>): string {
  // 未初始化（如单测直接 import）时回退为返回 key 本身，避免抛错
  if (!initialized) return key
  return i18next.t(key, opts)
}
