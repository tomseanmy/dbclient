/**
 * DB 驱动统一抽象层
 *
 * 所有数据库（MySQL/PG/SQLite/Redis）实现此接口，
 * 上层（IPC / AI / MCP）无需感知具体差异。
 *
 * 关键约束：本模块属于核心领域层，不依赖 electron，可独立测试。
 */
import type { ConnectionConfig } from '@shared/types/connection'
import type {
  QueryResult,
  RedisKeyOverview,
  Schema,
  Table,
  TableMeta,
  DatabaseRole,
} from '@shared/types/database'
import type { UnifiedType } from '@shared/types/database'

/** 驱动实现所需的连接上下文（含密码，从 CredentialStore 取出后传入） */
export interface DriverContext {
  config: ConnectionConfig
  password?: string
}

/** 描述表时的选项 */
export interface DescribeOptions {
  schema?: string
  table: string
}

/** 查询执行选项 */
export interface QueryOptions {
  /** 最大返回行数（默认 1000） */
  limit?: number
  /** 超时毫秒（默认 30000） */
  timeout?: number
}

/** 统一 DB 驱动接口 */
export interface DbDriver {
  /** 建立连接（或验证连接配置） */
  connect(ctx: DriverContext): Promise<void>

  /** 测试连接（连上即断开，不保持） */
  testConnection(ctx: DriverContext): Promise<{ serverInfo?: string }>

  /** 断开连接，释放资源 */
  disconnect(): Promise<void>

  /** 获取服务器版本信息（复用已建立连接，供 AI 提示词注入版本，避免方言兼容性问题） */
  getServerInfo(): Promise<string | undefined>

  /** 列出所有 schema / database */
  listSchemas(): Promise<Schema[]>

  /** 列出指定 schema 下的表/视图 */
  listTables(schema?: string): Promise<Table[]>

  /** 获取表的完整结构 */
  describeTable(opts: DescribeOptions): Promise<TableMeta>

  /** 列出数据库中的角色 / 用户（Redis 等无角色概念的库返回空数组） */
  listRoles(): Promise<DatabaseRole[]>

  /** 执行查询，返回结果集（SELECT 等返回行） */
  executeQuery(sql: string, opts?: QueryOptions): Promise<QueryResult>

  /** 执行语句，返回影响行数（INSERT/UPDATE/DELETE/DDL） */
  executeStatement(sql: string, opts?: QueryOptions): Promise<{ rowsAffected: number }>
}

/**
 * 将 DB 原始类型名映射为统一类型。
 * 各驱动实现自己的映射表。
 */
export function mapUnifiedType(
  dataType: string,
  mappings: Record<string, UnifiedType>,
): UnifiedType {
  const normalized = dataType
    .toLowerCase()
    .replace(/\(\d+(,\d+)?\)/, '')
    .trim()
  // 精确匹配
  if (mappings[normalized]) return mappings[normalized]
  // 前缀匹配（如 varchar、character varying）
  for (const [prefix, type] of Object.entries(mappings)) {
    if (normalized.startsWith(prefix)) return type
  }
  return 'other'
}

// 各驱动实现在各自文件，提前 import（bundler 会处理顺序）
import { MysqlDriver } from './mysql'
import { PostgresDriver } from './postgres'
import { SqliteDriver } from './sqlite'
import { RedisDriverClass } from './redis'

/** Redis 驱动扩展接口（额外的 Redis 专属方法） */
export interface RedisDriver extends DbDriver {
  /** 获取各 db index 的 key 概览 */
  getRedisOverview(): Promise<RedisKeyOverview>
}

/** 驱动工厂：根据连接类型创建对应驱动实例 */
export function createDriver(type: ConnectionConfig['type']): DbDriver {
  switch (type) {
    case 'mysql':
      return new MysqlDriver()
    case 'postgres':
      return new PostgresDriver()
    case 'sqlite':
      return new SqliteDriver()
    case 'redis':
      return new RedisDriverClass()
  }
}
