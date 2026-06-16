/**
 * 查询结果导出工具（CsvWorkspace / TableData 共用）
 *
 * 统一 CSV 转义规则（含逗号/引号/换行的值用双引号包裹，内部引号双写）。
 */
import type { QueryResult } from '@shared/types/database'

/**
 * 触发浏览器下载（生成 Blob + 临时 <a> 点击）。
 */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 把单个值转为 CSV 字段（按需加引号转义） */
function toCsvField(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  // 含逗号 / 双引号 / 换行的值需用双引号包裹，内部双引号双写转义
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/**
 * 把查询结果导出为 CSV 文件。
 * @param filename 文件名（含 .csv 后缀）
 */
export function exportResultCsv(filename: string, result: QueryResult): void {
  const headers = result.columns.map((c) => c.name).join(',')
  const lines = result.rows.map((row) =>
    result.columns.map((c) => toCsvField(row[c.name])).join(','),
  )
  downloadText(filename, [headers, ...lines].join('\n'), 'text/csv')
}

/**
 * 把查询结果导出为 JSON 文件。
 * @param filename 文件名（含 .json 后缀）
 */
export function exportResultJson(filename: string, result: QueryResult): void {
  downloadText(filename, JSON.stringify(result.rows, null, 2), 'application/json')
}
