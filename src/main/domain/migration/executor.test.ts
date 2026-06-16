/**
 * executor 单元测试
 *
 * 覆盖（D2 事务安全）：
 * - validateTransactionStrategy：DML+none 拒绝；纯 DDL+none 放行
 * - single 全成功 COMMIT
 * - single 中途失败 ROLLBACK（applied=0）
 * - perStatement 部分成功（applied 计数 + failedItems）
 * - none 逐条无事务
 * - selectedIndexes 过滤
 */
import { describe, it, expect, vi } from 'vitest'
import { validateTransactionStrategy, executeStatements, executeMigration } from './executor'
import type { GeneratedStatement, MigrationPlan } from '@shared/types/migration'

function stmt(sql: string, kind: 'ddl' | 'dml' = 'ddl'): GeneratedStatement {
  return { sql, kind, riskLevel: 'safe' }
}

function plan(opts: {
  useTransaction: 'none' | 'single' | 'perStatement'
  hasData?: boolean
}): MigrationPlan {
  return {
    source: { connectionId: 's', table: 't' },
    target: { connectionId: 't', table: 't' },
    dialect: 'mysql',
    structureItems: [
      {
        kind: 'addColumn',
        column: {
          name: 'a',
          dataType: 'int',
          unifiedType: 'integer',
          nullable: true,
          isPrimaryKey: false,
        },
      },
    ],
    dataItems: opts.hasData ? [{ kind: 'insert', pk: [1], row: { id: 1 } }] : undefined,
    options: { useTransaction: opts.useTransaction, strategy: 'incremental' },
  }
}

describe('validateTransactionStrategy - D2 守卫', () => {
  it('含 DML + none → 拒绝', () => {
    expect(() =>
      validateTransactionStrategy(plan({ useTransaction: 'none', hasData: true }), [
        stmt('INSERT'),
      ]),
    ).toThrow(/强制事务/)
  })

  it('纯 DDL + none → 放行', () => {
    expect(() =>
      validateTransactionStrategy(plan({ useTransaction: 'none', hasData: false }), [
        stmt('ALTER'),
      ]),
    ).not.toThrow()
  })

  it('DML + single → 放行', () => {
    expect(() =>
      validateTransactionStrategy(plan({ useTransaction: 'single', hasData: true }), [
        stmt('INSERT', 'dml'),
      ]),
    ).not.toThrow()
  })
})

describe('executeStatements - single 事务', () => {
  it('全成功 → COMMIT，applied=全部', async () => {
    const exec = vi.fn().mockResolvedValue(undefined)
    const tx = vi.fn().mockResolvedValue(undefined)
    const result = await executeStatements([stmt('A'), stmt('B'), stmt('C')], 'single', exec, tx)
    expect(result.success).toBe(true)
    expect(result.applied).toBe(3)
    expect(result.failed).toBe(0)
    expect(tx).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(tx).toHaveBeenLastCalledWith('COMMIT')
  })

  it('中途失败 → ROLLBACK，applied=0', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('syntax error'))
    const tx = vi.fn().mockResolvedValue(undefined)
    const result = await executeStatements([stmt('A'), stmt('B'), stmt('C')], 'single', exec, tx)
    expect(result.success).toBe(false)
    expect(result.applied).toBe(0) // 回滚后不计成功
    expect(result.failed).toBe(3)
    expect(tx).toHaveBeenLastCalledWith('ROLLBACK')
    expect(result.failedItems?.[0]?.error).toBe('syntax error')
  })
})

describe('executeStatements - perStatement', () => {
  it('第二条失败 → 中止，第一条已提交', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('dup key'))
    const tx = vi.fn().mockResolvedValue(undefined)
    const result = await executeStatements(
      [stmt('A'), stmt('B'), stmt('C')],
      'perStatement',
      exec,
      tx,
    )
    expect(result.success).toBe(false)
    expect(result.applied).toBe(1) // 第一条已 COMMIT
    expect(result.failed).toBe(1)
    expect(result.failedItems?.[0]?.index).toBe(1)
  })

  it('全成功', async () => {
    const exec = vi.fn().mockResolvedValue(undefined)
    const tx = vi.fn().mockResolvedValue(undefined)
    const result = await executeStatements([stmt('A'), stmt('B')], 'perStatement', exec, tx)
    expect(result.success).toBe(true)
    expect(result.applied).toBe(2)
  })
})

describe('executeStatements - none', () => {
  it('逐条执行，无事务控制', async () => {
    const exec = vi.fn().mockResolvedValue(undefined)
    const tx = vi.fn().mockResolvedValue(undefined)
    const result = await executeStatements([stmt('A'), stmt('B')], 'none', exec, tx)
    expect(result.success).toBe(true)
    expect(result.applied).toBe(2)
    expect(tx).not.toHaveBeenCalled() // none 不发 BEGIN/COMMIT
  })

  it('失败中止', async () => {
    const exec = vi.fn().mockRejectedValueOnce(new Error('fail'))
    const result = await executeStatements([stmt('A'), stmt('B')], 'none', exec, vi.fn())
    expect(result.success).toBe(false)
    expect(result.applied).toBe(0)
  })
})

describe('executeMigration - selectedIndexes 过滤', () => {
  it('只执行勾选的语句', async () => {
    const all = [stmt('A'), stmt('B'), stmt('C')]
    const exec = vi.fn().mockResolvedValue(undefined)
    const tx = vi.fn().mockResolvedValue(undefined)
    const result = await executeMigration(plan({ useTransaction: 'single' }), all, [0, 2], exec, tx)
    expect(result.applied).toBe(2)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec).toHaveBeenCalledWith('A')
    expect(exec).toHaveBeenCalledWith('C')
    expect(exec).not.toHaveBeenCalledWith('B')
  })

  it('DML + none 被 executeMigration 拒绝', async () => {
    await expect(
      executeMigration(
        plan({ useTransaction: 'none', hasData: true }),
        [stmt('INSERT', 'dml')],
        [0],
        vi.fn(),
        vi.fn(),
      ),
    ).rejects.toThrow(/强制事务/)
  })
})
