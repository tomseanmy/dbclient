/**
 * MySQL 驱动实现（基于 mysql2）
 */
import mysql, { type FieldPacket, type Pool, type RowDataPacket } from 'mysql2/promise'
import type { DriverContext, DescribeOptions } from './driver'
import { mapUnifiedType } from './driver'
import type { DbDriver } from './driver'
import type {
  Schema,
  Table,
  TableMeta,
  Column,
  Index,
  ForeignKey,
  UnifiedType,
} from '@shared/types/database'

// MySQL 类型 → 统一类型映射
const TYPE_MAPPINGS: Record<string, UnifiedType> = {
  tinyint: 'integer',
  smallint: 'integer',
  mediumint: 'integer',
  int: 'integer',
  bigint: 'integer',
  bit: 'integer',
  float: 'number',
  double: 'number',
  decimal: 'decimal',
  numeric: 'decimal',
  char: 'string',
  varchar: 'string',
  tinytext: 'string',
  text: 'string',
  mediumtext: 'string',
  longtext: 'string',
  date: 'date',
  datetime: 'datetime',
  timestamp: 'datetime',
  time: 'time',
  year: 'integer',
  json: 'json',
  enum: 'enum',
  set: 'enum',
  binary: 'binary',
  varbinary: 'binary',
  blob: 'binary',
  tinyblob: 'binary',
  mediumblob: 'binary',
  longblob: 'binary',
}

export class MysqlDriver implements DbDriver {
  pool: Pool | null = null

  async connect(ctx: DriverContext): Promise<void> {
    if (this.pool) return
    const { config } = ctx
    this.pool = mysql.createPool({
      host: config.host ?? 'localhost',
      port: config.port ?? 3306,
      user: config.username,
      password: ctx.password ?? '',
      database: config.database,
      charset: config.options?.charset ?? 'utf8mb4',
      ssl: config.options?.ssl ? {} : undefined,
      connectTimeout: config.options?.connectTimeout ?? 10000,
      connectionLimit: 5,
      supportBigNumbers: true,
      bigNumberStrings: true,
    })
    // 验证连接
    const conn = await this.pool.getConnection()
    await conn.ping()
    conn.release()
  }

  async testConnection(ctx: DriverContext): Promise<{ serverInfo?: string }> {
    const { config } = ctx
    const conn = await mysql.createConnection({
      host: config.host ?? 'localhost',
      port: config.port ?? 3306,
      user: config.username,
      password: ctx.password ?? '',
      database: config.database,
      ssl: config.options?.ssl ? {} : undefined,
      connectTimeout: config.options?.connectTimeout ?? 10000,
    })
    try {
      const [rows] = (await conn.query('SELECT VERSION() AS version')) as [RowDataPacket[], unknown]
      const version = (rows as RowDataPacket[])[0]?.version
      return { serverInfo: `MySQL ${version ?? 'unknown'}` }
    } finally {
      await conn.end()
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
    }
  }

  private async query<T = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<T> {
    if (!this.pool) throw new Error('MySQL 未连接，请先 connect()')
    const [rows] = await this.pool.query(sql, params)
    return rows as T
  }

  async listSchemas(): Promise<Schema[]> {
    const rows = await this.query<Array<{ schema_name: string; is_default?: number }>>(
      `SELECT schema_name AS schema_name FROM information_schema.schemata ORDER BY schema_name`,
    )
    return rows.map((r) => ({ name: r.schema_name }))
  }

  async listTables(schema?: string): Promise<Table[]> {
    const targetSchema = schema ?? (await this.getCurrentDatabase())
    const rows = await this.query<
      Array<{ name: string; type: string; rows: number | null; comment: string | null }>
    >(
      `SELECT 
        table_name AS name,
        table_type AS type,
        table_rows AS rows,
        table_comment AS comment
       FROM information_schema.tables
       WHERE table_schema = ?
       ORDER BY table_name`,
      [targetSchema],
    )
    return rows.map((r) => ({
      schema: targetSchema,
      name: r.name,
      type: r.type === 'VIEW' ? 'view' : 'table',
      estimatedRows: r.rows ?? undefined,
      comment: r.comment || undefined,
    }))
  }

