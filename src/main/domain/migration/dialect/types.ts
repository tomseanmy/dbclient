/**
 * 方言 DDL/DML 生成器抽象
 *
 * 每种目标库（MySQL/PG/SQLite）实现此接口，
 * 将 DB 无关的列定义/索引/外键/值，转写成目标方言的 SQL 片段。
 *
 * 这是跨库迁移的"输出端"：统一 IR（TableMeta）→ 目标方言 SQL。
 */
import type { Column, ForeignKey, Index, TableMeta } from '@shared/types/database'
import type { MigrationDialect } from '@shared/types/migration'

/** 方言生成器统一接口 */
export interface DialectGenerator {
  /** 该生成器对应的方言 */
  readonly dialect: MigrationDialect

  // —— 列定义片段 ——
  /** 完整列定义片段：`col_name TYPE [NOT NULL] [DEFAULT x] [AUTOINCREMENT] [COMMENT ...]` */
  columnDef(column: Column): string
  /** 仅类型部分：`VARCHAR(255)` / `INTEGER` / `DECIMAL(10,2)` */
  typeString(column: Column): string

  // —— DDL：表级 ——
  createTable(meta: TableMeta): string
  dropTable(tableName: string): string

  // —— DDL：列级 ——
  addColumn(tableName: string, column: Column): string
  /** 修改列；changes 标注哪些属性变了（方言决定是否需要完整 REPLACE） */
  modifyColumn(tableName: string, column: Column, changes: Partial<Column>): string
  dropColumn(tableName: string, columnName: string): string

  // —— DDL：索引 ——
  addIndex(tableName: string, index: Index): string
  dropIndex(tableName: string, indexName: string): string

  // —— DDL：外键 ——
  addForeignKey(tableName: string, fk: ForeignKey): string
  dropForeignKey(tableName: string, fkName: string): string

  // —— DML：表清空（fullReplace 用）——
  /** SQLite 无事务安全的 TRUNCATE，用 DELETE；MySQL/PG 返回 TRUNCATE */
  truncate(tableName: string): string

  // —— DML：值字面量 ——
  /** 将 CellValue 转成目标方言 SQL 字面量（含转义） */
  literal(value: unknown): string

  // —— 标识符引用 ——
  /** 引用标识符：MySQL `` ` ``、PG `"`、SQLite `"` */
  quoteIdentifier(name: string): string
}

// ===== 各方言实现共享的纯函数辅助 =====

/**
 * 列的可空性片段。
 * SQLite/MySQL/PG 语法一致：NOT NULL 或留空。
 */
export function nullabilityFragment(column: Column): string {
  return column.nullable ? '' : 'NOT NULL'
}

/**
 * 默认值片段（多数方言共用语法；具体值由 dialect.literal 转写）。
 * MySQL 的 DEFAULT 与字面量拼接一致，PG 也一致。
 */
export function defaultFragment(column: Column, literalFn: (v: unknown) => string): string {
  if (column.defaultValue === undefined || column.defaultValue === null) {
    return column.nullable ? 'DEFAULT NULL' : ''
  }
  return `DEFAULT ${literalFn(column.defaultValue)}`
}
