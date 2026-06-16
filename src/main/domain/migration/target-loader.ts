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
      throw new Error(`不支持对 ${type} 类型数据库执行迁移`)
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
  if (!config) throw new Error(`连接配置不存在：${target.connectionId}`)
  return {
    table: target.table,
    dialect: toDialect(config.type),
    connectionId: target.connectionId,
  }
}

/** 校验连接已建立，并返回 driver（描述表结构用） */
function ensureConnected(connectionId: string): ReturnType<typeof getDriver> {
  if (!isConnected(connectionId)) {
    throw new Error(`连接 ${connectionId} 未建立，请先连接数据库`)
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
    return await driver.describeTable({ schema: target.schema, table: target.table })
  } catch (err) {
    // 表不存在等错误归一为 null，由 diff 逻辑决定 createTable
    const msg = err instanceof Error ? err.message : String(err)
    if (/not exist|does not exist|找不到|不存在/i.test(msg)) return null
    throw err
  }
}

/** 校验目标连接可读（连接已建立），返回其 config 用于方言判断 */
export function assertMigratable(target: MigrationTarget): { dialect: MigrationDialect } {
  if (!isConnected(target.connectionId)) {
    throw new Error(`连接 ${target.connectionId} 未建立`)
  }
  const config = getConfig(target.connectionId)
  return { dialect: toDialect(config.type) }
}