  async describeTable(opts: DescribeOptions): Promise<TableMeta> {
    const schema = opts.schema ?? (await this.getCurrentDatabase())
    const table = opts.table

    // 列信息
    const colRows = await this.query<
      Array<{
        name: string
        data_type: string
        length: number | null
        scale: number | null
        nullable: string
        key: string
        extra: string
        default: string | null
        comment: string | null
      }>
    >(
      `SELECT 
        column_name AS name,
        data_type AS data_type,
        character_maximum_length AS length,
        numeric_scale AS scale,
        is_nullable AS nullable,
        column_key AS key,
        extra AS extra,
        column_default AS \`default\`,
        column_comment AS comment
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ?
       ORDER BY ordinal_position`,
      [schema, table],
    )

    const columns: Column[] = colRows.map((c) => ({
      name: c.name,
      dataType: c.data_type,
      unifiedType: mapUnifiedType(c.data_type, TYPE_MAPPINGS),
      length: c.length ?? undefined,
      scale: c.scale ?? undefined,
      nullable: c.nullable === 'YES',
      isPrimaryKey: c.key === 'PRI',
      autoIncrement: c.extra.includes('auto_increment'),
      defaultValue: c.default,
      comment: c.comment || undefined,
    }))

    // 索引信息
    const idxRows = await this.query<
      Array<{ name: string; column: string; non_unique: number; key: string }>
    >(
      `SELECT index_name AS name, column_name AS column, non_unique AS non_unique, index_name AS key
       FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = ?
       ORDER BY index_name, seq_in_index`,
      [schema, table],
    )
    const indexMap = new Map<string, Index>()
    for (const r of idxRows) {
      const existing = indexMap.get(r.name)
      if (existing) {
        existing.columns.push(r.column)
      } else {
        indexMap.set(r.name, {
          name: r.name,
          columns: [r.column],
          isUnique: r.non_unique === 0,
          isPrimaryKey: r.name === 'PRIMARY',
        })
      }
    }

    // 外键信息
    const fkRows = await this.query<
      Array<{
        name: string
        column: string
        ref_table: string
        ref_column: string
        on_delete: string | null
        on_update: string | null
      }>
    >(
      `SELECT 
        constraint_name AS name,
        column_name AS column,
        referenced_table_name AS ref_table,
        referenced_column_name AS ref_column,
        delete_rule AS on_delete,
        update_rule AS on_update
       FROM information_schema.key_column_usage kcu
       JOIN information_schema.referential_constraints rc 
         ON kcu.constraint_name = rc.constraint_name 
         AND kcu.table_schema = rc.constraint_schema
       WHERE kcu.table_schema = ? AND kcu.table_name = ?`,
      [schema, table],
    )
    const fkMap = new Map<string, ForeignKey>()
    for (const r of fkRows) {
      const existing = fkMap.get(r.name)
      if (existing) {
        existing.columns.push(r.column)
        existing.referencesColumns.push(r.ref_column)
      } else {
        fkMap.set(r.name, {
          name: r.name,
          columns: [r.column],
          referencesTable: r.ref_table,
          referencesColumns: [r.ref_column],
          onDelete: r.on_delete ?? undefined,
          onUpdate: r.on_update ?? undefined,
        })
      }
    }

    return {
      schema,
      name: table,
      type: 'table',
      columns,
      indexes: [...indexMap.values()],
      foreignKeys: [...fkMap.values()],
    }
  }

  private async getCurrentDatabase(): Promise<string> {
    const rows = await this.query<Array<{ db: string }>>('SELECT DATABASE() AS db')
    const db = rows[0]?.db
    if (!db) throw new Error('无法确定当前数据库，请在连接配置中指定 database')
    return db
  }

  async executeQuery(
    sql: string,
    opts?: import('./driver').QueryOptions,
  ): Promise<import('@shared/types/database').QueryResult> {
    const limit = opts?.limit ?? 1000
    const start = Date.now()
    if (!this.pool) throw new Error('MySQL 未连接')
    const [result, fields] = await this.pool.query(sql)
    const rows = Array.isArray(result) ? (result as import('mysql2').RowDataPacket[]) : []
    let columns: { name: string; dataType: string }[] = (fields as FieldPacket[]).map((field) => ({
      name: field.name,
      dataType: field.typeName ?? String(field.columnType ?? 'unknown'),
    }))
    if (columns.length === 0 && rows.length > 0) {
      columns = Object.keys(rows[0]!).map((name) => ({
        name,
        dataType: typeof rows[0]![name],
      }))
    }
    const truncated = rows.length > limit
    const limitedRows = rows.slice(0, limit).map((r) => ({ ...r }))
    return {
      columns,
      rows: limitedRows,
      rowCount: limitedRows.length,
      durationMs: Date.now() - start,
      truncated,
    }
  }

  async executeStatement(
    sql: string,
    _opts?: import('./driver').QueryOptions,
  ): Promise<{ rowsAffected: number }> {
    if (!this.pool) throw new Error('MySQL 未连接')
    const [result] = await this.pool.query(sql)
    const rowsAffected =
      result && typeof result === 'object' && 'affectedRows' in result
        ? (result as { affectedRows: number }).affectedRows
        : 0
    return { rowsAffected }
  }
}
