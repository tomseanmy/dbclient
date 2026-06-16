/**
 * migration:* IPC handler —— 数据库迁移
 *
 * 批次 B+C+D：结构迁移 + 数据迁移 + 执行 + 持久化方案。
 *
 * 安全：所有迁移默认只生成脚本，不自动执行；执行走执行引擎（事务守卫 + driver 执行）。
 */
import { registerHandler } from './registry'
import { logger } from '@main/infra/logger'
import { diffStructure } from '@main/domain/migration/structure-diff'
import { generateStructureScript } from '@main/domain/migration/structure-script'
import { mapColumnsForTarget } from '@main/domain/migration/type-mapper'
import {
  describeTargetTable,
  resolveTarget,
  assertMigratable,
} from '@main/domain/migration/target-loader'
import { diffData, extractPrimaryKeys } from '@main/domain/migration/data-diff'
import type { Row } from '@main/domain/migration/data-diff'
import { generateDataScript } from '@main/domain/migration/data-script'
import { fetchAllRows, fetchPkOnly } from '@main/domain/migration/row-fetcher'
import { executeMigration } from '@main/domain/migration/executor'
import { getDriver } from '@main/domain/db/manager'
import { migrationPlanDao } from '@main/infra/storage/migration-plan-dao'
import type { GeneratedStatement, TypeMappingWarning } from '@shared/types/migration'

