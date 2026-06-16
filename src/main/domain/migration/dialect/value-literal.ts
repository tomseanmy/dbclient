/**
 * 值字面量共享辅助
 *
 * 字符串单引号转义（SQL 标准 ''）各库一致；
 * 布尔字面量各库不同，由各方言 dialect.literal 包装本模块。
 */
import type { CellValue } from '@shared/types/database'

/** 判断是否为二进制类型（Uint8Array） */
export function isBinary(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

/** 字符串 → SQL 单引号字面量（标准转义：' → ''） */
export function stringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * 值 → 字面量（不含布尔/二进制，这两类由方言决定）。
 * 返回 null 表示调用方需自行处理（如布尔）。
 */
export function scalarLiteral(value: CellValue): string | null {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'string') return stringLiteral(value)
  if (typeof value === 'boolean') return null // 布尔由方言决定
  if (isBinary(value)) return null // 二进制由方言决定
  // object（含 JSON）
  if (typeof value === 'object') return stringLiteral(JSON.stringify(value))
  return stringLiteral(String(value))
}
