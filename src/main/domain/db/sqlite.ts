/**
 * SQLite 驱动实现（基于 better-sqlite3）
 *
 * SQLite 用于两类场景：
 * 1. 应用本地库（M0 已建，走 infra/storage）
 * 2. 用户连接的目标 SQLite 文件（本驱动，用户数据库）
 * 两者共用 better-sqlite3 库，但是不同的 Database 实例。
 */
import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
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

// SQLite 原始类型（动态类型，实际存储类型由值决定）→ 统一类型映射
const TYPE_MAPPINGS: Record<string, UnifiedType> = {
  integer: 'integer',
  int: 'integer',
  real: 'number',
  double: 'number',
  float: 'number',
  text: 'string',
  char: 'string',
  varchar: 'string',
  blob: 'binary',
  numeric: 'decimal',
  decimal: 'decimal',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  timestamp: 'datetime',
  json: 'json',
}

export class SqliteDriver implements DbDriver {
  private db: DB | null = null

  async connect(ctx: DriverContext): Promise<void> {
    if (this.db) return
    const { config } = ctx
    const filePath = config.database
    if (!filePath) throw new Error('SQLite 连接需要指定数据库文件路径')
    this.db = new Database(filePath, { readonly: false })
  }

  async testConnection(ctx: DriverContext): Promise<{ serverInfo?: string }> {
    const { config } = ctx
    const filePath = config.database
    if (!filePath) throw new Error('SQLite 连接需要指定数据库文件路径')

    // 文件不存在时的处理
    if (!existsSync(filePath)) {
      // createIfNotExist 标志由前端传入（用户确认创建后）
      const shouldCreate = config.options?.extra?.createIfNotExist === true
      if (shouldCreate) {
        const dir = dirname(filePath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        const newDb = new Database(filePath)
        newDb.close()
      } else {
        // 抛出特殊错误，前端识别后提示「是否创建」
        const err = new Error('数据库文件不存在：' + filePath)
        err.name = 'FileNotFound'
        throw err
      }
    }

    const testDb = new Database(filePath, { readonly: true })
    try {
      const row = testDb.prepare('SELECT sqlite_version() AS version').get() as
        | { version: string }
        | undefined
      return { serverInfo: `SQLite ${row?.version ?? 'unknown'}` }
    } finally {
      testDb.close()
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  private getDb(): DB {
    if (!this.db) throw new Error('SQLite 未连接，请先 connect()')
    return this.db
  }

  async listSchemas(): Promise<Schema[]> {
    // SQLite 没有 schema 概念，返回单个 main
    return [{ name: 'main', isDefault: true }]
  }

  async listTables(_schema?: string): Promise<Table[]> {
    const db = this.getDb()
    const rows = db
      .prepare(
        `SELECT name, type, sql FROM sqlite_master
       WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
      )
      .all() as Array<{ name: string; type: string; sql: string | null }>

    const tables: Table[] = []
    for (const row of rows) {
      // 估算行数（轻量查询，大表可能慢，用 COUNT 但不强制）
      let estimatedRows: number | undefined
      try {
        const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM "${row.name}"`).get() as {
          cnt: number
        }
        estimatedRows = countRow.cnt
      } catch {
        // 视图或异常时跳过行数
      }
      tables.push({
        schema: 'main',
        name: row.name,
        type: row.type === 'view' ? 'view' : 'table',
        estimatedRows,
      })
    }
    return tables
  }

  async describeTable(opts: DescribeOptions): Promise<TableMeta> {
    const db = this.getDb()
    const table = opts.table

    // PRAGMA table_info 获取列基本信息
    const infoRows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      cid: number
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }>

    // PRAGMA table_xinfo 获取生成列信息（SQLite 3.26+）
    let extraRows: Array<{ name: string; hidden: number }> = []
    try {
      extraRows = db.prepare(`PRAGMA table_xinfo("${table}")`).all() as Array<{
        name: string
        hidden: number
      }>
    } catch {
      // 老版本不支持，忽略
    }
    const hiddenSet = new Set(extraRows.filter((r) => r.hidden === 2).map((r) => r.name))

    const columns: Column[] = infoRows
      .filter((r) => !hiddenSet.has(r.name))
      .map((c) => {
        // 解析类型名（如 "VARCHAR(255)" → "varchar" + length）
        const typeMatch = c.type.match(/^(\w+)(?:\s*\((\d+)(?:\s*,\s*(\d+))?\))?/i)
        const dataType = typeMatch?.[1]?.toLowerCase() ?? c.type.toLowerCase()
        const length = typeMatch?.[2] ? Number.parseInt(typeMatch[2], 10) : undefined
        return {
          name: c.name,
          dataType: c.type.toLowerCase() || dataType,
          unifiedType: mapUnifiedType(dataType, TYPE_MAPPINGS),
          length,
          nullable: c.notnull === 0,
          isPrimaryKey: c.pk > 0,
          defaultValue: c.dflt_value,
        }
      })

    // 索引
    const indexList = db.prepare(`PRAGMA index_list("${table}")`).all() as Array<{
      seq: number
      name: string
      unique: number
      origin: string
      partial: number
    }>
    const indexes: Index[] = []
    for (const idx of indexList) {
      const colRows = db.prepare(`PRAGMA index_info("${idx.name}")`).all() as Array<{
        seqno: number
        cid: number
        name: string
      }>
      indexes.push({
        name: idx.name,
        columns: colRows.map((c) => c.name),
        isUnique: idx.unique === 1,
        isPrimaryKey: idx.origin === 'pk',
        type: undefined,
      })
    }

    // 外键
    const fkRows = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
      id: number
      seq: number
      table: string
      from: string
      to: string
      on_update: string
      on_delete: string
      match: string
    }>
    // 按 id 分组（一个外键可能涉及多列）
    const fkMap = new Map<number, ForeignKey>()
    for (const r of fkRows) {
      const existing = fkMap.get(r.id)
      if (existing) {
        existing.columns.push(r.from)
        existing.referencesColumns.push(r.to)
      } else {
        fkMap.set(r.id, {
          name: `fk_${r.id}`,
          columns: [r.from],
          referencesTable: r.table,
          referencesColumns: [r.to],
          onDelete: r.on_delete,
          onUpdate: r.on_update,
        })
      }
    }

