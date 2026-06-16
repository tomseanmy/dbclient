/**
 * 表结构编辑：diff + ALTER 语句生成器（纯函数，无副作用）
 *
 * 输入「原始 TableMeta」与「编辑后草稿」，按稳定内部 id 对齐行，
 * 产出三类（列 / 索引 / 外键）的 added/removed/changed 集合，
 * 再翻译为目标方言的有序 ALTER 语句数组。
 *
 * 设计要点：
 * - 完全纯函数，便于单测覆盖；不依赖 DOM / IPC / 驱动。
 * - 草稿类型（带 _id）局限在本模块 + 编辑组件，不污染公共 Column/Index/ForeignKey。
 * - SQLite 不支持直接改列类型 / 可空 / 默认（需重建表），对这类变更产出 unsupported[]，
 *   前端据此提示用户手动处理，而非静默失败。
 * - 生成的语句是「单条」数组；前端合并脚本仅用于一次安全预检（db:checkSql），
 *   实际执行按方言逐条走 db:executeStatement / db:confirmExecute。
 */
import type { Column, ForeignKey, Index, TableMeta } from '../types/database'

/** 支持编辑的方言（Redis 无 SQL，view 不改结构） */
export type TableDialect = 'mysql' | 'postgres' | 'sqlite'

// ===== 草稿类型（编辑组件内部使用，带稳定 _id） =====

export interface DraftColumn extends Column {
  /** 稳定内部 id（原始列用列名，新增列用临时 id），diff 据此对齐 */
  _id: string
  /** 标记删除（不立即从数组移除，便于 diff 与 UI 高亮） */
  _removed?: boolean
}

export interface DraftIndex extends Index {
  _id: string
  _removed?: boolean
}

export interface DraftForeignKey extends ForeignKey {
  _id: string
  _removed?: boolean
}

export interface DraftTableMeta {
  schema?: string
  name: string
  columns: DraftColumn[]
  indexes: DraftIndex[]
  foreignKeys: DraftForeignKey[]
}

// ===== diff 结果 =====

export interface ColumnDiff {
  added: DraftColumn[]
  removed: Column[]
  /** 列已存在但属性变化（含改名） */
  changed: { original: Column; draft: DraftColumn; field: keyof Column }[]
}
export interface IndexDiff {
  added: DraftIndex[]
  removed: Index[]
  /** 属性变化：以 drop+recreate 处理（跨方言最稳） */
  changed: { original: Index; draft: DraftIndex }[]
}
export interface ForeignKeyDiff {
  added: DraftForeignKey[]
  removed: ForeignKey[]
  changed: { original: ForeignKey; draft: DraftForeignKey }[]
}

export interface TableMetaDiff {
  columns: ColumnDiff
  indexes: IndexDiff
  foreignKeys: ForeignKeyDiff
}

// ===== 生成结果 =====

export interface UnsupportedChange {
  /** 人类可读的原因（前端展示） */
  reason: string
}

export interface AlterResult {
  /** 有序 ALTER 语句数组（每条独立语句） */
  statements: string[]
  /** 当前方言无法表达的变更（SQLite 改类型等），前端提示用户手动处理 */
  unsupported: UnsupportedChange[]
}

// ===== 草稿构造（把原始 TableMeta 转为可编辑草稿） =====

/** 用列名作 _id（原始列对齐用）。新增列用 genDraftId 生成。 */
export function toDraftMeta(meta: TableMeta): DraftTableMeta {
  return {
    schema: meta.schema,
    name: meta.name,
    columns: meta.columns.map((c) => ({ ...c, _id: c.name })),
    indexes: meta.indexes.map((i) => ({ ...i, _id: i.name })),
    foreignKeys: meta.foreignKeys.map((f) => ({ ...f, _id: f.name })),
  }
}

/** 生成新增行的临时 _id */
export function genDraftId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

// ===== diff =====

/** 字段是否变化（排除 _id / _removed 等内部字段） */
function columnChanged(a: Column, b: DraftColumn): boolean {
  return (
    a.name !== b.name ||
    a.dataType !== b.dataType ||
    a.length !== b.length ||
    a.scale !== b.scale ||
    a.nullable !== b.nullable ||
    a.isPrimaryKey !== b.isPrimaryKey ||
    !!a.autoIncrement !== !!b.autoIncrement ||
    (a.defaultValue ?? null) !== (b.defaultValue ?? null) ||
    (a.comment ?? null) !== (b.comment ?? null)
  )
}

