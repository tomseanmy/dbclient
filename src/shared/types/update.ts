/**
 * 应用自动更新相关共享类型
 *
 * 状态机流转：
 *   idle → checking → up-to-date          (无更新，检查结束)
 *   idle → checking → available → downloading → downloaded  (有更新，已下载)
 *   任意 → error                            (出错)
 *
 * - idle: 空闲，尚未检查 / 已重置
 * - checking: 正在向 GitHub Release 查询最新版本
 * - up-to-date: 已是最新版本
 * - available: 发现新版本（autoDownload=true 时会自动进入 downloading）
 * - downloading: 正在后台下载
 * - downloaded: 下载完成，等待「重启以更新」
 * - error: 检查/下载过程中出错
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** 新版本信息（electron-updater UpdateInfo 的可序列化子集） */
export interface UpdateInfo {
  /** 新版本号，如 0.0.5 */
  version: string
  /** Release 名称（通常为 tag，如 v0.0.5） */
  releaseName?: string | null
  /** 发行说明（GitHub Release body 或 commit 摘要） */
  releaseNotes?: string | null
  /** 发布日期（ISO 字符串） */
  releaseDate?: string
}
