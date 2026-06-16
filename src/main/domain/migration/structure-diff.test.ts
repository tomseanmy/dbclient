/**
 * structure-diff 单元测试
 *
 * 覆盖：
 * - 目标表不存在 → createTable
 * - 新增列 / 删除列
 * - 修改列（类型变、nullable 变、PK 变、默认值变、长度显著变、scale 变）
 * - 同名列长度"兼容方向"不误报 modify
 * - 跨方言类型归一（unifiedType 相同不报 modify）
 * - 索引 add / drop / 同名属性变（drop+add）
 * - 外键 add / drop / 按 (columns, referencesTable) 匹配
 * - summarizeDiff
 */
import { describe, it, expect } from 'vitest'
import { diffStructure, summarizeDiff } from './structure-diff'
import type { Column, TableMeta } from '@shared/types/database'

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

function meta(columns: Column[], overrides: Partial<TableMeta> = {}): TableMeta {
  return {
    name: 'users',
    type: 'table',
    columns,
    indexes: [],
    foreignKeys: [],
    ...overrides,
  }
}

describe('diffStructure - 目标表不存在', () => {
  it('整体 createTable', () => {
    const source = meta([
      col({
        name: 'id',
        dataType: 'bigint',
        unifiedType: 'integer',
        length: undefined,
        isPrimaryKey: true,
        nullable: false,
      }),
    ])
    const items = diffStructure(source, null)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'createTable', tableMeta: { name: 'users' } })
  })

  it('target 为 undefined 同样 createTable', () => {
    const source = meta([col({ name: 'a' })])
    expect(diffStructure(source, undefined)[0]?.kind).toBe('createTable')
  })
})

describe('diffStructure - 列 add / drop', () => {
  it('源有目标无 → addColumn', () => {
    const source = meta([col({ name: 'a' }), col({ name: 'b' })])
    const target = meta([col({ name: 'a' })])
    const items = diffStructure(source, target)
    expect(items.filter((i) => i.kind === 'addColumn')).toHaveLength(1)
    expect(items.find((i) => i.kind === 'addColumn')).toMatchObject({ column: { name: 'b' } })
  })

  it('目标有源无 → dropColumn', () => {
    const source = meta([col({ name: 'a' })])
    const target = meta([col({ name: 'a' }), col({ name: 'legacy' })])
    const items = diffStructure(source, target)
    expect(items.find((i) => i.kind === 'dropColumn')).toMatchObject({ columnName: 'legacy' })
  })
})

describe('diffStructure - 列 modify', () => {
  it('unifiedType 变化 → modifyColumn（含 dataType 改动）', () => {
    const source = meta([
      col({ name: 'age', unifiedType: 'integer', dataType: 'bigint', length: undefined }),
    ])
    const target = meta([
      col({ name: 'age', unifiedType: 'string', dataType: 'varchar', length: 255 }),
    ])
    const items = diffStructure(source, target)
    const m = items.find((i) => i.kind === 'modifyColumn')
    expect(m).toBeTruthy()
    if (m?.kind === 'modifyColumn') {
      expect(m.changes.unifiedType).toBe('integer')
      expect(m.changes.dataType).toBe('bigint')
    }
  })

  it('nullable 变化 → modifyColumn', () => {
    const source = meta([col({ name: 'email', nullable: false })])
    const target = meta([col({ name: 'email', nullable: true })])
    const items = diffStructure(source, target)
    expect(items.some((i) => i.kind === 'modifyColumn')).toBe(true)
  })

  it('默认值变化 → modifyColumn', () => {
    const source = meta([col({ name: 'status', defaultValue: 'active' })])
    const target = meta([col({ name: 'status', defaultValue: null })])
    expect(diffStructure(source, target).some((i) => i.kind === 'modifyColumn')).toBe(true)
  })

  it('长度"兼容方向"（源≤目标）不误报 modify', () => {
    const source = meta([col({ name: 'name', length: 100 })])
    const target = meta([col({ name: 'name', length: 255 })])
    const items = diffStructure(source, target)
    expect(items.some((i) => i.kind === 'modifyColumn')).toBe(false)
  })

  it('长度"非兼容方向"（源>目标）报 modify', () => {
    const source = meta([col({ name: 'name', length: 500 })])
    const target = meta([col({ name: 'name', length: 100 })])
    expect(diffStructure(source, target).some((i) => i.kind === 'modifyColumn')).toBe(true)
  })

  it('scale 精度变化必报 modify', () => {
    const source = meta([
      col({ name: 'amount', unifiedType: 'decimal', dataType: 'decimal', length: 10, scale: 4 }),
    ])
    const target = meta([
      col({ name: 'amount', unifiedType: 'decimal', dataType: 'decimal', length: 10, scale: 2 }),
    ])
    const m = diffStructure(source, target).find((i) => i.kind === 'modifyColumn')
    expect(m).toBeTruthy()
  })

  it('跨方言同语义（unifiedType 相同、原始类型名不同）不报 modify', () => {
    // MySQL bigint vs PG bigint，都是 integer
    const source = meta([
      col({ name: 'id', unifiedType: 'integer', dataType: 'bigint', length: undefined }),
    ])
    const target = meta([
      col({ name: 'id', unifiedType: 'integer', dataType: 'int8', length: undefined }),
    ])
    expect(diffStructure(source, target)).toHaveLength(0)
  })

  it('完全相同 → 无 diff', () => {
    const c = col({ name: 'a' })
    expect(diffStructure(meta([c]), meta([{ ...c }]))).toHaveLength(0)
  })
})

