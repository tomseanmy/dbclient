/**
 * i18n 翻译资源（主进程与渲染进程共用同一份字典）
 *
 * 主进程通过 @main/i18n 的 tMain() 查表（产出 key 或翻译文本）；
 * 渲染层通过 react-i18next 的 useTranslation() / t() 查表。
 *
 * 字典以 JSON 维护：zh-CN.json / en.json。新增语言时在此登记。
 */
import zhCN from './zh-CN.json'
import en from './en.json'
import type { Language } from '../types/settings'

/** 主进程与渲染进程共用的 resources（i18next 格式） */
export const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
} as const

/** 默认语言（与 DEFAULT_SETTINGS 一致） */
export const DEFAULT_LOCALE: Language = 'zh-CN'

/** 受支持的语言列表 */
export const SUPPORTED_LOCALES: readonly Language[] = ['zh-CN', 'en']
