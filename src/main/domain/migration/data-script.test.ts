/**
 * data-script 单测
 *
 * 覆盖：
 * - 多值 INSERT（MySQL/PG/SQLite）
 * - 分批：超过 batchSize 拆多条 INSERT
 * - DELETE 逐 PK（含 NULL PK 用 IS NULL）
 * - fullReplace 头部清空（MySQL/PG TRUNCATE；SQLite DELETE FROM）
 * - JSON 值转字符串字面量
 * - 布尔/二进制跨库值差异
 */
import { describe, it, expect } from 'vitest'
import { generateDataScript } from './data-script'
import type { Column, TableMeta } from '@shared/types/database'
import type { DataDiffItem, MigrationDialect } from '@shared/types/migration'

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
  return { name: 'users', type: 'table', columns, indexes: [], foreignKeys: [], ...overrides }
}

function ctx(
  dialect: MigrationDialect,
  strategy: DataDiffItem extends never ? never : 'incremental' | 'fullReplace' | 'insertOnly',
  extra: Record<string, unknown> = {},
) {
  return { dialect, strategy, ...extra } as never
}

describe('generateDataScript - INSERT', () => {
  const m = meta([
    col({
      name: 'id',
      dataType: 'bigint',
      unifiedType: 'integer',
      length: undefined,
      isPrimaryKey: true,
      nullable: false,
    }),
    col({ name: 'name', dataType: 'varchar', unifiedType: 'string' }),
  ])
  const inserts: DataDiffItem[] = [
    { kind: 'insert', pk: [1], row: { id: 1, name: 'alice' } },
    { kind: 'insert', pk: [2], row: { id: 2, name: 'bob' } },
  ]

  it('MySQL 多值 INSERT', () => {
    const stmts = generateDataScript(ctx('mysql', 'incremental', { targetMeta: m }), inserts)
    const insertStmt = stmts.find((s) => s.sql.includes('INSERT INTO'))
    expect(insertStmt).toBeTruthy()
    expect(insertStmt!.sql).toContain('`users`')
    expect(insertStmt!.sql).toContain("'alice'")
    expect(insertStmt!.sql).toContain("'bob'")
    expect(insertStmt!.sql).toContain('VALUES')
  })

  it('PG 双引号标识符', () => {
    const stmts = generateDataScript(ctx('postgres', 'incremental', { targetMeta: m }), inserts)
    expect(stmts.some((s) => s.sql.includes('"users"'))).toBe(true)
  })

  it('分批：batchSize=1 时每行一条 INSERT', () => {
    const stmts = generateDataScript(
      ctx('mysql', 'incremental', { targetMeta: m, batchSize: 1 }),
      inserts,
    )
    const insertCount = stmts.filter((s) => s.sql.includes('INSERT INTO')).length
    expect(insertCount).toBe(2)
  })
})

describe('generateDataScript - DELETE', () => {
  const m = meta([
    col({
      name: 'id',
      dataType: 'bigint',
      unifiedType: 'integer',
      length: undefined,
      isPrimaryKey: true,
      nullable: false,
    }),
  ])

  it('逐 PK DELETE', () => {
    const deletes: DataDiffItem[] = [{ kind: 'delete', pk: [5] }]
    const stmts = generateDataScript(ctx('mysql', 'incremental', { targetMeta: m }), deletes)
    const del = stmts.find((s) => s.sql.includes('DELETE FROM'))
    expect(del).toBeTruthy()
    expect(del!.sql).toContain('`id` = 5')
    expect(del!.riskLevel).toBe('danger')
  })

  it('NULL PK 用 IS NULL', () => {
    const deletes: DataDiffItem[] = [{ kind: 'delete', pk: [null] }]
    const stmts = generateDataScript(ctx('postgres', 'incremental', { targetMeta: m }), deletes)
    expect(stmts.some((s) => s.sql.includes('"id" IS NULL'))).toBe(true)
  })
})

describe('generateDataScript - fullReplace 清空', () => {
  const m = meta([
    col({
      name: 'id',
      dataType: 'bigint',
      unifiedType: 'integer',
      length: undefined,
      isPrimaryKey: true,
      nullable: false,
    }),
  ])

  it('MySQL/PG 头部 TRUNCATE', () => {
    for (const d of ['mysql', 'postgres'] as const) {
      const stmts = generateDataScript(ctx(d, 'fullReplace', { targetMeta: m }), [])
      expect(stmts.some((s) => s.sql.includes('TRUNCATE'))).toBe(true)
    }
  })

  it('SQLite 头部 DELETE FROM（事务安全）', () => {
    const stmts = generateDataScript(ctx('sqlite', 'fullReplace', { targetMeta: m }), [])
    expect(stmts.some((s) => s.sql.includes('DELETE FROM') && !s.sql.includes('WHERE'))).toBe(true)
  })

  it('incremental 不产生清空语句', () => {
    const stmts = generateDataScript(ctx('mysql', 'incremental', { targetMeta: m }), [])
    expect(stmts.filter((s) => s.sql.includes('TRUNCATE'))).toHaveLength(0)
  })
})

describe('generateDataScript - 跨库值转换', () => {
  it('JSON 对象转字符串字面量', () => {
    const m = meta([
      col({
        name: 'id',
        dataType: 'bigint',
        unifiedType: 'integer',
        length: undefined,
        isPrimaryKey: true,
        nullable: false,
      }),
      col({ name: 'data', dataType: 'json', unifiedType: 'json', length: undefined }),
    ])
    const inserts: DataDiffItem[] = [{ kind: 'insert', pk: [1], row: { id: 1, data: { k: 'v' } } }]
    const stmts = generateDataScript(ctx('mysql', 'incremental', { targetMeta: m }), inserts)
    expect(stmts.some((s) => s.sql.includes('{"k":"v"}'))).toBe(true)
  })

  it('布尔值：MySQL 0/1，PG TRUE/FALSE', () => {
    const m = meta([
      col({
        name: 'id',
        dataType: 'bigint',
        unifiedType: 'integer',
        length: undefined,
        isPrimaryKey: true,
        nullable: false,
      }),
      col({ name: 'flag', dataType: 'tinyint', unifiedType: 'boolean', length: undefined }),
    ])
    const inserts: DataDiffItem[] = [{ kind: 'insert', pk: [1], row: { id: 1, flag: true } }]
    const mysqlStmt = generateDataScript(ctx('mysql', 'incremental', { targetMeta: m }), inserts)
    expect(mysqlStmt.some((s) => /1\)/.test(s.sql))).toBe(true)
    const pgStmt = generateDataScript(ctx('postgres', 'incremental', { targetMeta: m }), inserts)
    expect(pgStmt.some((s) => s.sql.includes('TRUE'))).toBe(true)
  })
})
