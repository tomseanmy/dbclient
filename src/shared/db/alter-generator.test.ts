/**
 * alter-generator 单元测试
 *
 * 覆盖：diff + 三种方言（MySQL/PostgreSQL/SQLite）的 ALTER 语句生成。
 * 重点验证正确性与边界（改名、改类型、SQLite 限制等）。
 */
import { describe, it, expect } from 'vitest'
import {
  buildAlterStatements,
  diffTableMeta,
  toDraftMeta,
  genDraftId,
  type TableDialect,
} from './alter-generator'
import type { TableMeta } from '../types/database'

// ===== 测试夹具 =====

function baseColumn(name: string, dataType = 'varchar', length = 255) {
  return {
    name,
    dataType,
    unifiedType: 'string' as const,
    length,
    nullable: true,
    isPrimaryKey: false,
    defaultValue: null as string | null,
    comment: undefined as string | undefined,
  }
}

function tableMeta(overrides: Partial<TableMeta> = {}): TableMeta {
  return {
    name: 'users',
    type: 'table',
    columns: [
      { ...baseColumn('id', 'bigint', undefined), nullable: false, isPrimaryKey: true },
      { ...baseColumn('name', 'varchar', 255) },
      { ...baseColumn('email', 'varchar', 255) },
    ],
    indexes: [{ name: 'idx_email', columns: ['email'], isUnique: false }],
    foreignKeys: [],
    ...overrides,
  }
}

// ===== diff 测试 =====

describe('diffTableMeta', () => {
  it('无变更时返回空 diff', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    const diff = diffTableMeta(meta, draft)
    expect(diff.columns.added).toHaveLength(0)
    expect(diff.columns.removed).toHaveLength(0)
    expect(diff.columns.changed).toHaveLength(0)
  })

  it('检测新增列', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns.push({ ...baseColumn('phone', 'varchar', 20), _id: 'phone' })
    const diff = diffTableMeta(meta, draft)
    expect(diff.columns.added).toHaveLength(1)
    expect(diff.columns.added[0]!.name).toBe('phone')
  })

  it('检测删除列（_removed 标记）', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[2]!._removed = true // 删 email
    const diff = diffTableMeta(meta, draft)
    expect(diff.columns.removed).toHaveLength(1)
    expect(diff.columns.removed[0]!.name).toBe('email')
  })

  it('检测改类型', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.dataType = 'text'
    draft.columns[1]!.length = undefined
    const diff = diffTableMeta(meta, draft)
    expect(diff.columns.changed).toHaveLength(1)
    expect(diff.columns.changed[0]!.field).toBe('dataType')
  })

  it('检测改可空', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.nullable = false
    const diff = diffTableMeta(meta, draft)
    expect(diff.columns.changed).toHaveLength(1)
    expect(diff.columns.changed[0]!.field).toBe('nullable')
  })

  it('检测改名（仍视为 changed，生成器内部翻译为 RENAME）', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.name = 'full_name'
    const diff = diffTableMeta(meta, draft)
    expect(diff.columns.changed).toHaveLength(1)
    // _id 仍是原列名 'name'，用于对齐
    expect(diff.columns.changed[0]!.draft._id).toBe('name')
  })

  it('检测索引属性变化', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.indexes[0]!.isUnique = true
    const diff = diffTableMeta(meta, draft)
    expect(diff.indexes.changed).toHaveLength(1)
  })
})

// ===== MySQL 生成测试 =====

describe('buildAlterStatements (mysql)', () => {
  const dialect: TableDialect = 'mysql'

  it('新增列生成 ADD COLUMN', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns.push({
      ...baseColumn('phone', 'varchar', 20),
      _id: 'phone',
      nullable: false,
    })
    const { statements, unsupported } = buildAlterStatements(dialect, meta, draft)
    expect(unsupported).toHaveLength(0)
    expect(statements).toContainEqual('ALTER TABLE `users` ADD COLUMN `phone` VARCHAR(20) NOT NULL')
  })

  it('删除列生成 DROP COLUMN', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[2]!._removed = true
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('ALTER TABLE `users` DROP COLUMN `email`')
  })

  it('改名用 CHANGE COLUMN（带完整定义）', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.name = 'full_name'
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements.some((s) => s.includes('CHANGE COLUMN `name` `full_name`'))).toBe(true)
  })

  it('改类型用 MODIFY COLUMN', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.dataType = 'text'
    draft.columns[1]!.length = undefined
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements.some((s) => s.startsWith('ALTER TABLE `users` MODIFY COLUMN'))).toBe(true)
    expect(statements.some((s) => s.includes('TEXT'))).toBe(true)
  })

  it('注释内联在 MODIFY 中', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.comment = '用户姓名'
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements.some((s) => s.includes("COMMENT '用户姓名'"))).toBe(true)
  })

  it('默认值表达式不加引号', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.defaultValue = 'CURRENT_TIMESTAMP'
    draft.columns[1]!.dataType = 'timestamp'
    draft.columns[1]!.length = undefined
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements.some((s) => s.includes('DEFAULT CURRENT_TIMESTAMP'))).toBe(true)
  })

  it('删索引用 DROP INDEX ... ON', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.indexes[0]!._removed = true
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('DROP INDEX `idx_email` ON `users`')
  })

  it('新增唯一索引', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.indexes.push({
      name: 'uniq_name',
      columns: ['name'],
      isUnique: true,
      _id: 'uniq_name',
    })
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('CREATE UNIQUE INDEX `uniq_name` ON `users` (`name`)')
  })

  it('新增外键', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.foreignKeys.push({
      name: 'fk_dept',
      columns: ['dept_id'],
      referencesTable: 'departments',
      referencesColumns: ['id'],
      onDelete: 'CASCADE',
      _id: 'fk_dept',
    })
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(
      statements.some((s) =>
        s.includes(
          'ADD CONSTRAINT `fk_dept` FOREIGN KEY (`dept_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE',
        ),
      ),
    ).toBe(true)
  })

  it('标识符转义防注入', () => {
    const meta = { ...tableMeta(), name: 'my`table' }
    const draft = { ...toDraftMeta(meta), name: 'my`table' }
    // 改一列验证转义（反引号被转义为 ``）
    draft.columns[0]!.comment = 'x'
    const r = buildAlterStatements(dialect, meta, draft)
    expect(r.statements.some((s) => s.includes('``'))).toBe(true)
  })
})