function indexChanged(a: Index, b: DraftIndex): boolean {
  return (
    a.name !== b.name ||
    a.columns.join(',') !== b.columns.join(',') ||
    !!a.isUnique !== !!b.isUnique ||
    !!a.isPrimaryKey !== !!b.isPrimaryKey
  )
}

function fkChanged(a: ForeignKey, b: DraftForeignKey): boolean {
  return (
    a.name !== b.name ||
    a.columns.join(',') !== b.columns.join(',') ||
    a.referencesTable !== b.referencesTable ||
    a.referencesColumns.join(',') !== b.referencesColumns.join(',') ||
    (a.onDelete ?? 'NO ACTION') !== (b.onDelete ?? 'NO ACTION')
  )
}

export function diffTableMeta(original: TableMeta, draft: DraftTableMeta): TableMetaDiff {
  // ----- 列 -----
  const origColMap = new Map(original.columns.map((c) => [c.name, c]))
  const columns: ColumnDiff = { added: [], removed: [], changed: [] }
  const seenOrig = new Set<string>()
  for (const d of draft.columns) {
    const orig = origColMap.get(d._id)
    if (orig) {
      seenOrig.add(d._id)
      if (d._removed) {
        columns.removed.push(orig)
      } else if (columnChanged(orig, d)) {
        // 找出第一个变化的字段名（用于 UI 提示）
        const fields: (keyof Column)[] = [
          'name',
          'dataType',
          'length',
          'scale',
          'nullable',
          'isPrimaryKey',
          'autoIncrement',
          'defaultValue',
          'comment',
        ]
        const field =
          fields.find((f) => {
            const ov = orig[f]
            const nv = d[f]
            return (ov ?? null) !== (nv ?? null)
          }) ?? 'name'
        columns.changed.push({ original: orig, draft: d, field })
      }
    } else if (!d._removed) {
      columns.added.push(d)
    }
  }
  for (const c of original.columns) {
    if (!seenOrig.has(c.name)) columns.removed.push(c)
  }

  // ----- 索引（以 name 对齐） -----
  const origIdxMap = new Map(original.indexes.map((i) => [i.name, i]))
  const indexes: IndexDiff = { added: [], removed: [], changed: [] }
  const seenIdx = new Set<string>()
  for (const d of draft.indexes) {
    const orig = origIdxMap.get(d._id)
    if (orig) {
      seenIdx.add(d._id)
      if (d._removed) indexes.removed.push(orig)
      else if (indexChanged(orig, d)) indexes.changed.push({ original: orig, draft: d })
    } else if (!d._removed) {
      indexes.added.push(d)
    }
  }
  for (const i of original.indexes) {
    if (!seenIdx.has(i.name)) indexes.removed.push(i)
  }

  // ----- 外键（以 name 对齐） -----
  const origFkMap = new Map(original.foreignKeys.map((f) => [f.name, f]))
  const foreignKeys: ForeignKeyDiff = { added: [], removed: [], changed: [] }
  const seenFk = new Set<string>()
  for (const d of draft.foreignKeys) {
    const orig = origFkMap.get(d._id)
    if (orig) {
      seenFk.add(d._id)
      if (d._removed) foreignKeys.removed.push(orig)
      else if (fkChanged(orig, d)) foreignKeys.changed.push({ original: orig, draft: d })
    } else if (!d._removed) {
      foreignKeys.added.push(d)
    }
  }
  for (const f of original.foreignKeys) {
    if (!seenFk.has(f.name)) foreignKeys.removed.push(f)
  }

  return { columns, indexes, foreignKeys }
}

// ===== 引用辅助 =====

/** 带可选 schema 前缀的表引用标识符（按方言转义） */
function tableRef(dialect: TableDialect, schema: string | undefined, table: string): string {
  return schema ? `${qIdent(dialect, schema)}.${qIdent(dialect, table)}` : qIdent(dialect, table)
}

