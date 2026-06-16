/**
 * migration:* IPC handler —— 数据库迁移
 *
 * 批次 B 实现：结构迁移（diffStructure + generateScript 的结构部分）。
 * 数据迁移（diffData / previewRows / execute / 持久化方案）在批次 C/D 补齐。
 *
 * 安全：所有迁移默认只生成脚本，不自动执行；执行走 M3 安全层（见 T5.4.2）。
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

  // 生成迁移脚本（结构部分；数据部分在批次 C 的 data-script 完成后合并）
  registerHandler('migration:generateScript', async (_event, { plan }) => {
    const dialect = assertMigratable(plan.target).dialect
    const allWarnings: TypeMappingWarning[] = [...(plan.warnings ?? [])]

    // 结构脚本
    const structureStmts = generateStructureScript(plan.structureItems, dialect, plan.target.table)

    // 数据脚本（批次 C 实现后接入；此处先返回结构部分）
    const dataStmts: GeneratedStatement[] = []

    return { statements: [...structureStmts, ...dataStmts], warnings: allWarnings }
  })
}