// ===== PostgreSQL 生成测试 =====

describe('buildAlterStatements (postgres)', () => {
  const dialect: TableDialect = 'postgres'

  it('改类型用 ALTER COLUMN TYPE', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.dataType = 'text'
    draft.columns[1]!.length = undefined
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('ALTER TABLE "users" ALTER COLUMN "name" TYPE TEXT')
  })

  it('可空变化分别用 SET/DROP NOT NULL', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.nullable = false
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL')
  })

  it('默认值变化用 SET/DROP DEFAULT', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.defaultValue = "'active'"
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements.some((s) => s.includes('SET DEFAULT'))).toBe(true)
  })

  it('改名用 RENAME COLUMN', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.name = 'full_name'
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('ALTER TABLE "users" RENAME COLUMN "name" TO "full_name"')
  })

  it('注释用 COMMENT ON COLUMN', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.comment = '姓名'
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('COMMENT ON COLUMN "users"."name" IS \'姓名\'')
  })

  it('删外键用 DROP CONSTRAINT', () => {
    const meta = tableMeta({
      foreignKeys: [
        {
          name: 'fk_dept',
          columns: ['dept_id'],
          referencesTable: 'departments',
          referencesColumns: ['id'],
        },
      ],
    })
    const draft = toDraftMeta(meta)
    draft.foreignKeys[0]!._removed = true
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('ALTER TABLE "users" DROP CONSTRAINT "fk_dept"')
  })

  it('schema 前缀正确应用', () => {
    const meta = { ...tableMeta(), schema: 'public' }
    const draft = { ...toDraftMeta(meta), schema: 'public' }
    draft.columns.push({ ...baseColumn('x'), _id: 'x' })
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements.some((s) => s.includes('"public"."users"'))).toBe(true)
  })
})

// ===== SQLite 生成测试 =====

describe('buildAlterStatements (sqlite)', () => {
  const dialect: TableDialect = 'sqlite'

  it('支持 ADD COLUMN', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns.push({ ...baseColumn('phone', 'varchar', 20), _id: 'phone' })
    const { statements, unsupported } = buildAlterStatements(dialect, meta, draft)
    expect(unsupported).toHaveLength(0)
    expect(statements).toContainEqual('ALTER TABLE "users" ADD COLUMN "phone" VARCHAR(20)')
  })

  it('支持 RENAME COLUMN', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.name = 'full_name'
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('ALTER TABLE "users" RENAME COLUMN "name" TO "full_name"')
  })

  it('支持 DROP COLUMN', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[2]!._removed = true
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements).toContainEqual('ALTER TABLE "users" DROP COLUMN "email"')
  })

  it('改类型产生 unsupported 提示', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.dataType = 'text'
    draft.columns[1]!.length = undefined
    const { unsupported } = buildAlterStatements(dialect, meta, draft)
    expect(unsupported.length).toBeGreaterThan(0)
    expect(unsupported[0]!.reason).toContain('SQLite')
  })

  it('改注释产生 unsupported 提示', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.columns[1]!.comment = '姓名'
    const { unsupported } = buildAlterStatements(dialect, meta, draft)
    expect(unsupported.some((u) => u.reason.includes('注释'))).toBe(true)
  })

  it('删/加外键产生注释提示（无法直接执行）', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    draft.foreignKeys.push({
      name: 'fk_dept',
      columns: ['dept_id'],
      referencesTable: 'departments',
      referencesColumns: ['id'],
      _id: 'fk_dept',
    })
    const { statements } = buildAlterStatements(dialect, meta, draft)
    expect(statements.some((s) => s.startsWith('--'))).toBe(true)
  })
})

// ===== 辅助函数测试 =====

describe('toDraftMeta / genDraftId', () => {
  it('toDraftMeta 用列名作 _id', () => {
    const meta = tableMeta()
    const draft = toDraftMeta(meta)
    expect(draft.columns.map((c) => c._id)).toEqual(['id', 'name', 'email'])
  })

  it('genDraftId 生成唯一前缀 id', () => {
    const a = genDraftId('col')
    const b = genDraftId('col')
    expect(a).not.toBe(b)
    expect(a.startsWith('col_')).toBe(true)
  })
})
