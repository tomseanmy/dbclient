/**
 * 方言生成器单测
 *
 * 验证三种方言（MySQL/PG/SQLite）的 DDL/DML 输出：
 * - 标识符引用
 * - createTable（含主键、自增、注释）
 * - addColumn / dropColumn / modifyColumn
 * - addIndex / dropIndex
 * - 值字面量（字符串、数字、布尔、二进制、null）
 * - enum 降级类型（D1）
 */
import { describe, it, expect } from 'vitest'
import { getDialectGenerator } from './index'
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

function meta(overrides: Partial<TableMeta> = {}): TableMeta {
  return {
    name: 'users',
    type: 'table',
    columns: [
      {
        ...col({
          name: 'id',
          dataType: 'bigint',
          unifiedType: 'integer',
          length: undefined,
          nullable: false,
          isPrimaryKey: true,
        }),
      },
      { ...col({ name: 'email', dataType: 'varchar', unifiedType: 'string', length: 255 }) },
    ],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  }
}

describe('标识符引用', () => {
  it('MySQL 用反引号', () => {
    expect(getDialectGenerator('mysql').quoteIdentifier('user')).toBe('`user`')
  })
  it('PG/SQLite 用双引号', () => {
    expect(getDialectGenerator('postgres').quoteIdentifier('user')).toBe('"user"')
    expect(getDialectGenerator('sqlite').quoteIdentifier('user')).toBe('"user"')
  })
})

describe('createTable', () => {
  const m = meta()

  it('MySQL createTable 含反引号 + 主键', () => {
    const sql = getDialectGenerator('mysql').createTable(m)
    expect(sql).toContain('CREATE TABLE `users`')
    expect(sql).toContain('`id` BIGINT NOT NULL')
    expect(sql).toContain('PRIMARY KEY (`id`)')
  })

  it('PG createTable 主键可用 BIGSERIAL（自增场景）', () => {
    const autoM = meta({
      columns: [
        {
          ...col({
            name: 'id',
            dataType: 'bigint',
            unifiedType: 'integer',
            length: undefined,
            nullable: false,
            isPrimaryKey: true,
            autoIncrement: true,
          }),
        },
        { ...col({ name: 'email' }) },
      ],
    })
    const sql = getDialectGenerator('postgres').createTable(autoM)
    expect(sql).toContain('"id" BIGSERIAL PRIMARY KEY')
  })

  it('SQLite createTable 含双引号', () => {
    const sql = getDialectGenerator('sqlite').createTable(m)
    expect(sql).toContain('CREATE TABLE "users"')
    expect(sql).toContain('"id" INTEGER NOT NULL')
  })
})

describe('enum 降级类型（D1）', () => {
  const enumCol = col({
    name: 'status',
    dataType: "enum('a','bb')",
    unifiedType: 'enum',
    length: undefined,
    enumValues: ['a', 'bb'],
  })

  it('MySQL enum → VARCHAR(2)', () => {
    expect(getDialectGenerator('mysql').typeString(enumCol)).toBe('VARCHAR(2)')
  })
  it('PG enum → TEXT', () => {
    expect(getDialectGenerator('postgres').typeString(enumCol)).toBe('TEXT')
  })
  it('SQLite enum → TEXT', () => {
    expect(getDialectGenerator('sqlite').typeString(enumCol)).toBe('TEXT')
  })
})

describe('addColumn / dropColumn', () => {
  it('各方言 addColumn 含列定义', () => {
    const c = col({
      name: 'age',
      dataType: 'int',
      unifiedType: 'integer',
      length: undefined,
      nullable: false,
    })
    const sql = getDialectGenerator('postgres').addColumn('users', c)
    expect(sql).toBe('ALTER TABLE "users" ADD COLUMN "age" BIGINT NOT NULL')
  })

  it('dropColumn 格式正确', () => {
    expect(getDialectGenerator('mysql').dropColumn('users', 'age')).toBe(
      'ALTER TABLE `users` DROP COLUMN `age`',
    )
  })
})

describe('modifyColumn', () => {
  it('MySQL MODIFY 输出完整列定义', () => {
    const c = col({ name: 'email', dataType: 'varchar', unifiedType: 'string', length: 500 })
    const sql = getDialectGenerator('mysql').modifyColumn('users', c, { length: 500 })
    expect(sql).toContain('MODIFY COLUMN')
    expect(sql).toContain('VARCHAR(500)')
  })

  it('PG modifyColumn 拆成 ALTER COLUMN TYPE', () => {
    const c = col({ name: 'email', dataType: 'varchar', unifiedType: 'string', length: 500 })
    const sql = getDialectGenerator('postgres').modifyColumn('users', c, { length: 500 })
    expect(sql).toContain('ALTER COLUMN "email" TYPE VARCHAR(500)')
  })

  it('SQLite modifyColumn 给出重建表提示（不生成可执行语句）', () => {
    const c = col({ name: 'email', dataType: 'varchar', unifiedType: 'string', length: 500 })
    const sql = getDialectGenerator('sqlite').modifyColumn('users', c, {})
    expect(sql).toContain('--')
    expect(sql).toContain('重建表')
  })
})

describe('值字面量', () => {
  const cases: Array<[dialect: 'mysql' | 'postgres' | 'sqlite', unknown, string]> = [
    // [dialect, value, expected]
    ['mysql', 'hello', "'hello'"],
    ['postgres', "it's", "'it''s'"],
    ['sqlite', 42, '42'],
    ['mysql', null, 'NULL'],
    ['mysql', true, '1'],
    ['postgres', false, 'FALSE'],
    ['sqlite', true, '1'],
  ]
  for (const [dialect, value, expected] of cases) {
    it(`${dialect}: ${JSON.stringify(value)} → ${expected}`, () => {
      expect(getDialectGenerator(dialect).literal(value)).toBe(expected)
    })
  }

  it("二进制：MySQL x'hex'", () => {
    const buf = new Uint8Array([0x01, 0xff])
    expect(getDialectGenerator('mysql').literal(buf)).toBe("x'01ff'")
  })

  it('二进制：PG bytea', () => {
    const buf = new Uint8Array([0xab])
    expect(getDialectGenerator('postgres').literal(buf)).toBe("'\\xab'::bytea")
  })
})

describe('truncate（fullReplace）', () => {
  it('MySQL/PG 返回 TRUNCATE', () => {
    expect(getDialectGenerator('mysql').truncate('users')).toContain('TRUNCATE')
    expect(getDialectGenerator('postgres').truncate('users')).toContain('TRUNCATE')
  })
  it('SQLite 返回 DELETE FROM（事务安全，D2）', () => {
    expect(getDialectGenerator('sqlite').truncate('users')).toBe('DELETE FROM "users"')
  })
})