/** 标识符转义：MySQL 反引号，PG/SQLite 双引号 */
function qIdent(dialect: TableDialect, name: string): string {
  const ch = dialect === 'mysql' ? '`' : '"'
  // 转义标识符内出现的引号字符（MySQL ``、PG/SQLite ""）
  const escaped = name.split(ch).join(ch + ch)
  return `${ch}${escaped}${ch}`
}

/** 字面量转义（默认值等） */
function quoteLiteral(v: string): string {
  return `'${v.split("'").join("''")}'`
}

/** 组装列类型字符串（如 VARCHAR(255)、DECIMAL(10,2)） */
export function columnTypeStr(c: { dataType: string; length?: number; scale?: number }): string {
  const t = c.dataType.toUpperCase()
  if (c.length != null && c.scale != null) return `${t}(${c.length}, ${c.scale})`
  if (c.length != null) return `${t}(${c.length})`
  return t
}

/** 完整列定义片段（用于 ADD COLUMN / MySQL MODIFY） */
function columnDefFragment(
  dialect: TableDialect,
  c: {
    name: string
    dataType: string
    length?: number
    scale?: number
    nullable: boolean
    defaultValue?: string | null
    autoIncrement?: boolean
    comment?: string
  },
): string {
  const parts: string[] = [qIdent(dialect, c.name), columnTypeStr(c)]
  if (!c.nullable) parts.push('NOT NULL')
  if (c.autoIncrement) parts.push(dialect === 'mysql' ? 'AUTO_INCREMENT' : '')
  if (c.defaultValue != null && c.defaultValue !== '') {
    parts.push(`DEFAULT ${literalOrDefault(dialect, c.defaultValue)}`)
  }
  const frag = parts.filter((s) => s.length > 0).join(' ')
  // 注释仅在 MySQL 列定义内联；PG/SQLite 用独立语句
  if (dialect === 'mysql' && c.comment) {
    return `${frag} COMMENT ${quoteLiteral(c.comment)}`
  }
  return frag
}

/** 判断默认值是表达式还是字面量（CURRENT_TIMESTAMP 等不加引号） */
function literalOrDefault(dialect: TableDialect, v: string): string {
  const upper = v.trim().toUpperCase()
  const exprs = ['CURRENT_TIMESTAMP', 'NOW()', 'CURRENT_DATE', 'CURRENT_TIME']
  if (exprs.includes(upper)) return upper
  // 数字字面量
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  return quoteLiteral(v)
}

// ===== 各方言生成 =====

