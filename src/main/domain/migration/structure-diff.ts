/**
 * 结构 diff 计算器（纯函数）
 *
 * 输入源端 / 目标端两个 TableMeta，产出 StructureDiffItem[]：
 * - 目标表不存在 → createTable
 * - 列：按名 join，判定 add / drop / modify
 * - 索引：按名 join
 * - 外键：按 (columns, referencesTable) 元组匹配
 *
 * 跨库友好的判定：
 * - 类型差异经 unifiedType 归一比较，避免 varchar(255) vs varchar(100) 跨方言误报。
 *   仅当 unifiedType 变化、nullable 变化、主键语义变化、或长度跨"等价范围"外才算 modify。
 * - 不在此层做类型降级告警（那是 type-mapper 的职责，由调用方在 diff 前对源端列预处理）。
 */
import type { Column, ForeignKey, Index, TableMeta } from '@shared/types/database'
import type { StructureDiffItem } from '@shared/types/migration'

/** 长度差异是否值得算"改"：仅在目标库要存得下源数据时静默，否则提示 */
function lengthMateriallyChanged(a: Column, b: Column): boolean {
  // 两边都无长度 → 不算
  if (a.length == null && b.length == null) return false
  // 一方有长度一方无 → 算（可能影响存储）
  if (a.length == null || b.length == null) return true
  // 都有长度：源比目标大 → 目标可能存不下，算"改"；源≤目标 → 静默（兼容方向）
  return a.length > b.length
}

/** 两列是否构成"修改"（非新增/删除的同名列属性变化） */
function columnModified(
  source: Column,
  target: Column,
): { modified: boolean; changes: Partial<Column> } {
  const changes: Partial<Column> = {}
  if (source.unifiedType !== target.unifiedType) {
    changes.unifiedType = source.unifiedType
    changes.dataType = source.dataType
  }
  if (source.nullable !== target.nullable) {
    changes.nullable = source.nullable
  }
  if (source.isPrimaryKey !== target.isPrimaryKey) {
    changes.isPrimaryKey = source.isPrimaryKey
  }
  if (!!source.autoIncrement !== !!target.autoIncrement) {
    changes.autoIncrement = source.autoIncrement
  }
  // 默认值变化（null 归一比较）
  const sDef = source.defaultValue ?? null
  const tDef = target.defaultValue ?? null
  if (sDef !== tDef) {
    changes.defaultValue = source.defaultValue
  }
  // 长度（仅显著差异算改）
  if (lengthMateriallyChanged(source, target)) {
    changes.length = source.length
  }
  // scale 一律敏感（精度丢失不可逆）
  if (source.scale !== target.scale) {
    changes.scale = source.scale
  }
  return { modified: Object.keys(changes).length > 0, changes }
}

/** 列 diff：返回 add / drop / modify 项 */
function diffColumns(source: TableMeta, target: TableMeta): StructureDiffItem[] {
  const items: StructureDiffItem[] = []
  const targetByName = new Map(target.columns.map((c) => [c.name, c]))

  // 源有目标无 → addColumn
  for (const sCol of source.columns) {
    if (!targetByName.has(sCol.name)) {
      items.push({ kind: 'addColumn', column: sCol })
    }
  }

  // 同名列 → 判定 modify（以源为准，把源属性带入目标）
  for (const sCol of source.columns) {
    const tCol = targetByName.get(sCol.name)
    if (!tCol) continue
    const { modified, changes } = columnModified(sCol, tCol)
    if (modified) {
      items.push({ kind: 'modifyColumn', column: sCol, changes })
    }
  }

  // 目标有源无 → dropColumn
  const sourceNames = new Set(source.columns.map((c) => c.name))
  for (const tCol of target.columns) {
    if (!sourceNames.has(tCol.name)) {
      items.push({ kind: 'dropColumn', columnName: tCol.name })
    }
  }

  return items
}

/** 索引 diff：按名 join（drop + add） */
function diffIndexes(source: TableMeta, target: TableMeta): StructureDiffItem[] {
  const items: StructureDiffItem[] = []
  const targetByName = new Map(target.indexes.map((i) => [i.name, i]))

  for (const sIdx of source.indexes) {
    const tIdx = targetByName.get(sIdx.name)
    if (!tIdx) {
      items.push({ kind: 'addIndex', index: sIdx })
      continue
    }
    // 同名但属性变 → drop + add（跨方言最稳）
    if (indexChanged(sIdx, tIdx)) {
      items.push({ kind: 'dropIndex', indexName: sIdx.name })
      items.push({ kind: 'addIndex', index: sIdx })
    }
  }

  const sourceNames = new Set(source.indexes.map((i) => i.name))
  for (const tIdx of target.indexes) {
    if (!sourceNames.has(tIdx.name)) {
      items.push({ kind: 'dropIndex', indexName: tIdx.name })
    }
  }

  return items
}

function indexChanged(a: Index, b: Index): boolean {
  return (
    a.columns.join(',') !== b.columns.join(',') ||
    !!a.isUnique !== !!b.isUnique ||
    !!a.isPrimaryKey !== !!b.isPrimaryKey
  )
}

/** 外键 diff：按 (columns, referencesTable) 元组匹配 */
function diffForeignKeys(source: TableMeta, target: TableMeta): StructureDiffItem[] {
  const items: StructureDiffItem[] = []
  const fkKey = (f: ForeignKey) => `${f.columns.join(',')}→${f.referencesTable}`
  const targetByKey = new Map(target.foreignKeys.map((f) => [fkKey(f), f]))

  for (const sFk of source.foreignKeys) {
    const tFk = targetByKey.get(fkKey(sFk))
    if (!tFk) {
      items.push({ kind: 'addForeignKey', fk: sFk })
      continue
    }
    if (fkChanged(sFk, tFk)) {
      items.push({ kind: 'dropForeignKey', fkName: tFk.name })
      items.push({ kind: 'addForeignKey', fk: sFk })
    }
  }

  const sourceKeys = new Set(source.foreignKeys.map(fkKey))
  for (const tFk of target.foreignKeys) {
    if (!sourceKeys.has(fkKey(tFk))) {
      items.push({ kind: 'dropForeignKey', fkName: tFk.name })
    }
  }

  return items
}

function fkChanged(a: ForeignKey, b: ForeignKey): boolean {
  return (
    (a.onDelete ?? 'NO ACTION') !== (b.onDelete ?? 'NO ACTION') ||
    (a.onUpdate ?? 'NO ACTION') !== (b.onUpdate ?? 'NO ACTION') ||
    a.referencesColumns.join(',') !== b.referencesColumns.join(',')
  )
}

/**
 * 计算源 → 目标的结构 diff。
 *
 * @param source 源端表结构（以源为准）
 * @param target 目标端表结构（被对齐方）。为 null/undefined 表示目标表不存在 → 整体 createTable
 */
export function diffStructure(
  source: TableMeta,
  target: TableMeta | null | undefined,
): StructureDiffItem[] {
  // 目标表不存在 → 整表创建
  if (!target) {
    return [{ kind: 'createTable', tableMeta: source }]
  }

  return [
    ...diffColumns(source, target),
    ...diffIndexes(source, target),
    ...diffForeignKeys(source, target),
  ]
}

/**
 * 统计 diff 中按 kind 的分布（UI 展示用）。
 */
export function summarizeDiff(items: StructureDiffItem[]): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const item of items) {
    summary[item.kind] = (summary[item.kind] ?? 0) + 1
  }
  return summary
}
