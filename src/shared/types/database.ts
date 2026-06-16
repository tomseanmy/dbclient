/**
 * 数据库对象元数据类型（主进程与渲染进程共享）
 *
 * 各 DB 驱动（MySQL/PG/SQLite/Redis）查询系统表后，
 * 统一映射为这些类型，上层（UI / AI / MCP）无需感知差异。
 */

/** Schema / Database（库） */
export interface Schema {
  name: string
  /** 默认 schema 标记（PG 的 public 等） */
  isDefault?: boolean
}

/** 表或视图 */
export interface Table {
  /** 所属 schema 名（SQLite/Redis 可能为空） */
  schema?: string
  name: string
  /** 表还是视图 */
  type: 'table' | 'view'
  /** 行数估算（可能为 undefined，取决于驱动能否快速获取） */
  estimatedRows?: number
  /** 表注释 */
  comment?: string
}

/** 统一列类型（DB 原始类型映射到这个枚举，简化前端处理） */
export type UnifiedType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'time'
  | 'json'
  | 'binary'
  | 'enum'
  | 'uuid'
  | 'decimal'
  | 'other'

/** 列定义 */
export interface Column {
  name: string
  /** DB 原始类型名（如 varchar、bigint、timestamp） */
  dataType: string
  /** 映射后的统一类型 */
  unifiedType: UnifiedType
  /** 长度/精度（如 varchar(255) 的 255） */
  length?: number
  /** 小数位（decimal(10,2) 的 2） */
  scale?: number
  /** 是否可空 */
  nullable: boolean
  /** 是否主键 */
  isPrimaryKey: boolean
  /** 是否自增 */
  autoIncrement?: boolean
  /** 默认值 */
  defaultValue?: string | null
  /** 列注释 */
  comment?: string
  /** 枚举类型时的可选值 */
  enumValues?: string[]
}

/** 索引定义 */
export interface Index {
  name: string
  /** 索引包含的列 */
  columns: string[]
  /** 是否唯一索引 */
  isUnique: boolean
  /** 是否主键索引 */
  isPrimaryKey?: boolean
  /** 索引类型（如 btree、hash，PG 有 hash） */
  type?: string
}

/** 外键定义 */
export interface ForeignKey {
  name: string
  /** 本表的列 */
  columns: string[]
  /** 引用的表名 */
  referencesTable: string
  /** 引用表的列 */
  referencesColumns: string[]
  /** ON DELETE 行为 */
  onDelete?: string
  /** ON UPDATE 行为 */
  onUpdate?: string
}

/** describeTable 的完整返回 */
export interface TableMeta {
  schema?: string
  name: string
  type: 'table' | 'view'
  columns: Column[]
  indexes: Index[]
  foreignKeys: ForeignKey[]
  estimatedRows?: number
  comment?: string
  /** CREATE TABLE DDL（便于复制） */
  ddl?: string
}

/** 统一单元格值（查询结果渲染用，M1 先定义，M2 使用） */
export type CellValue = string | number | boolean | null | Uint8Array | object

/** 查询结果（M1 先定义，M2 使用） */
export interface QueryResult {
  columns: { name: string; dataType: string }[]
  rows: Record<string, CellValue>[]
  /** 实际返回行数 */
  rowCount: number
  /** 查询耗时（毫秒） */
  durationMs: number
  /** 非查询语句的反馈信息（如 "3 行受影响"） */
  message?: string
  /** 是否被截断（达到行数上限） */
  truncated?: boolean
}

/** Redis key 概览（Redis 专属，简化版） */
export interface RedisKeyOverview {
  /** 各 db index 的 key 数量 */
  databases: { index: number; keyCount: number }[]
  /** Redis 服务器信息 */
  serverInfo?: string
}

/** 连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** 数据库角色（用户/权限角色） */
export interface DatabaseRole {
  /** 角色名 / 用户名 */
  name: string
  /** 角色/用户类型描述（如 role、user） */
  kind?: string
  /** 可登录标记（部分 DB 区分角色与登录用户） */
  canLogin?: boolean
  /** 关联成员数（PG role 的 member count 等，无则省略） */
  memberCount?: number
  /** 注释 / 说明 */
  comment?: string
}

/** Redis key 类型 */
export type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream'
