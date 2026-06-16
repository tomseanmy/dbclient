/**
 * structure-script 单测
 *
 * 覆盖：
 * - 各 diff kind → 目标方言 SQL
 * - 风险分级（drop=danger, modify/createTable=caution, add=safe）
 * - 语句排序（drop FK → drop index → drop col → createTable → add col → modify col → add idx → add FK）
 * - 三方言输出正确性
 *
 * 注：项目启用 noUncheckedIndexedAccess，避免数组下标直接访问，用 find/toContain。
 */
import { describe, it, expect } from 'vitest'
import { generateStructureScript } from './structure-script'
import type { Column, TableMeta } from '@shared/types/database'
import type { StructureDiffItem } from '@shared/types/migration'

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

function onlySql(
  items: StructureDiffItem[],
  dialect: 'mysql' | 'postgres' | 'sqlite',
  table: string,
): string[] {
  return generateStructureScript(items, dialect, table).map((s) => s.sql)
}
function onlyRisk(
  items: StructureDiffItem[],
  dialect: 'mysql' | 'postgres' | 'sqlite',
  table: string,
): string[] {
  return generateStructureScript(items, dialect, table).map((s) => s.riskLevel)
}

describe('generateStructureScript - 各 kind 的方言输出', () => {
  it('createTable', () => {
    const meta: TableMeta = {
      name: 'users',
      type: 'table',
      columns: [
        col({
          name: 'id',
          dataType: 'bigint',
          unifiedType: 'integer',
          length: undefined,
          isPrimaryKey: true,
          nullable: false,
        }),
      ],
      indexes: [],
      foreignKeys: [],
    }
    const stmts = generateStructureScript(
      [{ kind: 'createTable', tableMeta: meta }],
      'mysql',
      'users',
    )
    expect(stmts).toHaveLength(1)
    const first = stmts[0]!
    expect(first.sql).toContain('CREATE TABLE `users`')
    expect(first.kind).toBe('ddl')
    expect(first.riskLevel).toBe('caution')
  })

  it('addColumn - MySQL', () => {
    const sql = onlySql(
      [
        {
          kind: 'addColumn',
          column: col({ name: 'age', dataType: 'int', unifiedType: 'integer', length: undefined }),
        },
      ],
      'mysql',
      'users',
    )
    expect(sql.some((s) => /ALTER TABLE `users` ADD COLUMN/.test(s))).toBe(true)
    expect(
      onlyRisk([{ kind: 'addColumn', column: col({ name: 'age' }) }], 'mysql', 'users')[0],
    ).toBe('safe')
  })

  it('addColumn - PG 双引号', () => {
    const sql = onlySql(
      [
        {
          kind: 'addColumn',
          column: col({ name: 'age', dataType: 'int', unifiedType: 'integer', length: undefined }),
        },
      ],
      'postgres',
      'users',
    )
    expect(sql.some((s) => /ALTER TABLE "users"/.test(s))).toBe(true)
  })

  it('modifyColumn - MySQL MODIFY + caution', () => {
    const stmts = generateStructureScript(
      [
        {
          kind: 'modifyColumn',
          column: col({ name: 'email', length: 500 }),
          changes: { length: 500 },
        },
      ],
      'mysql',
      'users',
    )
    expect(stmts.some((s) => s.sql.includes('MODIFY COLUMN'))).toBe(true)
    expect(stmts.some((s) => s.riskLevel === 'caution')).toBe(true)
  })

  it('dropColumn - danger', () => {
    const stmts = generateStructureScript(
      [{ kind: 'dropColumn', columnName: 'legacy' }],
      'postgres',
      'users',
    )
    expect(
      stmts.some((s) => s.sql.includes('DROP COLUMN "legacy"') && s.riskLevel === 'danger'),
    ).toBe(true)
  })

  it('addIndex', () => {
    const stmts = generateStructureScript(
      [{ kind: 'addIndex', index: { name: 'idx_email', columns: ['email'], isUnique: true } }],
      'mysql',
      'users',
    )
    expect(stmts.some((s) => s.sql.includes('CREATE UNIQUE INDEX') && s.riskLevel === 'safe')).toBe(
      true,
    )
  })

  it('dropIndex - danger', () => {
    const stmts = generateStructureScript(
      [{ kind: 'dropIndex', indexName: 'idx_old' }],
      'mysql',
      'users',
    )
    expect(stmts.some((s) => s.sql.includes('DROP INDEX') && s.riskLevel === 'danger')).toBe(true)
  })

  it('addForeignKey', () => {
    const stmts = generateStructureScript(
      [
        {
          kind: 'addForeignKey',
          fk: {
            name: 'fk_u',
            columns: ['uid'],
            referencesTable: 'users',
            referencesColumns: ['id'],
          },
        },
      ],
      'postgres',
      'users',
    )
    expect(stmts.some((s) => s.sql.includes('FOREIGN KEY') && s.sql.includes('"users"'))).toBe(true)
  })

  it('dropForeignKey - danger', () => {
    const stmts = generateStructureScript(
      [{ kind: 'dropForeignKey', fkName: 'fk_u' }],
      'mysql',
      'users',
    )
    expect(stmts.some((s) => s.sql.includes('DROP FOREIGN KEY') && s.riskLevel === 'danger')).toBe(
      true,
    )
  })
})