function buildColumnStatements(
  dialect: TableDialect,
  schema: string | undefined,
  table: string,
  diff: ColumnDiff,
): { stmts: string[]; unsupported: UnsupportedChange[] } {
  const stmts: string[] = []
  const unsupported: UnsupportedChange[] = []
  const tbl = tableRef(dialect, schema, table)

  // 删除（顺序：先删，避免与新增同名冲突）
  for (const c of diff.removed) {
    stmts.push(`ALTER TABLE ${tbl} DROP COLUMN ${qIdent(dialect, c.name)}`)
  }

  // 新增
  for (const c of diff.added) {
    stmts.push(`ALTER TABLE ${tbl} ADD COLUMN ${columnDefFragment(dialect, c)}`)
  }

  // 改名 / 改属性
  for (const { original, draft } of diff.changed) {
    const renamed = original.name !== draft.name

    if (renamed) {
      if (dialect === 'mysql') {
        // CHANGE COLUMN old new <完整定义>
        stmts.push(
          `ALTER TABLE ${tbl} CHANGE COLUMN ${qIdent(dialect, original.name)} ${columnDefFragment(dialect, draft)}`,
        )
        continue // CHANGE 已带全部新属性
      }
      // PG / SQLite 用 RENAME COLUMN
      stmts.push(
        `ALTER TABLE ${tbl} RENAME COLUMN ${qIdent(dialect, original.name)} TO ${qIdent(dialect, draft.name)}`,
      )
    }

    // 改类型 / 可空 / 默认 / 主键（改名后用新名）
    const colName = qIdent(dialect, draft.name)
    const typeChanged =
      original.dataType !== draft.dataType ||
      original.length !== draft.length ||
      original.scale !== draft.scale
    const nullableChanged = original.nullable !== draft.nullable
    const defaultChanged = (original.defaultValue ?? null) !== (draft.defaultValue ?? null)

    if (dialect === 'sqlite') {
      // SQLite 不支持直接改列定义，除 RENAME/DROP/ADD 外需重建表
      if (typeChanged || nullableChanged || defaultChanged) {
        unsupported.push({
          reason: `SQLite 不支持直接修改列 "${draft.name}" 的类型/可空/默认值，请通过重建表完成（导出数据 → CREATE 新表 → INSERT → DROP 旧表）`,
        })
      }
    } else if (dialect === 'mysql') {
      // MySQL: 类型/可空/默认 任一变化都用 MODIFY 一次性改
      if (typeChanged || nullableChanged || defaultChanged) {
        stmts.push(`ALTER TABLE ${tbl} MODIFY COLUMN ${columnDefFragment(dialect, draft)}`)
      }
    } else {
      // PostgreSQL: 各自独立语句
      if (typeChanged) {
        stmts.push(`ALTER TABLE ${tbl} ALTER COLUMN ${colName} TYPE ${columnTypeStr(draft)}`)
      }
      if (nullableChanged) {
        stmts.push(
          draft.nullable
            ? `ALTER TABLE ${tbl} ALTER COLUMN ${colName} DROP NOT NULL`
            : `ALTER TABLE ${tbl} ALTER COLUMN ${colName} SET NOT NULL`,
        )
      }
      if (defaultChanged) {
        if (draft.defaultValue == null || draft.defaultValue === '') {
          stmts.push(`ALTER TABLE ${tbl} ALTER COLUMN ${colName} DROP DEFAULT`)
        } else {
          stmts.push(
            `ALTER TABLE ${tbl} ALTER COLUMN ${colName} SET DEFAULT ${literalOrDefault('postgres', draft.defaultValue)}`,
          )
        }
      }
    }

    // 注释（MySQL 在列定义里已带；这里处理改名/仅改注释的情况）
    if ((original.comment ?? null) !== (draft.comment ?? null)) {
      if (dialect === 'mysql') {
        if (!typeChanged && !nullableChanged && !defaultChanged) {
          // 仅改注释：MySQL 也得 MODIFY
          stmts.push(`ALTER TABLE ${tbl} MODIFY COLUMN ${columnDefFragment(dialect, draft)}`)
        }
      } else if (dialect === 'postgres') {
        if (draft.comment) {
          stmts.push(`COMMENT ON COLUMN ${tbl}.${colName} IS ${quoteLiteral(draft.comment)}`)
        } else {
          stmts.push(`COMMENT ON COLUMN ${tbl}.${colName} IS NULL`)
        }
      }
      // SQLite 不支持列注释 → unsupported
      if (dialect === 'sqlite') {
        unsupported.push({ reason: `SQLite 不支持列注释，列 "${draft.name}" 的注释无法保存` })
      }
    }
  }

  return { stmts, unsupported }
}

function buildIndexStatements(
  dialect: TableDialect,
  schema: string | undefined,
  table: string,
  diff: IndexDiff,
): string[] {
  const stmts: string[] = []
  const tbl = tableRef(dialect, schema, table)

  // 删除 + 变化（drop+recreate）
  for (const i of [...diff.removed, ...diff.changed.map((c) => c.original)]) {
    if (i.isPrimaryKey) {
      // 主键索引：MySQL/PG 用 DROP PRIMARY KEY / DROP CONSTRAINT
      if (dialect === 'mysql') stmts.push(`ALTER TABLE ${tbl} DROP PRIMARY KEY`)
      else stmts.push(`ALTER TABLE ${tbl} DROP CONSTRAINT ${qIdent(dialect, i.name)}`)
    } else {
      if (dialect === 'mysql') stmts.push(`DROP INDEX ${qIdent(dialect, i.name)} ON ${tbl}`)
      else stmts.push(`DROP INDEX ${qIdent(dialect, i.name)}`)
      // PG/SQLite: DROP INDEX name（PG 支持加 schema/IF EXISTS，此处保持简单）
    }
  }

  // 新增 + 变化重建
  for (const i of [...diff.added, ...diff.changed.map((c) => c.draft)]) {
    if (i.isPrimaryKey) {
      const cols = i.columns.map((c) => qIdent(dialect, c)).join(', ')
      if (dialect === 'sqlite') {
        // SQLite 重建主键只能整表重建，这里给出提示性语句（实际执行可能失败）
        stmts.push(`-- SQLite 无法直接添加主键，需重建表。建议: ${i.columns.join(', ')} 为主键`)
      } else {
        stmts.push(`ALTER TABLE ${tbl} ADD PRIMARY KEY (${cols})`)
      }
    } else {
      const unique = i.isUnique ? 'UNIQUE ' : ''
      const idxName = qIdent(dialect, i.name)
      const cols = i.columns.map((c) => qIdent(dialect, c)).join(', ')
      stmts.push(`CREATE ${unique}INDEX ${idxName} ON ${tbl} (${cols})`)
    }
  }

  return stmts
}

