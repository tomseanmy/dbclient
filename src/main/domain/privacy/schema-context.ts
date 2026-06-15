/**
 * Schema 上下文构建器
 *
 * 把 DB 的表结构（TableMeta）转为 LLM 友好的文本片段。
 * 隐私不变量：只含结构（表/列/类型/注释/主键/外键），不含任何数据行。
 *
 * Token 裁剪：表数或字符数超阈值时，优先保留 scopeTables 指定的表，
 * 其余截断并附提示，避免上下文爆炸。
 */
import type { DbType } from '@shared/types/connection'
import type { TableMeta } from '@shared/types/database'
import { getDriver, getConfig } from '@main/domain/db/manager'

/** 构建 Schema 上下文的选项 */
export interface SchemaContextOptions {
  /** 指定 schema（PG 用）；缺省用驱动默认 */
  schema?: string
  /** 用户指定的「本次涉及哪些表」，优先完整保留 */
  scopeTables?: string[]
}

/** 构建结果 */
export interface SchemaContextResult {
  /** 格式化后的文本（注入 prompt 用） */
  text: string
  /** 实际包含的表名列表（供数据流向提示用） */
  includedTables: string[]
  /** 是否因超阈值截断了部分表 */
  truncated: boolean
}

/** 安全阈值：避免上下文过大 */
const MAX_TABLES = 40
const MAX_CHARS = 12_000

/**
 * 构建指定连接的 Schema 上下文文本。
 *
 * 流程：listTables → 按优先级排序（scopeTables 优先）→ 逐个 describeTable → 格式化。
 */
export async function buildSchemaContext(
  connectionId: string,
  opts: SchemaContextOptions = {},
): Promise<SchemaContextResult> {
  const driver = getDriver(connectionId)
  const config = getConfig(connectionId)

  const allTables = await driver.listTables(opts.schema)

  // 排序：scopeTables 指定的表排前面
  const scope = opts.scopeTables ?? []
  const scoped = allTables.filter((t) => scope.includes(t.name))
  const rest = allTables.filter((t) => !scope.includes(t.name))
  const ordered = [...scoped, ...rest]

  const truncated = ordered.length > MAX_TABLES
  const tablesToDescribe = ordered.slice(0, MAX_TABLES)
  const includedTables: string[] = []

  const parts: string[] = []
  let charCount = 0

  for (const t of tablesToDescribe) {
    let meta: TableMeta
    try {
      // 优先用表自身的 schema（listTables 返回的），再回退 opts.schema
      const tableSchema = t.schema ?? opts.schema
      meta = await driver.describeTable({ schema: tableSchema, table: t.name })
    } catch {
      // describe 失败则跳过该表，不中断整体构建
      continue
    }

    const block = formatTable(config.type, meta)
    if (charCount + block.length > MAX_CHARS && includedTables.length >= scope.length) {
      // 已超字符阈值且 scope 表都已包含，停止追加
      break
    }

    parts.push(block)
    includedTables.push(meta.name)
    charCount += block.length
  }

  const header = formatHeader(config.type, opts.schema, allTables.length)
  const tail = truncated
    ? `\n\n> ⚠️ 表数量较多，仅展示前 ${includedTables.length} 张表的结构。如需其他表请在对话中指明表名。`
    : ''

  return {
    text: `${header}\n\n${parts.join('\n\n')}${tail}`,
    includedTables,
    truncated,
  }
}

/** 格式化表头说明 */
function formatHeader(dbType: DbType, schema: string | undefined, totalTables: number): string {
  const dbLabel = dbType.toUpperCase()
  const schemaLabel = schema ? ` · schema: ${schema}` : ''
  return `## 数据库结构（${dbLabel}${schemaLabel}，共 ${totalTables} 张表）`
}

/** 格式化单张表的结构为 Markdown */
function formatTable(dbType: DbType, meta: TableMeta): string {
  const cols = meta.columns.map((c) => {
    const pk = c.isPrimaryKey ? ' 🔑PK' : ''
    const nullable = c.nullable ? '' : ' NOT NULL'
    const comment = c.comment ? ` -- ${c.comment}` : ''
    return `  - \`${c.name}\` ${c.dataType}${pk}${nullable}${comment}`
  })

  const fks = meta.foreignKeys.length
    ? meta.foreignKeys
        .map(
          (fk) =>
            `  - ${fk.columns.join(',')} → ${fk.referencesTable}(${fk.referencesColumns.join(',')})`,
        )
        .join('\n')
    : ''

  const comment = meta.comment ? `（${meta.comment}）` : ''
  const lines = [`### ${meta.name}${comment}`, cols.join('\n')]
  if (fks) lines.push('**外键:**', fks)

  return lines.join('\n')
}
