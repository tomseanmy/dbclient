/**
 * Schema 上下文构建器
 *
 * 把 DB 的表结构（TableMeta）转为 LLM 友好的文本片段。
 * 隐私不变量：只含结构（表/列/类型/注释/主键/外键），不含任何数据行。
 *
 * 缓存：优先读 schema_cache（按 connection + database 维度），未命中回源并写缓存。
 * DDL 执行后由 executor 调用 invalidateSchemaCache 失效。
 *
 * Token 裁剪：表数或字符数超阈值时，优先保留 scopeTables 指定的表，
 * 其余截断并附提示，避免上下文爆炸。
 */
import type { DbType } from '@shared/types/connection'
import type { TableMeta, Table } from '@shared/types/database'
import { getDriver, getConfig } from '@main/domain/db/manager'
import { schemaCacheDao, metaKey } from '@main/infra/storage/schema-cache-dao'
import { logger } from '@main/infra/logger'

/** 构建 Schema 上下文的选项 */
export interface SchemaContextOptions {
  /** 指定 schema（PG 用）；缺省用驱动默认 */
  schema?: string
  /** 用户指定的「本次涉及哪些表」，优先完整保留 */
  scopeTables?: string[]
  /** 强制跳过缓存、重新回源（手动刷新场景） */
  refresh?: boolean
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
 * 带缓存：命中时直接用快照，避免对目标库的 N 次系统表查询。
 */
export async function buildSchemaContext(
  connectionId: string,
  opts: SchemaContextOptions = {},
): Promise<SchemaContextResult> {
  const driver = getDriver(connectionId)
  const config = getConfig(connectionId)
  const databaseName = opts.schema ?? config.database ?? '_default'

  // 缓存命中：直接用快照格式化（无需回源）
  if (!opts.refresh) {
    const cached = schemaCacheDao.get(connectionId, databaseName)
    if (cached) {
      logger.debug('Schema 缓存命中', { connectionId, databaseName, tables: cached.tables.length })
      // serverInfo 每次实时取（版本可能升级），不放入缓存快照
      const serverInfo = await driver.getServerInfo().catch(() => undefined)
      return formatSnapshot(
        config.type,
        opts.schema,
        cached.tables,
        cached.metas,
        opts.scopeTables,
        serverInfo,
      )
    }
  }

  // 未命中：回源 listTables + describeTable，并写缓存
  const allTables = await driver.listTables(opts.schema)
  const metas: Record<string, TableMeta> = {}

  for (const t of allTables) {
    const tableSchema = t.schema ?? opts.schema
    try {
      const meta = await driver.describeTable({ schema: tableSchema, table: t.name })
      metas[metaKey(tableSchema, t.name)] = meta
    } catch {
      // describe 失败则跳过该表，不中断整体构建
    }
  }

  schemaCacheDao.set(connectionId, databaseName, { tables: allTables, metas })
  logger.debug('Schema 缓存已写入', { connectionId, databaseName, tables: allTables.length })

  const serverInfo = await driver.getServerInfo().catch(() => undefined)
  return formatSnapshot(config.type, opts.schema, allTables, metas, opts.scopeTables, serverInfo)
}

/**
 * 失效 Schema 缓存。DDL 执行 / 手动刷新时调用。
 * 不指定 schema 则失效该连接下所有缓存。
 */
export function invalidateSchemaCache(connectionId: string, schema?: string): void {
  if (schema) {
    schemaCacheDao.invalidate(connectionId, schema)
  } else {
    schemaCacheDao.invalidateConnection(connectionId)
  }
}

/**
 * 把 tables + metas 快照格式化为上下文文本（含排序与裁剪）。
 * 缓存命中与回源共用此逻辑。
 */
function formatSnapshot(
  dbType: DbType,
  schema: string | undefined,
  allTables: Table[],
  metas: Record<string, TableMeta>,
  scopeTables: string[] = [],
  serverInfo?: string,
): SchemaContextResult {
  // 排序：scopeTables 指定的表排前面
  const scope = scopeTables
  const scoped = allTables.filter((t) => scope.includes(t.name))
  const rest = allTables.filter((t) => !scope.includes(t.name))
  const ordered = [...scoped, ...rest]

  const truncated = ordered.length > MAX_TABLES
  const tablesToDescribe = ordered.slice(0, MAX_TABLES)
  const includedTables: string[] = []

  const parts: string[] = []
  let charCount = 0

  for (const t of tablesToDescribe) {
    const tableSchema = t.schema ?? schema
    const meta = metas[metaKey(tableSchema, t.name)]
    if (!meta) continue // 快照中缺失（回源时 describe 失败的表）

    const block = formatTable(dbType, meta)
    if (charCount + block.length > MAX_CHARS && includedTables.length >= scope.length) {
      // 已超字符阈值且 scope 表都已包含，停止追加
      break
    }

    parts.push(block)
    includedTables.push(meta.name)
    charCount += block.length
  }

  const header = formatHeader(dbType, schema, allTables.length, serverInfo)
  const tail = truncated
    ? `\n\n> ⚠️ 表数量较多，仅展示前 ${includedTables.length} 张表的结构。如需其他表请在对话中指明表名。`
    : ''

  return {
    text: `${header}\n\n${parts.join('\n\n')}${tail}`,
    includedTables,
    truncated,
  }
}

/** 格式化表头说明（含数据库类型、版本、schema、表数量） */
function formatHeader(
  dbType: DbType,
  schema: string | undefined,
  totalTables: number,
  serverInfo?: string,
): string {
  const dbLabel = dbType.toUpperCase()
  // 版本信息：优先用 serverInfo（含版本号），让 LLM 生成与版本兼容的 SQL
  const versionPart = serverInfo ? ` · ${serverInfo}` : ` · ${dbLabel}`
  const schemaLabel = schema ? ` · schema: ${schema}` : ''
  return `## 数据库结构（${dbLabel}${versionPart}${schemaLabel}，共 ${totalTables} 张表）`
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