function buildFkStatements(
  dialect: TableDialect,
  schema: string | undefined,
  table: string,
  diff: ForeignKeyDiff,
): string[] {
  const stmts: string[] = []
  const tbl = tableRef(dialect, schema, table)

  // 删除 + 变化
  for (const f of [...diff.removed, ...diff.changed.map((c) => c.original)]) {
    if (dialect === 'sqlite') {
      // SQLite 不支持 ALTER TABLE DROP CONSTRAINT
      stmts.push(`-- SQLite 无法直接删除外键 "${f.name}"，需重建表`)
    } else if (dialect === 'mysql') {
      stmts.push(`ALTER TABLE ${tbl} DROP FOREIGN KEY ${qIdent(dialect, f.name)}`)
    } else {
      stmts.push(`ALTER TABLE ${tbl} DROP CONSTRAINT ${qIdent(dialect, f.name)}`)
    }
  }

  // 新增 + 变化重建
  for (const f of [...diff.added, ...diff.changed.map((c) => c.draft)]) {
    if (dialect === 'sqlite') {
      stmts.push(`-- SQLite 无法直接添加外键 "${f.name}"，需重建表`)
    } else {
      const cols = f.columns.map((c) => qIdent(dialect, c)).join(', ')
      const refCols = f.referencesColumns.map((c) => qIdent(dialect, c)).join(', ')
      const refTbl = qIdent(dialect, f.referencesTable)
      let s = `ALTER TABLE ${tbl} ADD CONSTRAINT ${qIdent(dialect, f.name)} FOREIGN KEY (${cols}) REFERENCES ${refTbl} (${refCols})`
      if (f.onDelete && f.onDelete !== 'NO ACTION') {
        s += ` ON DELETE ${f.onDelete}`
      }
      stmts.push(s)
    }
  }

  return stmts
}

// ===== 主入口 =====

/**
 * 根据原始 TableMeta 与编辑后草稿，生成目标方言的 ALTER 语句数组。
 *
 * 执行顺序：删列 → 加列 → 改列 → 删/改索引 → 加/重建索引 → 删/改外键 → 加/重建外键
 * （先处理依赖对象的删除，再处理新增，降低冲突概率）
 */
export function buildAlterStatements(
  dialect: TableDialect,
  original: TableMeta,
  draft: DraftTableMeta,
): AlterResult {
  const diff = diffTableMeta(original, draft)
  const unsupported: UnsupportedChange[] = []

  const col = buildColumnStatements(
    dialect,
    original.schema ?? draft.schema,
    original.name,
    diff.columns,
  )
  unsupported.push(...col.unsupported)

  const idxStmts = buildIndexStatements(
    dialect,
    original.schema ?? draft.schema,
    original.name,
    diff.indexes,
  )
  const fkStmts = buildFkStatements(
    dialect,
    original.schema ?? draft.schema,
    original.name,
    diff.foreignKeys,
  )

  const statements = [...col.stmts, ...idxStmts, ...fkStmts]

  return { statements, unsupported }
}

/** 是否存在任何变更（用于「保存」按钮启用判定） */
export function hasChanges(original: TableMeta, draft: DraftTableMeta): boolean {
  const d = diffTableMeta(original, draft)
  return (
    d.columns.added.length +
      d.columns.removed.length +
      d.columns.changed.length +
      d.indexes.added.length +
      d.indexes.removed.length +
      d.indexes.changed.length +
      d.foreignKeys.added.length +
      d.foreignKeys.removed.length +
      d.foreignKeys.changed.length >
    0
  )
}
