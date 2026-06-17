import { tMain } from '@main/i18n'
/**
 * 迁移目标加载辅助
 *
 * 把 MigrationTarget（connectionId + schema + table）解析为可用资源：
 * - 目标连接的 driver（已建立的连接实例）
 * - 目标方言（DbType → MigrationDialect）
 * - 目标表结构（describeTable 结果，可能为 null 表示表不存在）
 *
 * 供 IPC handler 与执行引擎复用，避免各处重复写连接查找逻辑。
 */
import type { DbType } from '@shared/types/connection'
import type { TableMeta } from '@shared/types/database'
import type { MigrationDialect, MigrationTarget } from '@shared/types/migration'
import { getConfig, getDriver, isConnected } from '../db/manager'
import { connectionsDao } from '@main/infra/storage/connections-dao'

/** DbType → MigrationDialect（Redis 不参与关系迁移） */
export function toDialect(type: DbType): MigrationDialect {
  switch (type) {
    case 'mysql':
      return 'mysql'
    case 'postgres':
      return 'postgres'
    case 'sqlite':
      return 'sqlite'
    default:
      throw new Error(tMain('errors.migration.unsupportedDbType', { type }))
  }
}

/** 已解析的迁移目标 */
export interface ResolvedTarget {
  /** 目标表名 */
  table: string
  /** 目标方言 */
  dialect: MigrationDialect
  /** 连接 id */
  connectionId: string
}

/** 解析目标定位：确保连接存在、可迁移类型、返回基础信息 */
export function resolveTarget(target: MigrationTarget): ResolvedTarget {
  const config = connectionsDao.get(target.connectionId)
  if (!config)
    throw new Error(tMain('errors.migration.connConfigNotFound', { id: target.connectionId }))
  return {
    table: target.table,
    dialect: toDialect(config.type),
    connectionId: target.connectionId,
  }
}

/** 校验连接已建立，并返回 driver（描述表结构用） */
function ensureConnected(connectionId: string): ReturnType<typeof getDriver> {
  if (!isConnected(connectionId)) {
    throw new Error(tMain('errors.migration.connNotEstablished', { id: connectionId }))
  }
  return getDriver(connectionId)
}

/**
 * 描述目标表结构。表不存在时返回 null（diff 时表示需要 createTable）。
 */
export async function describeTargetTable(target: MigrationTarget): Promise<TableMeta | null> {
  ensureConnected(target.connectionId)
  const driver = getDriver(target.connectionId)
  try {
    const meta = await driver.describeTable({ schema: target.schema, table: target.table })
    // 各驱动对不存在的表不抛错，而是返回空 columns（SQLite PRAGMA / PG/MySQL information_schema）
    // 故 columns 为空时视为表不存在 → diffStructure 走 createTable 分支
    if (meta.columns.length === 0) return null
    return meta
  } catch (err) {
    // 部分驱动/场景会抛错（如权限不足），表不存在相关错误归一为 null
    const msg = err instanceof Error ? err.message : String(err)
    if (/not exist|does not exist|no such|找不到|不存在|relation/i.test(msg)) return null
    throw err
  }
}

/** 校验目标连接可读（连接已建立），返回其 config 用于方言判断 */
export function assertMigratable(target: MigrationTarget): { dialect: MigrationDialect } {
  if (!isConnected(target.connectionId)) {
    throw new Error(tMain('errors.migration.connNotEstablishedShort', { id: target.connectionId }))
  }
  const config = getConfig(target.connectionId)
  return { dialect: toDialect(config.type) }
}