describe('diffStructure - 索引', () => {
  it('源新增索引 → addIndex', () => {
    const source = meta([col({ name: 'a' })], {
      indexes: [{ name: 'idx_a', columns: ['a'], isUnique: false }],
    })
    const target = meta([col({ name: 'a' })])
    expect(diffStructure(source, target).find((i) => i.kind === 'addIndex')).toMatchObject({
      index: { name: 'idx_a' },
    })
  })

  it('目标多余索引 → dropIndex', () => {
    const source = meta([col({ name: 'a' })])
    const target = meta([col({ name: 'a' })], {
      indexes: [{ name: 'idx_old', columns: ['a'], isUnique: false }],
    })
    expect(diffStructure(source, target).find((i) => i.kind === 'dropIndex')).toMatchObject({
      indexName: 'idx_old',
    })
  })

  it('同名索引属性变 → drop + add', () => {
    const source = meta([col({ name: 'a' })], {
      indexes: [{ name: 'idx_a', columns: ['a'], isUnique: true }],
    })
    const target = meta([col({ name: 'a' })], {
      indexes: [{ name: 'idx_a', columns: ['a'], isUnique: false }],
    })
    const items = diffStructure(source, target)
    expect(items.filter((i) => i.kind === 'dropIndex')).toHaveLength(1)
    expect(items.filter((i) => i.kind === 'addIndex')).toHaveLength(1)
  })
})

describe('diffStructure - 外键', () => {
  const baseFk = {
    name: 'fk_user_post',
    columns: ['user_id'],
    referencesTable: 'users',
    referencesColumns: ['id'],
  }

  it('源新增外键 → addForeignKey', () => {
    const source = meta(
      [col({ name: 'user_id', unifiedType: 'integer', dataType: 'bigint', length: undefined })],
      { foreignKeys: [{ ...baseFk }] },
    )
    const target = meta([
      col({ name: 'user_id', unifiedType: 'integer', dataType: 'bigint', length: undefined }),
    ])
    expect(diffStructure(source, target).find((i) => i.kind === 'addForeignKey')).toMatchObject({
      fk: { name: 'fk_user_post' },
    })
  })

  it('目标多余外键 → dropForeignKey', () => {
    const source = meta([
      col({ name: 'user_id', unifiedType: 'integer', dataType: 'bigint', length: undefined }),
    ])
    const target = meta(
      [col({ name: 'user_id', unifiedType: 'integer', dataType: 'bigint', length: undefined })],
      { foreignKeys: [{ ...baseFk }] },
    )
    expect(diffStructure(source, target).find((i) => i.kind === 'dropForeignKey')).toMatchObject({
      fkName: 'fk_user_post',
    })
  })

  it('按 (columns, referencesTable) 匹配，名称不同但语义相同 → 不报', () => {
    const source = meta(
      [col({ name: 'user_id', unifiedType: 'integer', dataType: 'bigint', length: undefined })],
      { foreignKeys: [{ ...baseFk, onDelete: 'CASCADE' }] },
    )
    const target = meta(
      [col({ name: 'user_id', unifiedType: 'integer', dataType: 'bigint', length: undefined })],
      { foreignKeys: [{ ...baseFk, name: 'fk_other', onDelete: 'CASCADE' }] },
    )
    expect(diffStructure(source, target)).toHaveLength(0)
  })

  it('onDelete 变化 → drop + add', () => {
    const source = meta(
      [col({ name: 'user_id', unifiedType: 'integer', dataType: 'bigint', length: undefined })],
      { foreignKeys: [{ ...baseFk, onDelete: 'CASCADE' }] },
    )
    const target = meta(
      [col({ name: 'user_id', unifiedType: 'integer', dataType: 'bigint', length: undefined })],
      { foreignKeys: [{ ...baseFk, onDelete: 'RESTRICT' }] },
    )
    const items = diffStructure(source, target)
    expect(items.some((i) => i.kind === 'dropForeignKey')).toBe(true)
    expect(items.some((i) => i.kind === 'addForeignKey')).toBe(true)
  })
})

describe('summarizeDiff', () => {
  it('按 kind 计数', () => {
    const items = [
      { kind: 'addColumn', column: col({ name: 'a' }) },
      { kind: 'addColumn', column: col({ name: 'b' }) },
      { kind: 'dropColumn', columnName: 'c' },
    ] as const
    expect(summarizeDiff([...items])).toEqual({ addColumn: 2, dropColumn: 1 })
  })
})
