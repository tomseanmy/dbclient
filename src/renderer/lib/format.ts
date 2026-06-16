/**
 * 通用格式化工具（渲染层多处复用，无 React 依赖）
 */

/**
 * 时间格式化：今天显示时分（HH:MM），否则显示月/日（M/D）。
 */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 单元格值格式化（截断展示，避免长内容撑破布局）。
 * - null/undefined → 'NULL'
 * - 对象 → JSON（截断 50 字符）
 * - 其他 → String（截断 50 字符）
 */
export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 50)
  return String(v).slice(0, 50)
}
