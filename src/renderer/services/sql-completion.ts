/**
 * SQL 自动补全 Schema 服务
 *
 * 为 Monaco 补全 provider 提供「当前激活连接的表/列结构」数据。
 * 数据源：db:listTables + db:describeTable，带内存缓存（按 connectionId + schema），
 * 避免每次补全都打目标库。
 *
 * 设计：补全 provider 是按语言（sql）全局注册的，无法感知具体连接，
 * 故用一个可切换的「当前上下文」：编辑器挂载时 setContext(connectionId, schema)。
 */
import { api } from '../api'
import type { Table, TableMeta } from '../api'

interface SchemaContextEntry {
  connectionId: string
  schema?: string
}

interface CachedSchema {
  tables: Table[]
  /** table name → 结构；懒加载，describe 后填充 */
  metas: Map<string, TableMeta>
  /** 已加载过 meta 的表名集合（含失败，避免重复尝试） */
  metaLoaded: Set<string>
  /** 加载时间戳，用于 TTL 失效 */
  loadedAt: number
}

/** 缓存：`${connectionId}:${schema ?? ''}` → 结构 */
const cache = new Map<string, CachedSchema>()
/** 当前激活的补全上下文（编辑器挂载时设置） */
let activeContext: SchemaContextEntry | null = null

/** 缓存 TTL：5 分钟（结构变更频率低；DDL 后手动刷新） */
const TTL_MS = 5 * 60 * 1000

function cacheKey(connectionId: string, schema?: string): string {
  return `${connectionId}:${schema ?? ''}`
}

async function ensureTables(connectionId: string, schema?: string): Promise<CachedSchema> {
  const key = cacheKey(connectionId, schema)
  const now = Date.now()
  const existing = cache.get(key)
  if (existing && now - existing.loadedAt < TTL_MS) {
    return existing
  }

  const tables = await api['db:listTables']({ connectionId, schema })
  const entry: CachedSchema = {
    tables,
    metas: new Map(),
    metaLoaded: new Set(),
    loadedAt: now,
  }
  cache.set(key, entry)
  return entry
}

/** 获取某表的列结构（懒加载，缓存） */
async function getTableMeta(
  entry: CachedSchema,
  connectionId: string,
  schema: string | undefined,
  table: string,
): Promise<TableMeta | null> {
  if (entry.metas.has(table)) return entry.metas.get(table)!
  if (entry.metaLoaded.has(table)) return null // 已尝试过（含失败）

  entry.metaLoaded.add(table)
  try {
    const meta = await api['db:describeTable']({ connectionId, schema, table })
    entry.metas.set(table, meta)
    return meta
  } catch {
    return null
  }
}

/** 编辑器挂载时设置当前补全上下文 */
export function setCompletionContext(connectionId: string, schema?: string): void {
  activeContext = { connectionId, schema }
}

/** 清除当前上下文（编辑器卸载时调用，避免补全串台） */
export function clearCompletionContext(): void {
  activeContext = null
}

/** 删除某连接的补全缓存（结构变更后刷新） */
export function invalidateCompletionCache(connectionId: string, schema?: string): void {
  const key = cacheKey(connectionId, schema)
  cache.delete(key)
}

export interface CompletionSchemaData {
  /** 表名列表（含视图） */
  tables: { name: string; type: 'table' | 'view'; comment?: string }[]
  /** 指定表的列（若 meta 已加载） */
  columnsOf: (table: string) => { name: string; dataType: string; isPrimaryKey: boolean }[]
}

/**
 * 取当前激活连接的补全数据（表清单，同步可用）。
 * columnsOf 只能返回已加载的列；首次补全列表表后异步预热。
 */
export async function getCompletionSchema(): Promise<CompletionSchemaData | null> {
  if (!activeContext) return null
  const { connectionId, schema } = activeContext
  try {
    const entry = await ensureTables(connectionId, schema)
    return {
      tables: entry.tables.map((t) => ({ name: t.name, type: t.type, comment: t.comment })),
      columnsOf: (table) => {
        const meta = entry.metas.get(table)
        if (!meta) return []
        return meta.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: c.isPrimaryKey,
        }))
      },
    }
  } catch {
    return null
  }
}

/** 预热：异步加载全部表的列结构（首屏后慢慢填充，后续补全更全） */
export async function preloadColumns(): Promise<void> {
  if (!activeContext) return
  const { connectionId, schema } = activeContext
  const entry = await ensureTables(connectionId, schema)
  // 并发加载，限制并发数避免压垮目标库
  const pending = entry.tables
    .filter((t) => !entry.metaLoaded.has(t.name))
    .slice(0, 50)
    .map((t) => getTableMeta(entry, connectionId, schema, t.name))
  await Promise.all(pending)
}
