/**
 * Redis 驱动实现（基于 ioredis）
 *
 * Redis 不是关系型数据库，这里把它的能力适配为类似语义：
 * - listSchemas() → 返回各 db index 作为 "schema"
 * - listTables() → 不适用，返回空（Redis 无表概念）
 * - getRedisOverview() → Redis 专属：各 db 的 key 数量概览
 *
 * M1 阶段只做连接验证 + key 概览，完整 key 浏览留到后续。
 */
import IORedis from 'ioredis'
import type { Cluster } from 'ioredis'
import type { DriverContext, DescribeOptions } from './driver'
import type { RedisDriver as IRedisDriver } from './driver'
import { tMain } from '@main/i18n'
import type { Schema, Table, TableMeta, RedisKeyOverview } from '@shared/types/database'

// Redis client 最小接口（单机和 cluster 都满足）
interface RedisLike {
  ping(): Promise<string>
  info(section?: string): Promise<string>
  disconnect(): void
}

export class RedisDriverClass implements IRedisDriver {
  private client: RedisLike | null = null

  async connect(ctx: DriverContext): Promise<void> {
    if (this.client) return
    this.client = this.createClient(ctx) as unknown as RedisLike
    await this.client.ping()
  }

  async testConnection(ctx: DriverContext): Promise<{ serverInfo?: string }> {
    const client = this.createClient(ctx) as unknown as RedisLike
    try {
      await client.ping()
      const info = await client.info('server')
      const versionLine = info.split('\r\n').find((l) => l.startsWith('redis_version:'))
      const version = versionLine?.split(':')[1]?.trim()
      return { serverInfo: `Redis ${version ?? 'unknown'}` }
    } finally {
      client.disconnect()
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect()
      this.client = null
    }
  }

  async getServerInfo(): Promise<string | undefined> {
    try {
      const info = await this.getClient().info('server')
      const versionLine = info.split('\r\n').find((l) => l.startsWith('redis_version:'))
      const version = versionLine?.split(':')[1]?.trim()
      return `Redis ${version ?? 'unknown'}`
    } catch {
      return undefined
    }
  }

  private getClient(): RedisLike {
    if (!this.client) throw new Error(tMain('errors.db.notEstablishedRedis'))
    return this.client
  }

  private createClient(ctx: DriverContext): IORedis | Cluster {
    const { config } = ctx
    const dbIndex = config.database ? Number.parseInt(config.database, 10) || 0 : 0

    // cluster 模式
    if (config.options?.redisMode === 'cluster' && config.options.redisNodes?.length) {
      const nodes = config.options.redisNodes.map((n) => {
        const [host, port] = n.split(':')
        return { host: host ?? 'localhost', port: port ? Number.parseInt(port, 10) : 6379 }
      })
      return new IORedis.Cluster(nodes, {
        redisOptions: { password: ctx.password },
      })
    }

    // 单机模式
    return new IORedis({
      host: config.host ?? 'localhost',
      port: config.port ?? 6379,
      password: ctx.password,
      db: dbIndex,
      connectTimeout: config.options?.connectTimeout ?? 10000,
      maxRetriesPerRequest: 3,
    })
  }

  async listSchemas(): Promise<Schema[]> {
    const overview = await this.getRedisOverview()
    return overview.databases
      .filter((d) => d.keyCount > 0)
      .map((d) => ({ name: `db${d.index}`, isDefault: d.index === 0 }))
  }

  async listTables(_schema?: string): Promise<Table[]> {
    // Redis 无表概念，返回空数组
    return []
  }

  async describeTable(_opts: DescribeOptions): Promise<TableMeta> {
    throw new Error(tMain('errors.db.redisNotSupportDescribe'))
  }

  async listRoles(): Promise<import('@shared/types/database').DatabaseRole[]> {
    // Redis 没有用户/角色体系（ACL 用户在 6.0+ 可查 ACL LOG，但与关系库角色语义不同）。
    // 返回空数组，UI 层据此显示「Redis 无角色概念」。
    return []
  }

  async getRedisOverview(): Promise<RedisKeyOverview> {
    const client = this.getClient()
    const info = await client.info('keyspace')
    const serverInfo = await client.info('server')
    const versionLine = serverInfo.split('\r\n').find((l) => l.startsWith('redis_version:'))

    // 解析 keyspace 信息，形如：db0:keys=10,expires=0,avg_ttl=0
    const databases = []
    for (let i = 0; i < 16; i++) {
      const line = info.split('\r\n').find((l) => l.startsWith(`db${i}:`))
      if (line) {
        const match = line.match(/keys=(\d+)/)
        databases.push({ index: i, keyCount: match ? Number.parseInt(match[1]!, 10) : 0 })
      } else {
        databases.push({ index: i, keyCount: 0 })
      }
    }

    return {
      databases,
      serverInfo: versionLine?.split(':')[1]?.trim(),
    }
  }
  async executeQuery(_sql: string, _opts?: import('./driver').QueryOptions): Promise<never> {
    throw new Error(tMain('errors.db.redisNotSupportSql'))
  }

  async executeStatement(_sql: string, _opts?: import('./driver').QueryOptions): Promise<never> {
    throw new Error(tMain('errors.db.redisNotSupportStatement'))
  }
}
