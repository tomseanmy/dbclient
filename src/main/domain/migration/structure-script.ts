/**
 * 结构 DDL 脚本生成器
 *
 * 将 StructureDiffItem[] 经方言生成器转成目标方言的 GeneratedStatement[]。
 *
 * 语句排序（降低依赖冲突）：
 *   1. DROP 外键（先解除引用，避免删列/索引被外键阻塞）
 *   2. DROP 索引
 *   3. DROP 列
 *   4. createTable（目标表不存在时）
 *   5. ADD/MODIFY 列
 *   6. ADD 索引
 *   7. ADD 外键（最后建，依赖列已就绪）
 *
 * 风险分级：
 *   - DROP / dropTable → danger
 *   - modifyColumn / createTable（覆盖性）→ caution
 *   - add* / 其余 → safe
 */
import type {
  MigrationDialect,
  GeneratedStatement,
  StructureDiffItem,
} from '@shared/types/migration'
import { getDialectGenerator } from './dialect'
import type { DialectGenerator } from './dialect'

/** 单条 diff 项 → GeneratedStatement（含风险分级） */
function itemToStatement(
  item: StructureDiffItem,
  gen: DialectGenerator,
  tableName: string,
): GeneratedStatement {
  switch (item.kind) {
    case 'createTable':
      return { sql: gen.createTable(item.tableMeta), kind: 'ddl', riskLevel: 'caution' }
    case 'dropTable':
      return { sql: gen.dropTable(item.tableName), kind: 'ddl', riskLevel: 'danger' }
    case 'addColumn':
      return { sql: gen.addColumn(tableName, item.column), kind: 'ddl', riskLevel: 'safe' }
    case 'modifyColumn':
      return {
        sql: gen.modifyColumn(tableName, item.column, item.changes),
        kind: 'ddl',
        riskLevel: 'caution',
      }
    case 'dropColumn':
      return { sql: gen.dropColumn(tableName, item.columnName), kind: 'ddl', riskLevel: 'danger' }
    case 'addIndex':
      return { sql: gen.addIndex(tableName, item.index), kind: 'ddl', riskLevel: 'safe' }
    case 'dropIndex':
      return { sql: gen.dropIndex(tableName, item.indexName), kind: 'ddl', riskLevel: 'danger' }
    case 'addForeignKey':
      return { sql: gen.addForeignKey(tableName, item.fk), kind: 'ddl', riskLevel: 'safe' }
    case 'dropForeignKey':
      return { sql: gen.dropForeignKey(tableName, item.fkName), kind: 'ddl', riskLevel: 'danger' }
  }
}

/** 排序优先级（数字小的先执行） */
const ORDER: Record<StructureDiffItem['kind'], number> = {
  dropForeignKey: 1,
  dropIndex: 2,
  dropColumn: 3,
  createTable: 4,
  dropTable: 4,
  addColumn: 5,
  modifyColumn: 6,
  addIndex: 7,
  addForeignKey: 8,
}

/**
 * 生成结构迁移脚本。
 *
 * @param items diff 项（来自 diffStructure）
 * @param dialect 目标方言
 * @param tableName 目标表名（列级操作需要）
 */
export function generateStructureScript(
  items: StructureDiffItem[],
  dialect: MigrationDialect,
  tableName: string,
): GeneratedStatement[] {
  const gen = getDialectGenerator(dialect)
  // 按依赖安全顺序排序
  const ordered = [...items].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
  return ordered.map((item) => itemToStatement(item, gen, tableName))
}
