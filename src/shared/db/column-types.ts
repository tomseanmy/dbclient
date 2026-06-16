/**
 * 各数据库预置列类型清单（编辑表结构时下拉选择用）
 *
 * 来源：各驱动的 TYPE_MAPPINGS + 官方类型体系。
 * 每个类型标注是否「需要长度」，前端据此启用/禁用长度单元格。
 *
 * - needsLength = true：类型带长度/精度，如 varchar(255)、decimal(10,2)
 * - needsLength = false：定长或无参类型，如 int、boolean、text
 *
 * decimal/numeric 同时支持长度（精度）与小数位（scale）。
 */
import type { TableDialect } from './alter-generator'

export interface ColumnTypeOption {
  /** 类型名（小写，生成 DDL 时由生成器 toUpperCase） */
  name: string
  /** 是否需要长度参数 */
  needsLength: boolean
  /** 是否需要小数位（仅 decimal/numeric 为 true） */
  needsScale?: boolean
  /** 分组（用于 select 的 optgroup） */
  group: 'integer' | 'number' | 'string' | 'datetime' | 'binary' | 'boolean' | 'other'
  /** 默认长度（新增该类型列时预填） */
  defaultLength?: number
  /** 默认小数位 */
  defaultScale?: number
}

/**
 * MySQL 列类型（覆盖 5.7 / 8.0 常用类型）
 * 参考：https://dev.mysql.com/doc/refman/8.0/en/data-types.html
 */
export const MYSQL_TYPES: ColumnTypeOption[] = [
  // 整数
  { name: 'tinyint', needsLength: false, group: 'integer' },
  { name: 'smallint', needsLength: false, group: 'integer' },
  { name: 'mediumint', needsLength: false, group: 'integer' },
  { name: 'int', needsLength: false, group: 'integer' },
  { name: 'bigint', needsLength: false, group: 'integer' },
  { name: 'bit', needsLength: true, group: 'integer', defaultLength: 1 },
  // 浮点/小数
  { name: 'float', needsLength: false, group: 'number' },
  { name: 'double', needsLength: false, group: 'number' },
  {
    name: 'decimal',
    needsLength: true,
    needsScale: true,
    group: 'number',
    defaultLength: 10,
    defaultScale: 2,
  },
  {
    name: 'numeric',
    needsLength: true,
    needsScale: true,
    group: 'number',
    defaultLength: 10,
    defaultScale: 2,
  },
  // 字符串
  { name: 'char', needsLength: true, group: 'string', defaultLength: 1 },
  { name: 'varchar', needsLength: true, group: 'string', defaultLength: 255 },
  { name: 'tinytext', needsLength: false, group: 'string' },
  { name: 'text', needsLength: false, group: 'string' },
  { name: 'mediumtext', needsLength: false, group: 'string' },
  { name: 'longtext', needsLength: false, group: 'string' },
  { name: 'enum', needsLength: false, group: 'string' },
  { name: 'set', needsLength: false, group: 'string' },
  // 时间
  { name: 'date', needsLength: false, group: 'datetime' },
  { name: 'datetime', needsLength: false, group: 'datetime' },
  { name: 'timestamp', needsLength: false, group: 'datetime' },
  { name: 'time', needsLength: false, group: 'datetime' },
  { name: 'year', needsLength: false, group: 'datetime' },
  // 二进制
  { name: 'binary', needsLength: true, group: 'binary', defaultLength: 1 },
  { name: 'varbinary', needsLength: true, group: 'binary', defaultLength: 255 },
  { name: 'tinyblob', needsLength: false, group: 'binary' },
  { name: 'blob', needsLength: false, group: 'binary' },
  { name: 'mediumblob', needsLength: false, group: 'binary' },
  { name: 'longblob', needsLength: false, group: 'binary' },
  // 其他
  { name: 'json', needsLength: false, group: 'other' },
]

/**
 * PostgreSQL 列类型（覆盖 10-16 常用类型）
 * 参考：https://www.postgresql.org/docs/current/datatype.html
 */