    // DDL
    const ddlRow = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?`)
      .get(table) as { sql: string | null } | undefined

    return {
      schema: 'main',
      name: table,
      type: 'table',
      columns,
      indexes,
      foreignKeys: [...fkMap.values()],
      ddl: ddlRow?.sql ?? undefined,
    }
  }
  async executeQuery(
    sql: string,
    opts?: import('./driver').QueryOptions,
  ): Promise<import('@shared/types/database').QueryResult> {
    const limit = opts?.limit ?? 1000
    const start = Date.now()
    const db = this.getDb()
    const stmt = db.prepare(sql)
    let rows: Record<string, unknown>[] = []
    let columns: { name: string; dataType: string }[] = []
    // SELECT 类语句用 all()，否则用 run()
    try {
      columns = stmt.columns().map((col) => ({
        name: col.name,
        dataType: col.type ?? 'unknown',
      }))
      const allRows = stmt.all() as Record<string, unknown>[]
      if (columns.length === 0 && allRows.length > 0) {
        columns = Object.keys(allRows[0]!).map((name) => ({
          name,
          dataType: typeof allRows[0]![name],
        }))
      }
      rows = allRows
    } catch {
      // 非 SELECT 语句（better-sqlite3 的 all() 对非查询会抛错）
      const info = stmt.run()
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - start,
        message: `${info.changes} 行受影响`,
      }
    }
    const truncated = rows.length > limit
    const limitedRows = rows.slice(0, limit) as Record<
      string,
      import('@shared/types/database').CellValue
    >[]
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
    const db = this.getDb()
    const info = db.prepare(sql).run()
    return { rowsAffected: info.changes }
  }
}
