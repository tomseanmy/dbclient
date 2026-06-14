/**
 * 连接配置相关类型（主进程与渲染进程共享）
 */

/** 支持的数据库类型 */
export type DbType = 'mysql' | 'postgres' | 'sqlite' | 'redis'

/** 环境分级（驱动权限策略，对应 PRD M9） */
export type Environment = 'dev' | 'staging' | 'prod'

/** Redis 部署模式 */
export type RedisMode = 'single' | 'cluster' | 'sentinel'

/** 连接通用选项 */
export interface ConnectionOptions {
  /** 字符集（MySQL/PG） */
  charset?: string
  /** 启用 SSL */
  ssl?: boolean
  /** SSH 隧道配置（M2+ 再细化） */
  sshTunnel?: {
    host: string
    port: number
    username: string
    privateKey?: string
  }
  /** Redis 专属：部署模式 */
  redisMode?: RedisMode
  /** Redis 专属：cluster 节点列表（host:port） */
  redisNodes?: string[]
  /** 连接超时（毫秒） */
  connectTimeout?: number
  /** 额外的自定义参数（driver 透传） */
  extra?: Record<string, unknown>
}

/**
 * 连接配置（完整，含敏感字段）。
 * 注意：password 不在此结构中，单独由 CredentialStore 管理，
 * 避免密码意外随配置对象流转/序列化/落日志。
 */
export interface ConnectionConfig {
  id: string
  name: string
  type: DbType
  /** MySQL/PG/Redis 的主机；SQLite 为空 */
  host?: string
  /** MySQL/PG/Redis 的端口；SQLite 为空 */
  port?: number
  /** 用户名 */
  username?: string
  /** 库名 / Redis db index / SQLite 文件路径 */
  database?: string
  /** 连接选项 */
  options?: ConnectionOptions
  /** 环境分级 */
  environment: Environment
  /** 分组 ID（可选） */
  groupId?: string
  /** 用户标记颜色 */
  color?: string
  /** 排序序号 */
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * 连接列表项（给前端用，确保不含敏感信息）。
 * 结构与 ConnectionConfig 一致，因为 password 本就不在 config 里。
 * 单独定义以语义化区分，并预留未来脱敏字段。
 */
export interface ConnectionListItem {
  id: string
  name: string
  type: DbType
  host?: string
  port?: number
  username?: string
  database?: string
  options?: ConnectionOptions
  environment: Environment
  groupId?: string
  color?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 新建/编辑连接时的输入（不含 id 与时间戳） */
export interface ConnectionInput {
  name: string
  type: DbType
  host?: string
  port?: number
  username?: string
  /** 密码：create/update 时传入，单独存入 CredentialStore，不落库 */
  password?: string
  database?: string
  options?: ConnectionOptions
  environment: Environment
  groupId?: string
  color?: string
  sortOrder?: number
}

/** 测试连接的输入（不保存，只验证能否连上） */
export type ConnectionTestInput = Omit<
  ConnectionInput,
  'name' | 'environment' | 'groupId' | 'color' | 'sortOrder'
>

/** 测试连接的结果 */
export interface ConnectionTestResult {
  success: boolean
  message: string
  /** 连接成功时的服务器版本/信息 */
  serverInfo?: string
}
