/**
 * PostgreSQL 驱动实现（基于 pg）
 */
import pg from 'pg'
import type { Pool, QueryResultRow } from 'pg'
const { Pool: PgPool } = pg
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

// PostgreSQL 类型 → 统一类型映射
const TYPE_MAPPINGS: Record<string, UnifiedType> = {
  // 整数
  smallint: 'integer',
  int2: 'integer',
  integer: 'integer',
  int4: 'integer',
  bigint: 'integer',
  int8: 'integer',
  serial: 'integer',
  bigserial: 'integer',
  // 浮点/小数
  decimal: 'decimal',
  numeric: 'decimal',
  real: 'number',
  float4: 'number',
  'double precision': 'number',
  float8: 'number',
  // 字符串
  'character varying': 'string',
  varchar: 'string',
  character: 'string',
  char: 'string',
  text: 'string',
  // 时间
  date: 'date',
  time: 'time',
  'time without time zone': 'time',
  'time with time zone': 'time',
  timestamp: 'datetime',
  'timestamp without time zone': 'datetime',
  'timestamp with time zone': 'datetime',
  timestamptz: 'datetime',
  // 其他
  boolean: 'boolean',
  bool: 'boolean',
  bytea: 'binary',
  json: 'json',
  jsonb: 'json',
  uuid: 'uuid',
}

export class PostgresDriver implements DbDriver {
  pool: Pool | null = null

  /** 构造 pg 连接配置（password 为空时不包含该字段，避免 SASL 报错） */
  private buildConnConfig(ctx: DriverContext): Record<string, unknown> {
    const { config } = ctx
    const opts: Record<string, unknown> = {
      host: config.host ?? 'localhost',
      port: config.port ?? 5432,
      user: config.username,
      database: config.database,
      ssl: config.options?.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: config.options?.connectTimeout ?? 10000,
    }
    // 只有密码非空时才传，pg 不接受 undefined/null
    if (ctx.password) {
      opts.password = ctx.password
    }
    return opts
  }

  async connect(ctx: DriverContext): Promise<void> {
    if (this.pool) return
    this.pool = new PgPool({ ...this.buildConnConfig(ctx), max: 5 })
    const client = await this.pool.connect()
    client.release()
  }

  async testConnection(ctx: DriverContext): Promise<{ serverInfo?: string }> {
    const client = new pg.Client(this.buildConnConfig(ctx))
    await client.connect()
    try {
      const res = await client.query('SELECT version() AS version')
      return { serverInfo: res.rows[0]?.version ?? 'PostgreSQL' }
    } finally {
      await client.end()
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
    }
  }

  private async query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.pool) throw new Error('PostgreSQL 未连接，请先 connect()')
    const res = await this.pool.query<T>(sql, params)
    return res.rows
  }

  async listSchemas(): Promise<Schema[]> {
    const rows = await this.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       ORDER BY schema_name`,
    )
    return rows.map((r) => ({
      name: r.schema_name,
      isDefault: r.schema_name === 'public',
    }))
  }

  async listTables(schema?: string): Promise<Table[]> {
    const targetSchema = schema ?? 'public'
    const rows = await this.query<{
      name: string
      type: string
      rows: string | null
      comment: string | null
    }>(
      `SELECT 
        table_name AS name,
        CASE table_type WHEN 'BASE TABLE' THEN 'table' ELSE 'view' END AS type,
        (SELECT reltuples::bigint FROM pg_class c, pg_namespace n
         WHERE c.relname = t.table_name AND n.nspname = t.table_schema
         AND c.relnamespace = n.oid) AS rows,
        obj_description(
          (quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass
        ) AS comment
       FROM information_schema.tables t
       WHERE t.table_schema = $1
       ORDER BY t.table_name`,
      [targetSchema],
    )
    return rows.map((r) => ({
      schema: targetSchema,
      name: r.name,
      type: r.type === 'view' ? 'view' : 'table',
      estimatedRows: r.rows ? Number.parseInt(r.rows, 10) : undefined,
      comment: r.comment || undefined,
    }))
  }

  async describeTable(opts: DescribeOptions): Promise<TableMeta> {
    const schema = opts.schema ?? 'public'
    const table = opts.table

    const colRows = await this.query<{
      name: string
      data_type: string
      length: number | null
      scale: number | null
      nullable: string
      default: string | null
      comment: string | null
      max_length: number | null
    }>(
      `SELECT 
        c.column_name AS name,
        c.data_type AS data_type,
        c.character_maximum_length AS length,
        c.numeric_precision_radix AS max_length,
        c.numeric_scale AS scale,
        c.is_nullable AS nullable,
        c.column_default AS default,
        col_description(
          (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass,
          c.ordinal_position
        ) AS comment
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [schema, table],
    )

    // 主键列
    const pkRows = await this.query<{ name: string }>(
      `SELECT kcu.column_name AS name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = $1 AND tc.table_name = $2`,
      [schema, table],
    )
    const pkSet = new Set(pkRows.map((r) => r.name))

    const columns: Column[] = colRows.map((c) => ({
      name: c.name,
      dataType: c.data_type,
      unifiedType: mapUnifiedType(c.data_type, TYPE_MAPPINGS),
      length: c.length ?? undefined,
      scale: c.scale ?? undefined,
      nullable: c.nullable === 'YES',
      isPrimaryKey: pkSet.has(c.name),
      autoIncrement: c.default?.startsWith('nextval('),
      defaultValue: c.default,
      comment: c.comment || undefined,
    }))

    // 索引信息
    const idxRows = await this.query<{
      name: string
      column: string
      is_unique: boolean
      is_primary: boolean
    }>(
      `SELECT
        i.relname AS name,
        a.attname AS column,
        indisunique AS is_unique,
        indisprimary AS is_primary
       FROM pg_index x
       JOIN pg_class c ON c.oid = x.indrelid
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(x.indkey)
       WHERE n.nspname = $1 AND c.relname = $2
       ORDER BY i.relname, a.attnum`,
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
          isUnique: r.is_unique,
          isPrimaryKey: r.is_primary,
        })
      }
    }

    // 外键信息
    const fkRows = await this.query<{
      name: string
      column: string
      ref_table: string
      ref_column: string
      on_delete: string | null
      on_update: string | null
    }>(
      `SELECT
        con.conname AS name,
        a.attname AS column,
        ref.relname AS ref_table,
        af.attname AS ref_column,
        con.confdeltype AS on_delete,
        con.confupdtype AS on_update
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_class ref ON ref.oid = con.confrelid
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = con.conkey[1]
       JOIN pg_attribute af ON af.attrelid = ref.oid AND af.attnum = con.confkey[1]
       WHERE n.nspname = $1 AND c.relname = $2 AND con.contype = 'f'`,
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
  async executeQuery(
    sql: string,
    opts?: import('./driver').QueryOptions,
  ): Promise<import('@shared/types/database').QueryResult> {
    const limit = opts?.limit ?? 1000
    const start = Date.now()
    if (!this.pool) throw new Error('PostgreSQL 未连接')
    const res = await this.pool.query(sql)
    const columns = res.fields.map((f) => ({
      name: f.name,
      dataType: String(f.dataTypeID ?? 'unknown'),
    }))
    const truncated = res.rows.length > limit
    const limitedRows = res.rows.slice(0, limit).map((r) => ({ ...r }))
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
    if (!this.pool) throw new Error('PostgreSQL 未连接')
    const res = await this.pool.query(sql)
    return { rowsAffected: res.rowCount ?? 0 }
  }
}
