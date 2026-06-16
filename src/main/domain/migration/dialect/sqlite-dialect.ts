/**
 * SQLite 方言 DDL/DML 生成器
 *
 * 标识符引用：双引号 "name"（SQLite 同时支持 []，统一用 "）
 * 布尔字面量：1 / 0（SQLite 无原生 BOOL）
 * 二进制：x'hex'
 * 自增：INTEGER PRIMARY KEY AUTOINCREMENT
 * 无独立 DROP INDEX 的 ALTER 改列（SQLite 限制多，modifyColumn 用简化策略）
 * 无 TRUNCATE：DELETE FROM（事务安全，D2 决策）
 */
import type { Column, ForeignKey, Index, TableMeta } from '@shared/types/database'
import type { MigrationDialect } from '@shared/types/migration'
import type { DialectGenerator } from './types'
import { defaultFragment, nullabilityFragment } from './types'
import { isBinary, scalarLiteral, stringLiteral } from './value-literal'

export class SqliteDialect implements DialectGenerator {
  readonly dialect: MigrationDialect = 'sqlite'

  quoteIdentifier(name: string): string {
    return '"' + name.replace(/"/g, '""') + '"'
  }

  typeString(column: Column): string {
    // enum 按决策 D1 降级为 TEXT
    if (column.unifiedType === 'enum') return 'TEXT'
    switch (column.unifiedType) {
      case 'string':
        // SQLite 不强制长度，但保留长度供可读性
        return column.length ? `VARCHAR(${column.length})` : 'TEXT'
      case 'integer':
        return 'INTEGER'
      case 'number':
        return 'REAL'
      case 'decimal':
        return 'NUMERIC'
      case 'boolean':
        return 'INTEGER'
      case 'datetime':
        return 'TEXT' // ISO8601 字符串
      case 'date':
        return 'TEXT'
      case 'time':
        return 'TEXT'
      case 'json':
        return 'TEXT' // 无原生 JSON 类型
      case 'binary':
        return 'BLOB'
      case 'uuid':
        return 'TEXT'
      default:
        return column.dataType.toUpperCase()
    }
  }

  columnDef(column: Column): string {
    const name = this.quoteIdentifier(column.name)
    // SQLite 自增主键必须是 INTEGER PRIMARY KEY AUTOINCREMENT
    if (column.autoIncrement && column.isPrimaryKey) {
      return `${name} INTEGER PRIMARY KEY AUTOINCREMENT`
    }
    const parts = [name, this.typeString(column)]
    const nn = nullabilityFragment(column)
    if (nn) parts.push(nn)
    const def = defaultFragment(column, (v) => this.literal(v))
    if (def) parts.push(def)
    return parts.join(' ')
  }

  createTable(meta: TableMeta): string {
    const cols = meta.columns.map((c) => '  ' + this.columnDef(c))
    const pkCols = meta.columns.filter((c) => c.isPrimaryKey && !c.autoIncrement)
    if (pkCols.length) {
      const pk = pkCols.map((c) => this.quoteIdentifier(c.name)).join(', ')
      cols.push(`  PRIMARY KEY (${pk})`)
    }
    return `CREATE TABLE ${this.quoteIdentifier(meta.name)} (\n${cols.join(',\n')}\n)`
  }

  dropTable(tableName: string): string {
    return `DROP TABLE IF EXISTS ${this.quoteIdentifier(tableName)}`
  }

  addColumn(tableName: string, column: Column): string {
    return `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD COLUMN ${this.columnDef(column)}`
  }

  modifyColumn(tableName: string, column: Column, _changes: Partial<Column>): string {
    // SQLite < 3.35 不支持 ALTER COLUMN。标准做法是"重建表"，成本高且复杂。
    // 这里返回注释提示，实际执行需调用方走"重建表"流程（P1 细化）。
    // M5 先以注释形式标注，避免生成无法执行的语句。
    return `-- SQLite 不支持直接修改列：${column.name}。需重建表（rename → create → copy → drop）`
  }

  dropColumn(tableName: string, columnName: string): string {
    // SQLite 3.35+ 支持 DROP COLUMN
    return `ALTER TABLE ${this.quoteIdentifier(tableName)} DROP COLUMN ${this.quoteIdentifier(columnName)}`
  }

  addIndex(tableName: string, index: Index): string {
    const cols = index.columns.map((c) => this.quoteIdentifier(c)).join(', ')
    const unique = index.isUnique ? 'UNIQUE ' : ''
    return `CREATE ${unique}INDEX ${this.quoteIdentifier(index.name)} ON ${this.quoteIdentifier(tableName)} (${cols})`
  }

  dropIndex(_tableName: string, indexName: string): string {
    return `DROP INDEX IF EXISTS ${this.quoteIdentifier(indexName)}`
  }

  addForeignKey(tableName: string, fk: ForeignKey): string {
    // SQLite ALTER TABLE 不支持 ADD FOREIGN KEY，需重建表。
    const cols = fk.columns.map((c) => this.quoteIdentifier(c)).join(', ')
    const refCols = fk.referencesColumns.map((c) => this.quoteIdentifier(c)).join(', ')
    return `-- SQLite 需重建表以添加外键 ${fk.name}\n-- FOREIGN KEY (${cols}) REFERENCES ${this.quoteIdentifier(fk.referencesTable)} (${refCols})`
  }

  dropForeignKey(tableName: string, fkName: string): string {
    return `-- SQLite 需重建表以删除外键 ${fkName}（表 ${tableName}）`
  }

  truncate(tableName: string): string {
    // D2 决策：fullReplace 默认 DELETE，可事务回滚
    return `DELETE FROM ${this.quoteIdentifier(tableName)}`
  }

  literal(value: unknown): string {
    const base = scalarLiteral(value as never)
    if (base !== null) return base
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (isBinary(value)) {
      const hex = Buffer.from(value).toString('hex')
      return `x'${hex}'`
    }
    return stringLiteral(String(value))
  }
}
