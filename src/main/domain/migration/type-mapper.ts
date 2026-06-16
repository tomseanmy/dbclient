/**
 * 跨库类型映射器
 *
 * 在 diff 阶段提前评估"源列 → 目标方言"的类型损失，登记 TypeMappingWarning，
 * 并在必要时调整目标 Column 属性（如 enum 降级后改 dataType）。
 *
 * 决策 D1：enum 统一降级 TEXT/VARCHAR + CHECK，不建真枚举。
 *
 * 与方言生成器（dialect/）的关系：
 * - dialect.typeString() 决定"目标类型字面量"（输出端）
 * - 本模块决定"是否需要告警 + 列属性调整"（评估端）
 * 两者基于同一份 unifiedType 语义，保持一致。
 */
import type { Column, UnifiedType } from '@shared/types/database'
import type { MigrationDialect, TypeMappingWarning } from '@shared/types/migration'

/** 目标方言下，某 unifiedType 是否有原生支持（无原生 → 降级并告警） */
const NATIVE_SUPPORT: Record<MigrationDialect, Partial<Record<UnifiedType, boolean>>> = {
  mysql: {
    json: true,
    enum: true, // 原生 enum，但跨库时仍降级（D1）
    uuid: false,
  },
  postgres: {
    json: true,
    enum: false, // 需自定义类型，D1 降级 TEXT
    uuid: true,
  },
  sqlite: {
    json: false, // 无原生 JSON 类型，存 TEXT
    enum: false,
    uuid: false,
    boolean: false, // 无原生 BOOL
  },
}

/** 降级后的目标原始类型（用于改写 column.dataType，保证 dialect.typeString 输出正确） */
function fallbackDataType(column: Column, dialect: MigrationDialect): string {
  switch (column.unifiedType) {
    case 'json':
      return 'text'
    case 'enum':
      // MySQL 降级 VARCHAR(n)，PG/SQLite 降级 TEXT
      if (dialect === 'mysql') {
        const maxLen = Math.max(1, ...(column.enumValues ?? []).map((v) => v.length))
        return `varchar(${maxLen})`
      }
      return 'text'
    case 'uuid':
      return dialect === 'postgres' ? 'uuid' : 'text'
    case 'boolean':
      return dialect === 'postgres' ? 'boolean' : 'integer'
    default:
      return column.dataType
  }
}

/**
 * 将源端列映射为目标方言列。
 * 返回调整后的列（副本）+ 告警列表。
 */
export function mapColumnForTarget(
  column: Column,
  targetDialect: MigrationDialect,
): { column: Column; warnings: TypeMappingWarning[] } {
  const warnings: TypeMappingWarning[] = []
  const support = NATIVE_SUPPORT[targetDialect]
  const fromType = column.dataType

  // enum：按 D1 统一降级（即使是 MySQL→MySQL 也降级为统一 IR 表达，便于跨库一致）
  if (column.unifiedType === 'enum') {
    warnings.push({
      column: column.name,
      fromType,
      toType: targetDialect === 'mysql' ? 'VARCHAR' : 'TEXT',
      reason: '枚举类型跨库降级为 TEXT/VARCHAR，建议补充 CHECK 约束',
      severity: 'warn',
    })
  } else if (support && support[column.unifiedType] === false) {
    // 无原生支持的其他类型
    const reasonMap: Partial<Record<UnifiedType, string>> = {
      json: '目标库无原生 JSON 类型，降级为 TEXT（无 JSON 约束）',
      uuid: '目标库无原生 UUID 类型，降级为 TEXT',
      boolean: '目标库无原生布尔类型，降级为 INTEGER（0/1）',
    }
    warnings.push({
      column: column.name,
      fromType,
      toType: fallbackDataType(column, targetDialect),
      reason: reasonMap[column.unifiedType] ?? `类型 ${fromType} 在目标方言降级处理`,
      severity: 'warn',
    })
  }

  // 自增跨库差异告警（R4）
  if (column.autoIncrement) {
    warnings.push({
      column: column.name,
      fromType,
      toType:
        targetDialect === 'sqlite'
          ? 'INTEGER PRIMARY KEY AUTOINCREMENT'
          : targetDialect === 'postgres'
            ? 'SERIAL/BIGSERIAL'
            : 'AUTO_INCREMENT',
      reason: '自增列语义跨库不同，迁移时建议显式不带自增属性传输数据 ID',
      severity: 'info',
    })
  }

  // 时区敏感类型告警（R5）
  if (column.unifiedType === 'datetime') {
    warnings.push({
      column: column.name,
      fromType,
      toType: targetDialect === 'sqlite' ? 'TEXT (ISO8601)' : 'TIMESTAMP',
      reason: 'datetime 跨库可能存在时区/精度差异，统一以 ISO8601 字符串传输',
      severity: 'info',
    })
  }

  // 调整列属性副本（不改原对象）
  const mapped: Column = {
    ...column,
    dataType: fallbackDataType(column, targetDialect),
  }

  return { column: mapped, warnings }
}

/**
 * 批量映射一组列。
 */
export function mapColumnsForTarget(
  columns: Column[],
  targetDialect: MigrationDialect,
): { columns: Column[]; warnings: TypeMappingWarning[] } {
  const allWarnings: TypeMappingWarning[] = []
  const mapped = columns.map((c) => {
    const { column, warnings } = mapColumnForTarget(c, targetDialect)
    allWarnings.push(...warnings)
    return column
  })
  return { columns: mapped, warnings: allWarnings }
}
