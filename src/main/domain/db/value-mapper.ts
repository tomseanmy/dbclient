/**
 * DB 原始值 → 统一 CellValue 映射
 *
 * 处理各驱动返回的特殊类型：
 * - BigInt → number（若安全）或 string（避免精度丢失）
 * - Buffer/Uint8Array → hex 字符串（带 0x 前缀标记为二进制）
 * - Date → ISO 字符串
 * - 其他 → 原样返回
 *
 * 此函数在 IPC 序列化前调用，确保所有值可被结构化克隆。
 */
import type { CellValue } from '@shared/types/database'

/** 标记二进制值的包装类型（前端据此渲染 hex） */
export interface BinaryValue {
  __binary: true
  hex: string
  length: number
}

/** 标记 JSON 值的包装类型（前端据此美化渲染） */
export interface JsonValue {
  __json: true
  data: unknown
}

/** 将 DB 原始值映射为可序列化的 CellValue */
export function mapCellValue(value: unknown): CellValue | BinaryValue | JsonValue {
  if (value === null || value === undefined) return null

  // BigInt：安全范围转 number，否则转 string 保精度
  if (typeof value === 'bigint') {
    if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
      return Number(value)
    }
    return value.toString()
  }

  // Buffer / Uint8Array → 二进制包装
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
    return {
      __binary: true,
      hex: buf.toString('hex').slice(0, 2000), // 截断超长二进制
      length: buf.length,
    }
  }

  // Date → ISO 字符串（前端按 datetime 类型格式化显示）
  if (value instanceof Date) {
    return value.toISOString()
  }

  // 对象（pg 的 jsonb 可能返回对象）→ JSON 包装
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { __json: true, data: value }
  }

  // 数组（pg 的数组类型）→ JSON 包装
  if (Array.isArray(value)) {
    return { __json: true, data: value }
  }

  // string / number / boolean 原样返回
  return value as string | number | boolean
}
