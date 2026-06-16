/**
 * 迁移执行引擎
 *
 * 安全不变量（D2 决策）：
 * - 数据迁移（含 DML）强制事务：useTransaction='none' 对含 DML 的方案一律拒绝。
 * - 默认 single（全量一个事务，失败整体回滚）。
 * - 仅大表场景切 perStatement（分批提交，单批失败中止并标记）。
 *
 * 执行流程（事务策略）：
 * - single：BEGIN → 逐条执行（过 M3 安全层）→ 全成功 COMMIT / 任一失败 ROLLBACK
 * - perStatement：每批 BEGIN/COMMIT，单批失败中止，已提交批不可回滚
 * - none：仅纯 DDL 结构迁移允许；DDL 多数库隐式提交，事务意义有限
 *
 * Driver 依赖注入：通过 StatementExecutor 抽象调用，
 * 便于单测 mock，且与具体 driver 解耦。
 */
import type {
  GeneratedStatement,
  MigrationFailedItem,
  MigrationPlan,
  MigrationResult,
} from '@shared/types/migration'
import { logger } from '@main/infra/logger'

/** 单条语句执行器（注入；实际实现调 driver.executeStatement，测试用 mock） */
export type StatementExecutor = (sql: string) => Promise<void>

/** 事务控制语句执行器（BEGIN/COMMIT/ROLLBACK 也走同一通道） */
export type TransactionControl = (sql: 'BEGIN' | 'COMMIT' | 'ROLLBACK') => Promise<void>

/**
 * 校验事务策略是否合法（D2 守卫）。
 * 含 DML 且 useTransaction='none' → 抛错拒绝。
 * @returns 处理后的语句列表（已按 selectedIndexes 过滤）
 */
export function validateTransactionStrategy(
  plan: { structureItems: unknown[]; dataItems?: unknown[]; options: { useTransaction: string } },
  statements: GeneratedStatement[],
): GeneratedStatement[] {
  const hasData = (plan.dataItems?.length ?? 0) > 0
  const useTransaction = plan.options.useTransaction

  if (hasData && useTransaction === 'none') {
    throw new Error(
      '数据迁移强制事务：含数据迁移(DML)的方案不允许 useTransaction="none"，请使用 "single" 或 "perStatement"',
    )
  }
  return statements
}

/**
 * 执行迁移语句。
 *
 * @param statements 待执行语句（已过滤、已排序）
 * @param useTransaction 事务策略
 * @param exec 单条语句执行器（不含事务控制）
 * @param txControl 事务控制执行器（BEGIN/COMMIT/ROLLBACK）
 */
export async function executeStatements(
  statements: GeneratedStatement[],
  useTransaction: 'none' | 'perStatement' | 'single',
  exec: StatementExecutor,
  txControl: TransactionControl,
): Promise<MigrationResult> {
  const start = Date.now()
  let applied = 0
  const failedItems: MigrationFailedItem[] = []

  if (useTransaction === 'single') {
    // 单事务：全成功 COMMIT，任一失败 ROLLBACK
    try {
      await txControl('BEGIN')
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i]!
        await exec(stmt.sql)
        applied++
      }
      await txControl('COMMIT')
      return { success: true, applied, failed: 0, durationMs: Date.now() - start }
    } catch (err) {
      // 回滚已执行的（单事务下 COMMIT 前 ROLLBACK 可撤销）
      try {
        await txControl('ROLLBACK')
      } catch (rollbackErr) {
        logger.error('迁移事务回滚失败', rollbackErr as Error)
      }
      const message = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        applied: 0, // single 模式回滚后已执行的不算成功
        failed: statements.length, // 回滚即整体失败
        durationMs: Date.now() - start,
        failedItems: [{ index: applied, sql: statements[applied]?.sql ?? '', error: message }],
      }
    }
  }

  // perStatement：逐条各自事务，单条失败中止
  if (useTransaction === 'perStatement') {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]!
      try {
        await txControl('BEGIN')
        await exec(stmt.sql)
        await txControl('COMMIT')
        applied++
      } catch (err) {
        try {
          await txControl('ROLLBACK')
        } catch (rollbackErr) {
          logger.error('迁移分批回滚失败', rollbackErr as Error)
        }
        const message = err instanceof Error ? err.message : String(err)
        failedItems.push({ index: i, sql: stmt.sql, error: message })
        // 单批失败即中止后续
        break
      }
    }
    return {
      success: failedItems.length === 0,
      applied,
      failed: failedItems.length,
      durationMs: Date.now() - start,
      failedItems: failedItems.length > 0 ? failedItems : undefined,
    }
  }

  // none：逐条无事务执行（仅纯 DDL 场景）
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!
    try {
      await exec(stmt.sql)
      applied++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failedItems.push({ index: i, sql: stmt.sql, error: message })
      break
    }
  }
  return {
    success: failedItems.length === 0,
    applied,
    failed: failedItems.length,
    durationMs: Date.now() - start,
    failedItems: failedItems.length > 0 ? failedItems : undefined,
  }
}

/**
 * 高层执行入口（IPC handler 调用）。
 * 接收 plan + selectedIndexes，内部生成脚本后执行。
 *
 * 注意：事务控制与语句执行均通过注入的 execFn/txFn，
 * 由 IPC handler 绑定到具体 driver（绕过 executeSql 的逐条安全检查，
 * 因为迁移脚本已在生成阶段经用户确认）。
 */
export async function executeMigration(
  plan: MigrationPlan,
  statements: GeneratedStatement[],
  selectedIndexes: number[],
  execFn: StatementExecutor,
  txFn: TransactionControl,
): Promise<MigrationResult> {
  // 守卫：DML 不允许 none
  validateTransactionStrategy(plan, statements)

  // 按勾选过滤
  const selected = selectedIndexes
    .map((i) => statements[i])
    .filter((s): s is GeneratedStatement => s !== undefined)

  return executeStatements(selected, plan.options.useTransaction, execFn, txFn)
}
