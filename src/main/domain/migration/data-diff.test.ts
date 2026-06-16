/**
 * data-diff 单元测试
 *
 * 覆盖：
 * - extractPrimaryKeys：正常/无主键抛错
 * - incremental：源有目标无→insert，目标有源无→delete，都有→跳过（不 UPDATE）
 * - fullReplace：全量 insert + 目标多余 delete
 * - insertOnly：仅 insert，不 delete 目标多余
 * - 跨库 PK 归一（数字 vs 字符串）
 * - 多列主键
 * - estimateDataOps
 */
import { describe, it, expect } from 'vitest'
import { diffData, extractPrimaryKeys, estimateDataOps } from './data-diff'
import type { Row } from './data-diff'
import type { TableMeta } from '@shared/types/database'

function metaWithPk(pkCols: string[]): TableMeta {
  return {
    name: 't',
    type: 'table',
    columns: pkCols.map((name) => ({
      name,
      dataType: 'bigint',
      unifiedType: 'integer' as const,
      nullable: false,
      isPrimaryKey: true,
    })),
    indexes: [],
    foreignKeys: [],
  }
}

describe('extractPrimaryKeys', () => {
  it('返回标记 isPrimaryKey 的列', () => {
    expect(extractPrimaryKeys(metaWithPk(['id']))).toEqual(['id'])
  })

  it('无主键抛错', () => {
    const m: TableMeta = {
      name: 't',
      type: 'table',
      columns: [
        { name: 'a', dataType: 'int', unifiedType: 'integer', nullable: true, isPrimaryKey: false },
      ],
      indexes: [],
      foreignKeys: [],
    }
    expect(() => extractPrimaryKeys(m)).toThrow(/无主键/)
  })
})

describe('diffData - incremental', () => {
  const pk = ['id']
  it('源有目标无 → insert', () => {
    const source: Row[] = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]
    const target: Row[] = [{ id: 2, name: 'b_old' }]
    const items = diffData(source, target, pk, 'incremental')
    const inserts = items.filter((i) => i.kind === 'insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.row).toEqual({ id: 1, name: 'a' })
  })

  it('目标有源无 → delete', () => {
    const source: Row[] = [{ id: 1, name: 'a' }]
    const target: Row[] = [
      { id: 1, name: 'a' },
      { id: 3, name: 'c' },
    ]
    const items = diffData(source, target, pk, 'incremental')
    const deletes = items.filter((i) => i.kind === 'delete')
    expect(deletes).toHaveLength(1)
    expect(deletes[0]?.pk).toEqual([3])
  })

  it('PK 都存在 → 跳过，不产出 UPDATE', () => {
    const source: Row[] = [{ id: 1, name: 'new' }]
    const target: Row[] = [{ id: 1, name: 'old' }]
    expect(diffData(source, target, pk, 'incremental')).toHaveLength(0)
  })
})

describe('diffData - fullReplace', () => {
  const pk = ['id']
  it('全量 insert + 目标多余 delete', () => {
    const source: Row[] = [
      { id: 1, n: 'a' },
      { id: 2, n: 'b' },
    ]
    const target: Row[] = [
      { id: 2, n: 'b' },
      { id: 9, n: 'x' },
    ]
    const items = diffData(source, target, pk, 'fullReplace')
    const inserts = items.filter((i) => i.kind === 'insert')
    const deletes = items.filter((i) => i.kind === 'delete')
    expect(inserts).toHaveLength(2) // 全量 insert
    expect(deletes).toHaveLength(1) // 目标多余 id=9
    expect(deletes[0]?.pk).toEqual([9])
  })
})

describe('diffData - insertOnly', () => {
  const pk = ['id']
  it('仅 insert，不删除目标多余', () => {
    const source: Row[] = [{ id: 1, n: 'a' }]
    const target: Row[] = [
      { id: 1, n: 'a' },
      { id: 2, n: 'b' },
      { id: 3, n: 'c' },
    ]
    const items = diffData(source, target, pk, 'insertOnly')
    expect(items.filter((i) => i.kind === 'insert')).toHaveLength(0) // id=1 已存在
    expect(items.filter((i) => i.kind === 'delete')).toHaveLength(0) // 不删
  })

  it('源有新 PK → insert', () => {
    const source: Row[] = [{ id: 5, n: 'e' }]
    const target: Row[] = [{ id: 1, n: 'a' }]
    const items = diffData(source, target, pk, 'insertOnly')
    expect(items.filter((i) => i.kind === 'insert')).toHaveLength(1)
  })
})

describe('diffData - 跨库 PK 归一', () => {
  it('数字 1 与字符串 "1" 视为同一 PK', () => {
    const source: Row[] = [{ id: 1, n: 'a' }] // MySQL bigint 返回数字
    const target: Row[] = [{ id: '1', n: 'a' }] // SQLite TEXT 存储
    // incremental: 视为相同 → 跳过
    expect(diffData(source, target, ['id'], 'incremental')).toHaveLength(0)
  })
})

describe('diffData - 多列主键', () => {
  const pk = ['a', 'b']
  it('复合 PK 元组比对', () => {
    const source: Row[] = [
      { a: 1, b: 1, v: 'x' },
      { a: 1, b: 2, v: 'y' },
    ]
    const target: Row[] = [
      { a: 1, b: 1, v: 'old' },
      { a: 2, b: 1, v: 'z' },
    ]
    const items = diffData(source, target, pk, 'incremental')
    // (1,2) 源有目标无 → insert; (2,1) 目标有源无 → delete; (1,1) 都有 → 跳过
    expect(items.filter((i) => i.kind === 'insert')).toHaveLength(1)
    expect(items.filter((i) => i.kind === 'delete')).toHaveLength(1)
  })
})

describe('estimateDataOps', () => {
  it('incremental: 源独有 insert, 目标独有 delete', () => {
    expect(estimateDataOps(100, 80, 70, 'incremental')).toEqual({ inserts: 30, deletes: 10 })
  })
  it('fullReplace: 全量 insert, 目标独有 delete', () => {
    expect(estimateDataOps(100, 80, 70, 'fullReplace')).toEqual({ inserts: 100, deletes: 10 })
  })
  it('insertOnly: 仅源独有 insert, 不 delete', () => {
    expect(estimateDataOps(100, 80, 70, 'insertOnly')).toEqual({ inserts: 30, deletes: 0 })
  })
})