export const POSTGRES_TYPES: ColumnTypeOption[] = [
  // 整数
  { name: 'smallint', needsLength: false, group: 'integer' },
  { name: 'integer', needsLength: false, group: 'integer' },
  { name: 'bigint', needsLength: false, group: 'integer' },
  { name: 'serial', needsLength: false, group: 'integer' },
  { name: 'bigserial', needsLength: false, group: 'integer' },
  // 浮点/小数
  {
    name: 'decimal',
    needsLength: true,
    needsScale: true,
    group: 'number',
    defaultLength: 10,
    defaultScale: 2,
  },
  {
    name: 'numeric',
    needsLength: true,
    needsScale: true,
    group: 'number',
    defaultLength: 10,
    defaultScale: 2,
  },
  { name: 'real', needsLength: false, group: 'number' },
  { name: 'double precision', needsLength: false, group: 'number' },
  // 字符串
  { name: 'character varying', needsLength: true, group: 'string', defaultLength: 255 },
  { name: 'varchar', needsLength: true, group: 'string', defaultLength: 255 },
  { name: 'character', needsLength: true, group: 'string', defaultLength: 1 },
  { name: 'char', needsLength: true, group: 'string', defaultLength: 1 },
  { name: 'text', needsLength: false, group: 'string' },
  // 时间
  { name: 'date', needsLength: false, group: 'datetime' },
  { name: 'time', needsLength: false, group: 'datetime' },
  { name: 'time with time zone', needsLength: false, group: 'datetime' },
  { name: 'timestamp', needsLength: false, group: 'datetime' },
  { name: 'timestamp with time zone', needsLength: false, group: 'datetime' },
  { name: 'interval', needsLength: false, group: 'datetime' },
  // 布尔
  { name: 'boolean', needsLength: false, group: 'boolean' },
  // 二进制
  { name: 'bytea', needsLength: false, group: 'binary' },
  // 其他
  { name: 'uuid', needsLength: false, group: 'other' },
  { name: 'json', needsLength: false, group: 'other' },
  { name: 'jsonb', needsLength: false, group: 'other' },
  { name: 'money', needsLength: false, group: 'number' },
  { name: 'xml', needsLength: false, group: 'string' },
  { name: 'cidr', needsLength: false, group: 'other' },
  { name: 'inet', needsLength: false, group: 'other' },
  { name: 'macaddr', needsLength: false, group: 'other' },
]

/**
 * SQLite 列类型。
 *
 * SQLite 是动态类型系统，只有 5 个存储类：NULL/INTEGER/REAL/TEXT/BLOB。
 * 这些就是 SQLite 原生提供的全部列类型，不存在 varchar、decimal(10,2)、
 * tinyint 等其他数据库的类型——它们在 SQLite 中不是真实类型。
 * 参考：https://sqlite.org/datatype3.html
 */
export const SQLITE_TYPES: ColumnTypeOption[] = [
  { name: 'integer', needsLength: false, group: 'integer' },
  { name: 'real', needsLength: false, group: 'number' },
  { name: 'text', needsLength: false, group: 'string' },
  { name: 'blob', needsLength: false, group: 'binary' },
  { name: 'numeric', needsLength: false, group: 'number' },
]

/** 分组标签（中文） */
export const GROUP_LABELS: Record<ColumnTypeOption['group'], string> = {
  integer: '整数',
  number: '小数/浮点',
  string: '字符串',
  datetime: '日期时间',
  binary: '二进制',
  boolean: '布尔',
  other: '其他',
}

/** 按方言获取预置类型清单 */
export function getColumnTypes(dialect: TableDialect): ColumnTypeOption[] {
  switch (dialect) {
    case 'mysql':
      return MYSQL_TYPES
    case 'postgres':
      return POSTGRES_TYPES
    case 'sqlite':
      return SQLITE_TYPES
  }
}

/** 按分组组织（用于 <optgroup>） */
export function getColumnTypesGrouped(
  dialect: TableDialect,
): { label: string; options: ColumnTypeOption[] }[] {
  const all = getColumnTypes(dialect)
  const groups: ColumnTypeOption['group'][] = [
    'integer',
    'number',
    'string',
    'datetime',
    'boolean',
    'binary',
    'other',
  ]
  return groups
    .map((g) => ({
      label: GROUP_LABELS[g],
      options: all.filter((t) => t.group === g),
    }))
    .filter((g) => g.options.length > 0)
}

/** 查找某类型的选项定义（类型名小写匹配） */
export function findTypeOption(
  dialect: TableDialect,
  typeName: string,
): ColumnTypeOption | undefined {
  return getColumnTypes(dialect).find((t) => t.name === typeName.toLowerCase())
}

/** 判断某类型是否需要长度（未在清单内的保守判为 false） */
export function typeNeedsLength(dialect: TableDialect, typeName: string): boolean {
  return findTypeOption(dialect, typeName)?.needsLength ?? false
}
