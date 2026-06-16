/**
 * 连接配置 DAO
 *
 * 连接配置存本地 SQLite（connections 表），密码单独走 CredentialStore。
 * 对外暴露的 list/get 返回的配置不含密码（密码本就不在 config 结构里）。
 */
import { randomUUID } from 'node:crypto'
import type {
  ConnectionConfig,
  ConnectionInput,
  ConnectionListItem,
} from '@shared/types/connection'
import { getDb } from './db'
import { getCredentialStore } from '../credential'

interface ConnectionRow {
  id: string
  name: string
  type: string
  host: string | null
  port: number | null
  username: string | null
  database: string | null
  options: string | null
  environment: string
  group_id: string | null
  color: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

function rowToConfig(row: ConnectionRow): ConnectionConfig {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ConnectionConfig['type'],
    host: row.host ?? undefined,
    port: row.port ?? undefined,
    username: row.username ?? undefined,
    database: row.database ?? undefined,
    options: row.options ? JSON.parse(row.options) : undefined,
    environment: row.environment as ConnectionConfig['environment'],
    groupId: row.group_id ?? undefined,
    color: row.color ?? undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** ConnectionConfig 即 ConnectionListItem（结构一致），直接复用 */
function toListItem(config: ConnectionConfig): ConnectionListItem {
  return config
}

export const connectionsDao = {
  /** 列出所有连接（不含密码） */
  list(): ConnectionListItem[] {
    const db = getDb()
    const rows = db
      .prepare(`SELECT * FROM connections ORDER BY sort_order, name`)
      .all() as ConnectionRow[]
    return rows.map((r) => toListItem(rowToConfig(r)))
  },

  /** 获取单个连接配置 */
  get(id: string): ConnectionConfig | null {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM connections WHERE id = ?`).get(id) as
      | ConnectionRow
      | undefined
    return row ? rowToConfig(row) : null
  },

  /** 获取连接已存的密码（从 CredentialStore） */
  async getCredential(id: string): Promise<string | null> {
    return getCredentialStore().getPassword(id)
  },

  /** 新建连接（密码单独存入 CredentialStore） */
  async create(input: ConnectionInput): Promise<ConnectionConfig> {
    const db = getDb()
    const id = randomUUID()
    const now = new Date().toISOString()
    const sortOrder = input.sortOrder ?? 0

    db.prepare(
      `INSERT INTO connections
        (id, name, type, host, port, username, database, options, environment, group_id, color, sort_order, created_at, updated_at)
       VALUES
        (@id, @name, @type, @host, @port, @username, @database, @options, @environment, @group_id, @color, @sort_order, @created_at, @updated_at)`,
    ).run({
      id,
      name: input.name,
      type: input.type,
      host: input.host ?? null,
      port: input.port ?? null,
      username: input.username ?? null,
      database: input.database ?? null,
      options: input.options ? JSON.stringify(input.options) : null,
      environment: input.environment,
      group_id: input.groupId ?? null,
      color: input.color ?? null,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
    })

    // 密码存入 CredentialStore
    if (input.password) {
      await getCredentialStore().setPassword(id, input.password)
    }

    const created = this.get(id)
    if (!created) {
      throw new Error(`连接创建后查询失败：${id}`)
    }
    return created
  },

  /** 更新连接（若提供 password 则更新密码） */
  async update(id: string, input: ConnectionInput): Promise<ConnectionConfig> {
    const db = getDb()
    const now = new Date().toISOString()

    db.prepare(
      `UPDATE connections SET
        name = @name, type = @type, host = @host, port = @port,
        username = @username, database = @database, options = @options,
        environment = @environment, group_id = @group_id, color = @color,
        sort_order = @sort_order, updated_at = @updated_at
       WHERE id = @id`,
    ).run({
      id,
      name: input.name,
      type: input.type,
      host: input.host ?? null,
      port: input.port ?? null,
      username: input.username ?? null,
      database: input.database ?? null,
      options: input.options ? JSON.stringify(input.options) : null,
      environment: input.environment,
      group_id: input.groupId ?? null,
      color: input.color ?? null,
      sort_order: input.sortOrder ?? 0,
      updated_at: now,
    })

    // 密码更新：只有传入非空密码才覆盖；留空（undefined/null/''）则保持原密码不变。
    // 注意：经 contextBridge/IPC 序列化后 undefined 可能变为 null/''，
    // 因此用 truthy 判断而非 !== undefined，避免误删已有密码。
    if (input.password) {
      await getCredentialStore().setPassword(id, input.password)
    }

    const updated = this.get(id)
    if (!updated) {
      throw new Error(`连接更新后查询失败：${id}`)
    }
    return updated
  },

  /** 删除连接（同时删除密码） */
  async remove(id: string): Promise<void> {
    const db = getDb()
    db.prepare(`DELETE FROM connections WHERE id = ?`).run(id)
    await getCredentialStore().deletePassword(id)
  },
}
