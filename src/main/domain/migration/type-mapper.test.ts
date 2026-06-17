/**
 * type-mapper 单元测试
 *
 * 覆盖：
 * - 4 库 × 关键 unifiedType 的正向映射（dataType 调整）
 * - enum 降级（D1）：MySQL→VARCHAR(n)，PG/SQLite→TEXT，且产生 warn
 * - json 降级：PG/MySQL→保留，SQLite→TEXT + warn
 * - uuid：PG→uuid，MySQL/SQLite→text + warn
 * - boolean：PG→boolean，MySQL/sqlite→integer + warn
 * - 自增 / datetime 告警（info）
 * - 批量映射 mapColumnsForTarget
 */
import { describe, it, expect } from 'vitest'
import { mapColumnForTarget, mapColumnsForTarget } from './type-mapper'
import type { Column } from '@shared/types/database'

function col(overrides: Partial<Column> = {}): Column {
  return {
    name: 'c',
    dataType: 'varchar',
    unifiedType: 'string',
    length: 255,
    nullable: true,
    isPrimaryKey: false,
    ...overrides,
  }
}

describe('mapColumnForTarget - 正向映射（无告警）', () => {
  it('string → MySQL 保持 VARCHAR', () => {
    const { column, warnings } = mapColumnForTarget(
      col({ dataType: 'varchar', length: 255 }),
      'mysql',
    )
    expect(column.dataType).toBe('varchar')
    expect(warnings).toHaveLength(0)
  })

  it('integer → 任意方言不告警', () => {
    for (const d of ['mysql', 'postgres', 'sqlite'] as const) {
      const { warnings } = mapColumnForTarget(
        col({ dataType: 'bigint', unifiedType: 'integer', length: undefined }),
        d,
      )
      expect(warnings).toHaveLength(0)
    }
  })
})

describe('mapColumnForTarget - enum 降级（D1）', () => {
  it('MySQL enum → VARCHAR(n) + warn', () => {
    const src = col({
      dataType: "enum('a','bb','ccc')",
      unifiedType: 'enum',
      length: undefined,
      enumValues: ['a', 'bb', 'ccc'],
    })
    const { column, warnings } = mapColumnForTarget(src, 'mysql')
    expect(column.dataType).toBe('varchar(3)') // 最长值 'ccc' = 3
    const warn = warnings.find((w) => w.column === 'c')
    expect(warn?.severity).toBe('warn')
    expect(warn?.toType).toBe('VARCHAR')
  })

  it('PG enum → TEXT + warn', () => {
    const src = col({ dataType: 'status_enum', unifiedType: 'enum', enumValues: ['on', 'off'] })
    const { column, warnings } = mapColumnForTarget(src, 'postgres')
    expect(column.dataType).toBe('text')
    expect(warnings.some((w) => w.severity === 'warn')).toBe(true)
  })

  it('SQLite enum → TEXT + warn', () => {
    const src = col({ dataType: 'enum', unifiedType: 'enum', enumValues: ['x'] })
    const { column } = mapColumnForTarget(src, 'sqlite')
    expect(column.dataType).toBe('text')
  })
})

describe('mapColumnForTarget - json 降级', () => {
  it('SQLite 无原生 JSON → TEXT + warn', () => {
    const src = col({ dataType: 'json', unifiedType: 'json', length: undefined })
    const { column, warnings } = mapColumnForTarget(src, 'sqlite')
    expect(column.dataType).toBe('text')
    expect(warnings.some((w) => w.reason.includes('jsonDowngrade'))).toBe(true)
  })

  it('PG/MySQL 有原生 JSON → 不告警', () => {
    const src = col({ dataType: 'jsonb', unifiedType: 'json', length: undefined })
    expect(mapColumnForTarget(src, 'postgres').warnings).toHaveLength(0)
    expect(mapColumnForTarget(src, 'mysql').warnings).toHaveLength(0)
  })
})

describe('mapColumnForTarget - uuid / boolean 降级', () => {
  it('uuid → PG 保留，MySQL/SQLite 降级 text + warn', () => {
    const src = col({ dataType: 'uuid', unifiedType: 'uuid', length: undefined })
    expect(mapColumnForTarget(src, 'postgres').column.dataType).toBe('uuid')
    const mysql = mapColumnForTarget(src, 'mysql')
    expect(mysql.column.dataType).toBe('text')
    expect(mysql.warnings.some((w) => w.reason.includes('uuidDowngrade'))).toBe(true)
    expect(mapColumnForTarget(src, 'sqlite').column.dataType).toBe('text')
  })

  it('boolean → PG 保留，MySQL/SQLite 降级 integer + warn', () => {
    const src = col({ dataType: 'boolean', unifiedType: 'boolean', length: undefined })
    expect(mapColumnForTarget(src, 'postgres').column.dataType).toBe('boolean')
    expect(mapColumnForTarget(src, 'sqlite').column.dataType).toBe('integer')
    expect(mapColumnForTarget(src, 'mysql').column.dataType).toBe('integer')
  })
})

describe('mapColumnForTarget - 自增 / datetime 告警', () => {
  it('自增列产生 info 告警', () => {
    const src = col({
      dataType: 'bigint',
      unifiedType: 'integer',
      autoIncrement: true,
      isPrimaryKey: true,
      length: undefined,
    })
    const { warnings } = mapColumnForTarget(src, 'postgres')
    expect(
      warnings.some((w) => w.severity === 'info' && w.reason.includes('autoIncrementDiff')),
    ).toBe(true)
  })

  it('datetime 列产生 info 告警', () => {
    const src = col({ dataType: 'datetime', unifiedType: 'datetime', length: undefined })
    const { warnings } = mapColumnForTarget(src, 'sqlite')
    expect(warnings.some((w) => w.severity === 'info' && w.toType.includes('ISO8601'))).toBe(true)
  })
})

describe('mapColumnsForTarget - 批量', () => {
  it('多列各自独立告警，汇总到 warnings', () => {
    const cols = [
      col({ name: 'id', dataType: 'bigint', unifiedType: 'integer', length: undefined }),
      col({ name: 'data', dataType: 'jsonb', unifiedType: 'json', length: undefined }),
      col({ name: 'flag', dataType: 'bool', unifiedType: 'boolean', length: undefined }),
    ]
    const { columns, warnings } = mapColumnsForTarget(cols, 'sqlite')
    expect(columns).toHaveLength(3)
    // json + boolean 两项告警（id 无告警）
    expect(warnings.some((w) => w.column === 'data')).toBe(true)
    expect(warnings.some((w) => w.column === 'flag')).toBe(true)
    expect(warnings.every((w) => w.column !== 'id')).toBe(true)
  })

  it('不改原列对象（返回副本）', () => {
    const original = col({ dataType: 'json', unifiedType: 'json', length: undefined })
    mapColumnForTarget(original, 'sqlite')
    expect(original.dataType).toBe('json') // 原对象未被修改
  })
})