export function registerMigrationHandlers(): void {
  // 结构 diff：对比源/目标表结构，产出差异项 + 跨库类型告警
  registerHandler('migration:diffStructure', async (_event, { source, target }) => {
    const resolvedTarget = resolveTarget(target)
    logger.info('迁移结构 diff', { source: source.table, target: target.table })

    const [sourceMeta, targetMeta] = await Promise.all([
      describeTargetTable(source),
      describeTargetTable(target),
    ])
    if (!sourceMeta) {
      throw new Error(`源表 ${source.schema ?? ''}.${source.table} 不存在，无法迁移`)
    }

    // 跨库类型映射：源端列 → 目标方言（登记告警 + 调整 dataType）
    // 用目标方言，因为源列要适配目标库的存储类型
    const { columns: mappedColumns, warnings } = mapColumnsForTarget(
      sourceMeta.columns,
      resolvedTarget.dialect,
    )
    const mappedSourceMeta = { ...sourceMeta, columns: mappedColumns }

    const items = diffStructure(mappedSourceMeta, targetMeta)
    return { items, warnings }
  })

  // 数据 diff：按 PK 比对源/目标行，产出 insert/delete 项（不做 UPDATE）
  registerHandler('migration:diffData', async (_event, { source, target, strategy }) => {
    logger.info('迁移数据 diff', { source: source.table, strategy })

    const [sourceMeta, targetMeta] = await Promise.all([
      describeTargetTable(source),
      describeTargetTable(target),
    ])
    if (!sourceMeta) {
      throw new Error(`源表 ${source.schema ?? ''}.${source.table} 不存在，无法迁移`)
    }

    const pkColumns = extractPrimaryKeys(sourceMeta)
    const sourceDriver = getDriver(source.connectionId)

    // incremental/insertOnly 仅需 PK 比对（轻量）；fullReplace 需全量行（用于 INSERT）
    const needFullRows = strategy === 'fullReplace'
    const sourceRows = needFullRows
      ? await fetchAllRows(sourceDriver, source.table, source.schema, {
          total: sourceMeta.estimatedRows,
        })
      : await fetchPkOnly(sourceDriver, source.table, source.schema, pkColumns, {
          total: sourceMeta.estimatedRows,
        })

    // 目标端：incremental 需 PK（判断 delete）；insertOnly 无需拉目标；fullReplace 仅需 PK 判断多余
    let targetRows: Row[] = []
    if (strategy !== 'insertOnly' && targetMeta) {
      const targetDriver = getDriver(target.connectionId)
      targetRows = await fetchPkOnly(targetDriver, target.table, target.schema, pkColumns, {
        total: targetMeta.estimatedRows,
      })
    }

    const items = diffData(sourceRows, targetRows, pkColumns, strategy)
    return { items, totalRows: sourceRows.length }
  })

  // 预览将受影响的行（数据迁移前供用户确认）
  registerHandler('migration:previewRows', async (_event, { source, target, strategy, limit }) => {
    const previewLimit = limit ?? 100
    const sourceMeta = await describeTargetTable(source)
    if (!sourceMeta) {
      throw new Error(`源表 ${source.schema ?? ''}.${source.table} 不存在`)
    }
    const pkColumns = extractPrimaryKeys(sourceMeta)
    const sourceDriver = getDriver(source.connectionId)
    const sourceRows = await fetchPkOnly(sourceDriver, source.table, source.schema, pkColumns, {})
    const targetMeta = await describeTargetTable(target)
    const targetRows =
      strategy !== 'insertOnly' && targetMeta
        ? await fetchPkOnly(
            getDriver(target.connectionId),
            target.table,
            target.schema,
            pkColumns,
            {},
          )
        : []
    const items = diffData(sourceRows, targetRows, pkColumns, strategy)
    // 取前 previewLimit 条 insert 项的 PK 供预览
    const preview = items.filter((i) => i.kind === 'insert').slice(0, previewLimit)
    return { rows: preview, total: items.length }
  })

  // 生成迁移脚本（结构 + 数据）
  registerHandler('migration:generateScript', async (_event, { plan }) => {
    const dialect = assertMigratable(plan.target).dialect
    const allWarnings: TypeMappingWarning[] = [...(plan.warnings ?? [])]

    // 结构脚本
    const structureStmts = generateStructureScript(plan.structureItems, dialect, plan.target.table)

    // 数据脚本（若 plan 含 dataItems）
    const dataStmts: GeneratedStatement[] = []
    if (plan.dataItems && plan.dataItems.length > 0) {
      const targetMeta = await describeTargetTable(plan.target)
      if (targetMeta) {
        dataStmts.push(
          ...generateDataScript(
            {
              targetMeta,
              dialect,
              strategy: plan.options.strategy,
              batchSize: plan.options.batchSize,
            },
            plan.dataItems,
          ),
        )
      }
    }

    return { statements: [...structureStmts, ...dataStmts], warnings: allWarnings }
  })

  // 执行迁移（事务守卫 + driver 执行）
  registerHandler('migration:execute', async (_event, { plan, selectedIndexes }) => {
    logger.info('执行迁移', { table: plan.target.table, count: selectedIndexes.length })

    // 先生成完整脚本，再按勾选执行
    const { statements } = await (async () => {
      const dialect = assertMigratable(plan.target).dialect
      const structureStmts = generateStructureScript(
        plan.structureItems,
        dialect,
        plan.target.table,
      )
      const dataStmts: GeneratedStatement[] = []
      if (plan.dataItems && plan.dataItems.length > 0) {
        const targetMeta = await describeTargetTable(plan.target)
        if (targetMeta) {
          dataStmts.push(
            ...generateDataScript(
              {
                targetMeta,
                dialect,
                strategy: plan.options.strategy,
                batchSize: plan.options.batchSize,
              },
              plan.dataItems,
            ),
          )
        }
      }
      return { statements: [...structureStmts, ...dataStmts] }
    })()

    // 在目标连接上执行；事务控制与语句执行走 driver.executeStatement
    const targetDriver = getDriver(plan.target.connectionId)
    const execFn = async (sql: string) => {
      await targetDriver.executeStatement(sql)
    }
    const txFn = async (sql: 'BEGIN' | 'COMMIT' | 'ROLLBACK') => {
      await targetDriver.executeStatement(sql)
    }

    return executeMigration(plan, statements, selectedIndexes, execFn, txFn)
  })

  // ===== 持久化方案（D3）=====

  registerHandler('migration:savePlan', async (_event, { plan }) => {
    // 含 id 视为更新，否则新建
    const existing = plan.id ? migrationPlanDao.get(plan.id) : null
    if (existing && plan.id) {
      return migrationPlanDao.update(plan.id, plan)
    }
    return migrationPlanDao.create(plan)
  })

  registerHandler('migration:listPlans', async () => {
    return migrationPlanDao.list()
  })

  registerHandler('migration:getPlan', async (_event, { id }) => {
    return migrationPlanDao.get(id)
  })

  registerHandler('migration:deletePlan', async (_event, { id }) => {
    migrationPlanDao.remove(id)
    return { success: true }
  })
}
