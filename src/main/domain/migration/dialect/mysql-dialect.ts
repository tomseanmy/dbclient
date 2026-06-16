/**
 * MySQL 方言 DDL/DML 生成器
 *
 * 标识符引用：反引号 `name`
 * 布尔字面量：0 / 1（MySQL 无原生 BOOL，TINYINT(1)）
 * 二进制：x'hex' 或 _binary '...'
 * AUTO_INCREMENT 关键字
 */
import type { Column, ForeignKey, Index, TableMeta } from '@shared/types/database'
import type { MigrationDialect } from '@shared/types/migration'
import type { DialectGenerator } from './types'
import { defaultFragment, nullabilityFragment } from './types'
import { isBinary, scalarLiteral, stringLiteral } from './value-literal'

export class MysqlDialect implements DialectGenerator {
  readonly dialect: MigrationDialect = 'mysql'

  quoteIdentifier(name: string): string {
    return '`' + name.replace(/`/g, '``') + '`'
  }

  typeString(column: Column): string {
    // enum 按决策 D1 降级为 VARCHAR(n)
    if (column.unifiedType === 'enum') {
      const maxLen = Math.max(1, ...(column.enumValues ?? []).map((v) => v.length))
      return `VARCHAR(${maxLen})`
    }
    switch (column.unifiedType) {
      case 'string':
        return column.length ? `VARCHAR(${column.length})` : 'TEXT'
      case 'integer':
        return 'BIGINT'
      case 'number':
        return 'DOUBLE'
      case 'decimal':
        return `DECIMAL(${column.length ?? 10},${column.scale ?? 2})`
      case 'boolean':
        return 'TINYINT(1)'
      case 'datetime':
        return 'DATETIME'
      case 'date':
        return 'DATE'
      case 'time':
        return 'TIME'
      case 'json':
        return 'JSON'
      case 'binary':
        return column.length ? `VARBINARY(${column.length})` : 'BLOB'
      case 'uuid':
        return 'CHAR(36)'
      default:
        return column.dataType.toUpperCase()
    }
  }

  columnDef(column: Column): string {
    const parts = [this.quoteIdentifier(column.name), this.typeString(column)]
    const nn = nullabilityFragment(column)
    if (nn) parts.push(nn)
    if (column.autoIncrement) parts.push('AUTO_INCREMENT')
    const def = defaultFragment(column, (v) => this.literal(v))
    if (def) parts.push(def)
    if (column.comment) parts.push(`COMMENT ${stringLiteral(column.comment)}`)
    return parts.join(' ')
  }

  createTable(meta: TableMeta): string {
    const cols = meta.columns.map((c) => '  ' + this.columnDef(c))
    // 主键约束
    const pk = meta.columns.filter((c) => c.isPrimaryKey).map((c) => this.quoteIdentifier(c.name))
    if (pk.length) cols.push(`  PRIMARY KEY (${pk.join(', ')})`)
    let sql = `CREATE TABLE ${this.quoteIdentifier(meta.name)} (\n${cols.join(',\n')}\n)`
    if (meta.comment) sql += ` COMMENT ${stringLiteral(meta.comment)}`
    return sql
  }

  dropTable(tableName: string): string {
    return `DROP TABLE IF EXISTS ${this.quoteIdentifier(tableName)}`
  }

  addColumn(tableName: string, column: Column): string {
    return `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD COLUMN ${this.columnDef(column)}`
  }

  modifyColumn(tableName: string, column: Column, _changes: Partial<Column>): string {
    // MySQL MODIFY 需要完整列定义
    return `ALTER TABLE ${this.quoteIdentifier(tableName)} MODIFY COLUMN ${this.columnDef(column)}`
  }

  dropColumn(tableName: string, columnName: string): string {
    return `ALTER TABLE ${this.quoteIdentifier(tableName)} DROP COLUMN ${this.quoteIdentifier(columnName)}`
  }

  addIndex(tableName: string, index: Index): string {
    const cols = index.columns.map((c) => this.quoteIdentifier(c)).join(', ')
    const unique = index.isUnique ? 'UNIQUE ' : ''
    return `CREATE ${unique}INDEX ${this.quoteIdentifier(index.name)} ON ${this.quoteIdentifier(tableName)} (${cols})`
  }

  dropIndex(_tableName: string, indexName: string): string {
    return `DROP INDEX ${this.quoteIdentifier(indexName)}`
  }

  addForeignKey(tableName: string, fk: ForeignKey): string {
    const cols = fk.columns.map((c) => this.quoteIdentifier(c)).join(', ')
    const refCols = fk.referencesColumns.map((c) => this.quoteIdentifier(c)).join(', ')
    const parts = [
      `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD CONSTRAINT ${this.quoteIdentifier(fk.name)}`,
      `FOREIGN KEY (${cols}) REFERENCES ${this.quoteIdentifier(fk.referencesTable)} (${refCols})`,
    ]
    if (fk.onDelete) parts.push(`ON DELETE ${fk.onDelete}`)
    if (fk.onUpdate) parts.push(`ON UPDATE ${fk.onUpdate}`)
    return parts.join(' ')
  }

  dropForeignKey(tableName: string, fkName: string): string {
    return `ALTER TABLE ${this.quoteIdentifier(tableName)} DROP FOREIGN KEY ${this.quoteIdentifier(fkName)}`
  }

  truncate(tableName: string): string {
    return `TRUNCATE TABLE ${this.quoteIdentifier(tableName)}`
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
