/**
 * migration:* IPC handler —— 数据库迁移
 *
 * 多表批量迁移：plan.pairs 为表对列表。
 * - diffStructure/diffData/previewRows：接收单对（前端循环调用），保持无状态简单
 * - generateScript/execute：接收完整 plan，遍历 pairs 拼接脚本 / 逐表执行
 *
 * 安全：所有迁移默认只生成脚本，不自动执行；执行走执行引擎（事务守卫 + driver 执行）。
 * 每表独立事务（决策）：单表失败不影响其他表。
 */
import { dialog, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { registerHandler } from './registry'
import { tMain } from '@main/i18n'
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
import { executeStatements, validateTransactionStrategy } from '@main/domain/migration/executor'
import { getDriver } from '@main/domain/db/manager'
import { migrationPlanDao } from '@main/infra/storage/migration-plan-dao'
import type {
  DataDiffItem,
  DataStrategy,
  GeneratedStatement,
  MigrationBatchResult,
  MigrationDialect,
  MigrationResult,
  MigrationTablePair,
  StructureDiffItem,
  TypeMappingWarning,
} from '@shared/types/migration'

/** 生成脚本所需的选项（从 plan.options 截取） */
interface ScriptGenOptions {
  strategy: DataStrategy
  batchSize?: number
}

/**
 * 为单个表对生成完整脚本（结构 + 数据）。
 * generateScript handler 与 execute handler 复用。
 */
async function generateScriptForPair(
  pair: {
    source: MigrationTablePair['source']
    target: MigrationTablePair['target']
    structureItems: StructureDiffItem[]
    dataItems?: DataDiffItem[]
  },
  dialect: MigrationDialect,
  options: ScriptGenOptions,
  includeData: boolean,
): Promise<GeneratedStatement[]> {
  const structureStmts = generateStructureScript(pair.structureItems, dialect, pair.target.table)
  const dataStmts: GeneratedStatement[] = []
  if (includeData && pair.dataItems && pair.dataItems.length > 0) {
    const targetMeta = await describeTargetTable(pair.target)
    if (targetMeta) {
      dataStmts.push(
        ...generateDataScript(
          { targetMeta, dialect, strategy: options.strategy, batchSize: options.batchSize },
          pair.dataItems,
        ),
      )
    }
  }
  return [...structureStmts, ...dataStmts]
}

export function registerMigrationHandlers(): void {
  // 结构 diff（单对）：对比源/目标表结构，产出差异项 + 跨库类型告警
  registerHandler('migration:diffStructure', async (_event, { source, target }) => {
    const resolvedTarget = resolveTarget(target)
    logger.info('迁移结构 diff', { source: source.table, target: target.table })

    const [sourceMeta, targetMeta] = await Promise.all([
      describeTargetTable(source),
      describeTargetTable(target),
    ])
    if (!sourceMeta) {
      throw new Error(
        tMain('errors.migration.sourceTableNotFound', {
          schema: source.schema ?? '',
          table: source.table,
        }),
      )
    }

    // 跨库类型映射：源端列 → 目标方言（登记告警 + 调整 dataType）
    const { columns: mappedColumns, warnings } = mapColumnsForTarget(
      sourceMeta.columns,
      resolvedTarget.dialect,
    )
    const mappedSourceMeta = { ...sourceMeta, columns: mappedColumns }

    const items = diffStructure(mappedSourceMeta, targetMeta)
    return { items, warnings }
  })

  // 数据 diff（单对）：按 PK 比对源/目标行，产出 insert/delete 项（不做 UPDATE）
  registerHandler('migration:diffData', async (_event, { source, target, strategy }) => {
    logger.info('迁移数据 diff', { source: source.table, strategy })

    const [sourceMeta, targetMeta] = await Promise.all([
      describeTargetTable(source),
      describeTargetTable(target),
    ])
    if (!sourceMeta) {
      throw new Error(
        tMain('errors.migration.sourceTableNotFound', {
          schema: source.schema ?? '',
          table: source.table,
        }),
      )
    }

    const pkColumns = extractPrimaryKeys(sourceMeta)
    const sourceDriver = getDriver(source.connectionId)

    const needFullRows = strategy === 'fullReplace'
    const sourceRows = needFullRows
      ? await fetchAllRows(sourceDriver, source.table, source.schema, {
          total: sourceMeta.estimatedRows,
        })
      : await fetchPkOnly(sourceDriver, source.table, source.schema, pkColumns, {
          total: sourceMeta.estimatedRows,
        })

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

  // 预览将受影响的行（单对，数据迁移前供用户确认）
  registerHandler('migration:previewRows', async (_event, { source, target, strategy, limit }) => {
    const previewLimit = limit ?? 100
    const sourceMeta = await describeTargetTable(source)
    if (!sourceMeta) {
      throw new Error(
        tMain('errors.migration.sourceTableNotFoundShort', {
          schema: source.schema ?? '',
          table: source.table,
        }),
      )
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
    const preview = items.filter((i) => i.kind === 'insert').slice(0, previewLimit)
    return { rows: preview, total: items.length }
  })

  // 生成迁移脚本（遍历 pairs，拼接所有表的语句）
  registerHandler('migration:generateScript', async (_event, { plan }) => {
    const dialect = assertMigratable(plan.pairs[0]!.target).dialect
    const allWarnings: TypeMappingWarning[] = [...(plan.warnings ?? [])]
    const includeData = plan.options.strategy !== undefined

    const allStmts: GeneratedStatement[] = []
    for (const pair of plan.pairs) {
      const stmts = await generateScriptForPair(pair, dialect, plan.options, includeData)
      allStmts.push(...stmts)
    }

    return { statements: allStmts, warnings: allWarnings }
  })

  // 执行迁移（遍历 pairs，每表独立事务）
  registerHandler('migration:execute', async (_event, { plan, selectedByTable }) => {
    logger.info('执行批量迁移', { tables: Object.keys(selectedByTable).length })
    const start = Date.now()
    const dialect = assertMigratable(plan.pairs[0]!.target).dialect

    const results: Record<string, MigrationResult> = {}
    let totalSuccess = 0
    let totalFailed = 0

    for (const pair of plan.pairs) {
      const tableName = pair.target.table
      const includeData = (pair.dataItems?.length ?? 0) > 0
      const statements = await generateScriptForPair(pair, dialect, plan.options, includeData)

      // 事务守卫：DML 不允许 none
      validateTransactionStrategy({ dataItems: pair.dataItems, options: plan.options }, statements)

      // 按勾选过滤
      const selected = (selectedByTable[tableName] ?? [])
        .map((i) => statements[i])
        .filter((s): s is GeneratedStatement => s !== undefined)

      // 在该表的目标连接上执行（每表独立事务）
      const targetDriver = getDriver(pair.target.connectionId)
      const execFn = async (sql: string) => {
        await targetDriver.executeStatement(sql)
      }
      const txFn = async (sql: 'BEGIN' | 'COMMIT' | 'ROLLBACK') => {
        await targetDriver.executeStatement(sql)
      }

      try {
        const result = await executeStatements(selected, plan.options.useTransaction, execFn, txFn)
        results[tableName] = result
        if (result.success) totalSuccess++
        else totalFailed++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        results[tableName] = {
          success: false,
          applied: 0,
          failed: selected.length,
          durationMs: 0,
          failedItems: [{ index: 0, sql: '', error: message }],
        }
        totalFailed++
      }
    }

    const batchResult: MigrationBatchResult = {
      results,
      totalSuccess,
      totalFailed,
      durationMs: Date.now() - start,
    }
    return batchResult
  })

  // 导出脚本为 .sql（弹保存对话框 + 写文件 + 打开所在文件夹）
  registerHandler('migration:exportScript', async (_event, { sql, defaultName }) => {
    const result = await dialog.showSaveDialog({
      title: tMain('migration.exportScriptTitle'),
      defaultPath: defaultName ?? `migration-${Date.now()}.sql`,
      filters: [
        { name: 'SQL', extensions: ['sql'] },
        { name: tMain('migration.allFiles'), extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }
    await writeFile(result.filePath, sql, 'utf-8')
    // 打开文件所在目录并选中该文件
    shell.showItemInFolder(result.filePath)
    return { success: true, filePath: result.filePath }
  })

  // ===== 持久化方案（D3）=====

  registerHandler('migration:savePlan', async (_event, { plan }) => {
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
