/**
 * 本地 SQLite 数据库管理
 *
 * - 单例 getDb()，应用全局唯一连接
 * - WAL 模式，提升并发读
 * - 启动时自动执行未跑过的迁移
 *
 * 迁移加载方式：用 vite 的 import.meta.glob + ?raw 在编译期内联 SQL，
 * 这样 dev 和 build 产物行为一致，不依赖文件系统路径。
 *
 * 库文件位置：app.getPath('userData')/app.db
 */
import { app } from 'electron'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { logger } from '@main/infra/logger'

export type DB = Database.Database

let dbInstance: DB | null = null

/** 本地库文件路径 */
function dbPath(): string {
  return join(app.getPath('userData'), 'app.db')
}

// 编译期内联所有迁移 SQL（key 是相对路径，value 是 SQL 文本）
const migrationFiles = import.meta.glob<string>('./migrations/*.sql', {
  query: 'raw',
  eager: true,
  import: 'default',
})

/** 排序后的迁移列表：[{ version, sql }] */
const migrations = Object.entries(migrationFiles)
  .map(([path, sql]) => {
    const match = path.match(/(\d+)_/)
    return { version: match ? Number.parseInt(match[1]!, 10) : 0, sql }
  })
  .sort((a, b) => a.version - b.version)

/**
 * 执行迁移。
 * - 与 app_meta.schema_version 比对，执行未跑过的
 * - 每个迁移在一个事务内执行
 */
function runMigrations(db: DB): void {
  if (migrations.length === 0) {
    logger.warn('未找到迁移文件')
    return
  }

  // 确保 app_meta 表存在（001_init.sql 会建，但兜底）
  db.prepare(
    `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ).run()
  const row = db.prepare(`SELECT value FROM app_meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
  const currentVersion = row ? Number.parseInt(row.value, 10) : 0

  logger.info('当前 schema 版本', { version: currentVersion })

  let applied = 0
  for (const { version, sql } of migrations) {
    if (version <= currentVersion) continue

    const migrate = db.transaction(() => {
      db.exec(sql)
      db.prepare(
        `INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(String(version))
    })
    migrate()
    applied++
    logger.info('已执行迁移', { version })
  }

  if (applied === 0) {
    logger.info('无需迁移，schema 已是最新')
  }
}

/**
 * 初始化数据库。应用启动时调用一次。
 * 幂等：重复调用安全。
 */
export function initDb(): DB {
  if (dbInstance) return dbInstance

  const path = dbPath()
  logger.info('初始化本地数据库', { path })

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  dbInstance = db
  logger.info('本地数据库就绪')
  return db
}

/** 获取数据库单例（初始化后调用） */
export function getDb(): DB {
  if (!dbInstance) {
    throw new Error('数据库未初始化，请先调用 initDb()')
  }
  return dbInstance
}

/** 关闭数据库。应用退出前调用。 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
    logger.info('本地数据库已关闭')
  }
}
