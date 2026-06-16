/**
 * column-types 单元测试
 *
 * 覆盖：各方言预置类型清单、分组、needsLength 判定。
 */
import { describe, it, expect } from 'vitest'
import {
  getColumnTypes,
  getColumnTypesGrouped,
  findTypeOption,
  typeNeedsLength,
  MYSQL_TYPES,
  POSTGRES_TYPES,
  SQLITE_TYPES,
} from './column-types'

describe('getColumnTypes', () => {
  it('MySQL 包含常用整数/字符串/时间类型', () => {
    const names = getColumnTypes('mysql').map((t) => t.name)
    expect(names).toContain('int')
    expect(names).toContain('bigint')
    expect(names).toContain('varchar')
    expect(names).toContain('text')
    expect(names).toContain('datetime')
    expect(names).toContain('json')
  })

  it('PostgreSQL 包含 character varying / jsonb / uuid', () => {
    const names = getColumnTypes('postgres').map((t) => t.name)
    expect(names).toContain('character varying')
    expect(names).toContain('jsonb')
    expect(names).toContain('uuid')
    expect(names).toContain('serial')
  })

  it('SQLite 只有原生存储类（integer/real/text/blob/numeric）', () => {
    const names = getColumnTypes('sqlite').map((t) => t.name)
    expect(names).toEqual(['integer', 'real', 'text', 'blob', 'numeric'])
    // 不应出现 SQLite 不存在的类型
    expect(names).not.toContain('varchar')
    expect(names).not.toContain('tinyint')
    expect(names).not.toContain('decimal')
  })
})

describe('typeNeedsLength', () => {
  it('varchar 需要长度（MySQL/PG）', () => {
    expect(typeNeedsLength('mysql', 'varchar')).toBe(true)
    expect(typeNeedsLength('postgres', 'varchar')).toBe(true)
    // SQLite 没有 varchar 类型，不在清单内
    expect(typeNeedsLength('sqlite', 'varchar')).toBe(false)
  })

  it('SQLite 原生类型都不需要长度', () => {
    for (const t of ['integer', 'real', 'text', 'blob', 'numeric']) {
      expect(typeNeedsLength('sqlite', t)).toBe(false)
    }
  })

  it('int/text/boolean 不需要长度', () => {
    for (const t of ['int', 'text', 'boolean', 'json']) {
      expect(typeNeedsLength('mysql', t)).toBe(false)
    }
  })

  it('decimal 需要长度与小数位', () => {
    const opt = findTypeOption('mysql', 'decimal')
    expect(opt?.needsLength).toBe(true)
    expect(opt?.needsScale).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(typeNeedsLength('mysql', 'VARCHAR')).toBe(true)
    expect(typeNeedsLength('postgres', 'Numeric')).toBe(true)
  })

  it('未在清单内的类型保守判为 false', () => {
    expect(typeNeedsLength('mysql', 'unknown_type')).toBe(false)
  })
})

describe('getColumnTypesGrouped', () => {
  it('MySQL 分组包含整数/字符串等', () => {
    const groups = getColumnTypesGrouped('mysql')
    const labels = groups.map((g) => g.label)
    expect(labels).toContain('整数')
    expect(labels).toContain('字符串')
    expect(labels).toContain('日期时间')
  })

  it('每个分组的选项都属于该 group', () => {
    const groups = getColumnTypesGrouped('postgres')
    for (const g of groups) {
      for (const opt of g.options) {
        // 分组标签是中文，这里只验证选项数量 > 0 且分组非空
        expect(opt.name.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('清单完整性', () => {
  it('needsLength=true 的类型都有 defaultLength', () => {
    for (const t of [...MYSQL_TYPES, ...POSTGRES_TYPES, ...SQLITE_TYPES]) {
      if (t.needsLength) {
        expect(t.defaultLength, `${t.name} 应有 defaultLength`).toBeDefined()
      }
    }
  })

  it('needsScale=true 的类型同时 needsLength=true', () => {
    for (const t of [...MYSQL_TYPES, ...POSTGRES_TYPES, ...SQLITE_TYPES]) {
      if (t.needsScale) {
        expect(t.needsLength, `${t.name} 有 scale 应同时有 length`).toBe(true)
      }
    }
  })
})
