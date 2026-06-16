/**
 * Schema 缓存 DAO
 *
 * 表 schema_cache 已在 001_init.sql 建好（按 connection_id + database_name 唯一）。
 * 缓存完整 schema 快照（表 + 列元信息），避免 AI 调用时每次都查目标库系统表。
 *
 * 失效策略（调用方驱动）：
 * - DDL 执行后调用 invalidate()
 * - ObjectTree 手动刷新后调用 invalidate()
 * - 按 connection 维度整体失效（断开重连等）
 *
 * 注意：缓存只存「结构」，绝不存数据行。
 */
import { getDb } from './db'
import type { TableMeta, Table } from '@shared/types/database'

/** 缓存快照：表清单 + 各表完整结构 */
export interface SchemaSnapshot {
  /** listTables 的结果（表名/schema/行数估计等） */
  tables: Table[]
  /** table name → 完整结构（describeTable 结果），按 `${schema}.${name}` 或 `name` 作 key */
  metas: Record<string, TableMeta>
}

/** 构造 metas 的 key，与 set/get 保持一致 */
function metaKey(schema: string | undefined, table: string): string {
  return schema ? `${schema}.${table}` : table
}

export const schemaCacheDao = {
  /**
   * 读取缓存快照。命中返回快照，未命中返回 null。
   * databaseName 通常是 schema 名（PG）或库名（MySQL）；无 schema 概念时用配置的 database。
   */
  get(connectionId: string, databaseName: string): SchemaSnapshot | null {
    const db = getDb()
    const row = db
      .prepare(`SELECT snapshot FROM schema_cache WHERE connection_id = ? AND database_name = ?`)
      .get(connectionId, databaseName) as { snapshot: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.snapshot) as SchemaSnapshot
    } catch {
      // 快照损坏：删除并视为未命中
      db.prepare(`DELETE FROM schema_cache WHERE connection_id = ? AND database_name = ?`).run(
        connectionId,
        databaseName,
      )
      return null
    }
  },

  /**
   * 写入/更新缓存快照（upsert）。
   */
  set(connectionId: string, databaseName: string, snapshot: SchemaSnapshot): void {
    const db = getDb()
    db.prepare(
      `INSERT INTO schema_cache (connection_id, database_name, snapshot, version, refreshed_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(connection_id, database_name)
       DO UPDATE SET snapshot = excluded.snapshot, version = excluded.version, refreshed_at = datetime('now')`,
    ).run(connectionId, databaseName, JSON.stringify(snapshot), String(Date.now()))
  },

  /** 失效单个 schema 缓存 */
  invalidate(connectionId: string, databaseName: string): void {
    const db = getDb()
    db.prepare(`DELETE FROM schema_cache WHERE connection_id = ? AND database_name = ?`).run(
      connectionId,
      databaseName,
    )
  },

  /** 失效某连接下所有 schema 缓存（断开重连/删除连接时） */
  invalidateConnection(connectionId: string): void {
    const db = getDb()
    db.prepare(`DELETE FROM schema_cache WHERE connection_id = ?`).run(connectionId)
  },
}

export { metaKey }