describe('generateStructureScript - 语句排序', () => {
  it('按依赖安全顺序：drop FK → drop idx → drop col → add col → modify col → add idx → add FK', () => {
    const items: StructureDiffItem[] = [
      {
        kind: 'addForeignKey',
        fk: { name: 'fk1', columns: ['a'], referencesTable: 't2', referencesColumns: ['id'] },
      },
      { kind: 'dropForeignKey', fkName: 'fk0' },
      { kind: 'addColumn', column: col({ name: 'new' }) },
      { kind: 'modifyColumn', column: col({ name: 'mid' }), changes: { nullable: false } },
      { kind: 'addIndex', index: { name: 'i1', columns: ['a'], isUnique: false } },
      { kind: 'dropColumn', columnName: 'old' },
      { kind: 'dropIndex', indexName: 'i0' },
    ]
    const stmts = generateStructureScript(items, 'mysql', 'users')
    const kinds = stmts.map((s) => {
      const sql = s.sql
      if (sql.includes('DROP FOREIGN KEY')) return 'dropFK'
      if (/DROP INDEX/i.test(sql) && !sql.includes('FOREIGN')) return 'dropIdx'
      if (sql.includes('DROP COLUMN')) return 'dropCol'
      if (sql.includes('ADD COLUMN')) return 'addCol'
      if (sql.includes('MODIFY')) return 'modCol'
      if (sql.includes('CREATE') && sql.includes('INDEX')) return 'addIdx'
      if (sql.includes('FOREIGN KEY')) return 'addFK'
      return '?'
    })
    expect(kinds.indexOf('dropFK')).toBeLessThan(kinds.indexOf('dropCol'))
    expect(kinds.indexOf('dropCol')).toBeLessThan(kinds.indexOf('addCol'))
    expect(kinds.indexOf('addCol')).toBeLessThan(kinds.indexOf('modCol'))
    expect(kinds.indexOf('modCol')).toBeLessThan(kinds.indexOf('addIdx'))
    expect(kinds.indexOf('addIdx')).toBeLessThan(kinds.indexOf('addFK'))
  })
})

describe('generateStructureScript - 三方言一致性', () => {
  it('dropColumn 三方言都含 DROP COLUMN', () => {
    for (const d of ['mysql', 'postgres', 'sqlite'] as const) {
      const sql = onlySql([{ kind: 'dropColumn', columnName: 'x' }], d, 't')
      expect(sql.every((s) => s.includes('DROP COLUMN'))).toBe(true)
    }
  })
})
