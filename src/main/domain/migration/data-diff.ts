import { tMain } from '@main/i18n'
/**
 * 数据 diff 计算器
 *
 * 按主键（PK）比对源/目标行集，产出 DataDiffItem[]：
 * - incremental：源有目标无 → insert；目标有源无 → delete；都有 → 跳过（不做 UPDATE）
 * - fullReplace：所有源行 → insert（前面补 truncate/deleteAll）；目标多余 PK → delete
 * - insertOnly：仅源有目标无 → insert；目标多余 PK 保留不动
 *
 * 产品边界：不做 UPDATE（见 M5 §1.3）。需要更新引导走 fullReplace。
 *
 * PK 归一比较：跨库类型差异（MySQL bigint vs SQLite INTEGER）按值字符串化比较，
 * 避免 1n !== 1 之类误判。
 */
import type { CellValue, TableMeta } from '@shared/types/database'
import type { DataDiffItem, DataStrategy } from '@shared/types/migration'

/** 行数据（列名 → 值） */
export type Row = Record<string, CellValue>

/**
 * 从 TableMeta 提取主键列名。
 * 多列主键按 columns 顺序返回；无主键时抛错（数据迁移依赖 PK）。
 */
export function extractPrimaryKeys(meta: TableMeta): string[] {
  const pks = meta.columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
  if (pks.length === 0) {
    throw new Error(tMain('errors.migration.noPrimaryKey', { table: meta.name }))
  }
  return pks
}

/** 取一行的 PK 值数组（按 pkColumns 顺序） */
function pkOf(row: Row, pkColumns: string[]): CellValue[] {
  return pkColumns.map((c) => row[c] ?? null)
}

/** PK 值数组 → 可比较的字符串 key（归一跨库类型差异） */
function pkKey(pk: CellValue[]): string {
  return pk
    .map((v) => {
      if (v === null || v === undefined) return '\u0000'
      if (typeof v === 'object') return JSON.stringify(v)
      return String(v)
    })
    .join('\u0001')
}

/** 构建 PK 值 → 行 的索引 */
function indexByPk(rows: Row[], pkColumns: string[]): Map<string, Row> {
  const map = new Map<string, Row>()
  for (const row of rows) {
    map.set(pkKey(pkOf(row, pkColumns)), row)
  }
  return map
}

/**
 * 计算源 → 目标的数据 diff。
 *
 * @param sourceRows 源端行集（已分批拉取后在内存中比对）
 * @param targetRows 目标端行集
 * @param pkColumns 主键列名
 * @param strategy 数据迁移策略
 */
export function diffData(
  sourceRows: Row[],
  targetRows: Row[],
  pkColumns: string[],
  strategy: DataStrategy,
): DataDiffItem[] {
  const targetIndex = indexByPk(targetRows, pkColumns)
  const sourceIndex = indexByPk(sourceRows, pkColumns)
  const items: DataDiffItem[] = []

  // 源行 → insert（incremental/insertOnly 仅缺的；fullReplace 全量）
  for (const row of sourceRows) {
    const key = pkKey(pkOf(row, pkColumns))
    const existsInTarget = targetIndex.has(key)
    if (strategy === 'fullReplace' || !existsInTarget) {
      items.push({ kind: 'insert', pk: pkOf(row, pkColumns), row })
    }
  }

  // 目标多余 PK → delete（incremental/fullReplace 删；insertOnly 不删）
  if (strategy === 'incremental' || strategy === 'fullReplace') {
    for (const row of targetRows) {
      const key = pkKey(pkOf(row, pkColumns))
      if (!sourceIndex.has(key)) {
        items.push({ kind: 'delete', pk: pkOf(row, pkColumns) })
      }
    }
  }

  return items
}

/**
 * 统计各策略下的预期操作数（UI 预估用，无需拉全量数据）。
 *
 * @param sourceCount 源行数
 * @param targetCount 目标行数
 * @param overlapCount 双方都存在的 PK 数（需先采样或全量比对）
 */
export function estimateDataOps(
  sourceCount: number,
  targetCount: number,
  overlapCount: number,
  strategy: DataStrategy,
): { inserts: number; deletes: number } {
  const sourceOnly = sourceCount - overlapCount
  const targetOnly = targetCount - overlapCount
  switch (strategy) {
    case 'incremental':
      return { inserts: sourceOnly, deletes: targetOnly }
    case 'fullReplace':
      return { inserts: sourceCount, deletes: targetOnly }
    case 'insertOnly':
      return { inserts: sourceOnly, deletes: 0 }
  }
}
