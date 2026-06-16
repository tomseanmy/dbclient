/**
 * 应用设置 DAO（扁平 KV）
 *
 * 表 app_settings 由 004_app_settings.sql 创建。
 * handler 层把 AppSettings 拆成若干 key（theme / language / notif.*）写入，
 * 读取时再合并回 AppSettings，缺失项用 DEFAULT_SETTINGS 兜底。
 */
import { getDb } from './db'

interface SettingsRow {
  key: string
  value: string
}

/** 读取全部设置（原始 KV，不做语义映射）。 */
export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM app_settings`).all() as SettingsRow[]
  const out: Record<string, string> = {}
  for (const { key, value } of rows) {
    out[key] = value
  }
  return out
}

/** 写入单个 key（存在则更新）。 */
export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
}
