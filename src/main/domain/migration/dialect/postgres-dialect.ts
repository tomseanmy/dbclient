/**
 * PostgreSQL 方言 DDL/DML 生成器
 *
 * 标识符引用：双引号 "name"
 * 布尔字面量：TRUE / FALSE
 * 二进制：'\xhex'::bytea
 * SERIAL/BIGSERIAL 用于自增主键
 * 修改列用 ALTER COLUMN ... TYPE / SET NOT NULL（多条）
 */
import type { Column, ForeignKey, Index, TableMeta } from '@shared/types/database'
import type { MigrationDialect } from '@shared/types/migration'
import type { DialectGenerator } from './types'
import { defaultFragment, nullabilityFragment } from './types'
import { isBinary, scalarLiteral, stringLiteral } from './value-literal'

export class PostgresDialect implements DialectGenerator {
  readonly dialect: MigrationDialect = 'postgres'

  quoteIdentifier(name: string): string {
    return '"' + name.replace(/"/g, '""') + '"'
  }

  typeString(column: Column): string {
    // enum 按决策 D1 降级为 TEXT（PG 不建真枚举，简单可逆）
    if (column.unifiedType === 'enum') return 'TEXT'
    switch (column.unifiedType) {
      case 'string':
        return column.length ? `VARCHAR(${column.length})` : 'TEXT'
      case 'integer':
        return 'BIGINT'
      case 'number':
        return 'DOUBLE PRECISION'
      case 'decimal':
        return `NUMERIC(${column.length ?? 10},${column.scale ?? 2})`
      case 'boolean':
        return 'BOOLEAN'
      case 'datetime':
        return 'TIMESTAMP'
      case 'date':
        return 'DATE'
      case 'time':
        return 'TIME'
      case 'json':
        return 'JSONB'
      case 'binary':
        return 'BYTEA'
      case 'uuid':
        return 'UUID'
      default:
        return column.dataType.toUpperCase()
    }
  }

  columnDef(column: Column): string {
    // PG 自增主键用 BIGSERIAL/SERIAL，此时不输出 BIGINT
    if (column.autoIncrement && column.isPrimaryKey) {
      const serialType = column.unifiedType === 'integer' ? 'BIGSERIAL' : 'SERIAL'
      const parts = [this.quoteIdentifier(column.name), serialType, 'PRIMARY KEY']
      return parts.join(' ')
    }
    const parts = [this.quoteIdentifier(column.name), this.typeString(column)]
    const nn = nullabilityFragment(column)
    if (nn) parts.push(nn)
    const def = defaultFragment(column, (v) => this.literal(v))
    if (def) parts.push(def)
    return parts.join(' ')
  }

  createTable(meta: TableMeta): string {
    const cols = meta.columns.map((c) => '  ' + this.columnDef(c))
    // 仅在无 SERIAL 主键时显式声明 PRIMARY KEY
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

  modifyColumn(tableName: string, column: Column, changes: Partial<Column>): string {
    // PG 按"变了什么"拆成多条 ALTER COLUMN，更精确
    const stmts: string[] = []
    const col = this.quoteIdentifier(column.name)
    const tbl = this.quoteIdentifier(tableName)
    if (
      changes.unifiedType !== undefined ||
      changes.dataType !== undefined ||
      changes.length !== undefined
    ) {
      stmts.push(
        `ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE ${this.typeString(column)} USING ${col}::${this.typeString(column)}`,
      )
    }
    if (changes.nullable === false) {
      stmts.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} SET NOT NULL`)
    } else if (changes.nullable === true) {
      stmts.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} DROP NOT NULL`)
    }
    if (changes.defaultValue !== undefined) {
      if (changes.defaultValue === null) {
        stmts.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} DROP DEFAULT`)
      } else {
        stmts.push(
          `ALTER TABLE ${tbl} ALTER COLUMN ${col} SET DEFAULT ${this.literal(changes.defaultValue)}`,
        )
      }
    }
    // 无可识别变更时退化为完整类型覆盖
    if (stmts.length === 0) {
      stmts.push(
        `ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE ${this.typeString(column)} USING ${col}::${this.typeString(column)}`,
      )
    }
    return stmts.join(';\n')
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
    return `DROP INDEX IF EXISTS ${this.quoteIdentifier(indexName)}`
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
    return `ALTER TABLE ${this.quoteIdentifier(tableName)} DROP CONSTRAINT ${this.quoteIdentifier(fkName)}`
  }

  truncate(tableName: string): string {
    // fullReplace 默认走 DELETE（事务安全）；TRUNCATE 无法事务回滚，仅保留接口
    return `TRUNCATE TABLE ${this.quoteIdentifier(tableName)}`
  }

  literal(value: unknown): string {
    const base = scalarLiteral(value as never)
    if (base !== null) return base
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (isBinary(value)) {
      const hex = Buffer.from(value).toString('hex')
      return `'\\x${hex}'::bytea`
    }
    return stringLiteral(String(value))
  }
}
