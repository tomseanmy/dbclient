/**
 * 表结构编辑器（行内编辑，基于 DataGrid 声明式单元格类型）
 *
 * 三类对象（列 / 索引 / 外键）各用一个 DataGrid 呈现，通过 columnEditors
 * 声明每列的单元格类型（select / checkbox / disabled / text）。
 * 列类型用 select 从预置清单选择；仅需要长度的类型才启用长度单元格。
 * 列表下方有只读 Monaco DDL 预览框，编辑时实时生成待执行的 ALTER 脚本。
 *
 * 草稿以受控方式上抛给 TableDetail，由其负责安全检查与执行。
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { DataGrid, type ColumnEditor } from '../DataGrid'
import {
  diffTableMeta,
  genDraftId,
  toDraftMeta,
  buildAlterStatements,
  type DraftColumn,
  type DraftForeignKey,
  type DraftIndex,
  type DraftTableMeta,
  type TableDialect,
} from '@shared/db/alter-generator'
import { getColumnTypesGrouped, typeNeedsLength } from '@shared/db/column-types'
import type { QueryResult, TableMeta, UnifiedType } from '../../api'

interface TableStructureEditorProps {
  /** 原始表结构（diff 基线） */
  original: TableMeta
  /** 受控草稿 */
  draft: DraftTableMeta
  /** 草稿变更回调 */
  onChange: (draft: DraftTableMeta) => void
  /** 方言（决定预置类型清单与 DDL 方言） */
  dialect: TableDialect
  /** detail-tabs 最右侧的额外按钮（如保存） */
  headerExtra?: ReactNode
}

type EditTab = 'columns' | 'indexes' | 'foreignKeys'

const ON_DELETE_OPTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT', 'SET DEFAULT']

export function TableStructureEditor({
  original,
  draft,
  onChange,
  dialect,
  headerExtra,
}: TableStructureEditorProps) {
  const [tab, setTab] = useState<EditTab>('columns')
  // 各表格当前选中行（点序号选中）；按 tab 独立保存。空表示未选中。
  const [selectedColKey, setSelectedColKey] = useState<string | number | null>(null)
  const [selectedIdxKey, setSelectedIdxKey] = useState<string | number | null>(null)
  const [selectedFkKey, setSelectedFkKey] = useState<string | number | null>(null)

  /** 切换 tab 时清除其它 tab 的选中态，避免跨表格串选 */
  const switchTab = (next: EditTab) => {
    if (next === tab) return
    setSelectedColKey(null)
    setSelectedIdxKey(null)
    setSelectedFkKey(null)
    setTab(next)
  }

  /** 列类型 select 选项（按分组） */
  const typeOptions = useMemo(() => {
    const grouped = getColumnTypesGrouped(dialect)
    return grouped.flatMap((g) =>
      g.options.map((o) => ({ label: o.name, value: o.name, group: g.label })),
    )
  }, [dialect])

  // ===== 列：DataGrid 数据与编辑器声明 =====
  const columnsResult: QueryResult = useMemo(() => {
    const visible = draft.columns.filter((c) => !c._removed)
    return {
      columns: [
        { name: 'name', dataType: 'string' },
        { name: 'dataType', dataType: 'string' },
        { name: 'length', dataType: 'integer' },
        { name: 'nullable', dataType: 'boolean' },
        { name: 'isPrimaryKey', dataType: 'boolean' },
        { name: 'defaultValue', dataType: 'string' },
        { name: 'comment', dataType: 'string' },
      ],
      rows: visible.map((c, i) => ({
        __row_key__: c._id,
        name: c.name,
        dataType: c.dataType,
        length: c.length ?? '',
        nullable: c.nullable ? 'true' : 'false',
        isPrimaryKey: c.isPrimaryKey ? 'true' : 'false',
        defaultValue: c.defaultValue ?? '',
        comment: c.comment ?? '',
        // 辅助：长度单元格是否可用取决于当前类型
        _rowIndex: i,
      })),
      rowCount: visible.length,
      durationMs: 0,
    }
  }, [draft.columns])

  const columnEditors: Record<string, ColumnEditor> = useMemo(
    () => ({
      name: { kind: 'text' },
      dataType: { kind: 'select', options: typeOptions },
      // 长度：按行条件禁用（类型不需要长度时禁用）
      length: {
        kind: 'text',
        // 复用 disabled 能力：通过 isDisabled 在不需要长度时禁用
        isDisabled: (rowKey) => {
          const c = draft.columns.find((x) => x._id === rowKey)
          return c ? !typeNeedsLength(dialect, c.dataType) : true
        },
      },
      nullable: { kind: 'checkbox', trueLabel: '是', falseLabel: '否' },
      isPrimaryKey: { kind: 'checkbox', trueLabel: '是', falseLabel: '否' },
      defaultValue: { kind: 'text' },
      comment: { kind: 'text' },
    }),
    [draft.columns, dialect, typeOptions],
  )

  const handleColumnCellChange = (rowKey: string | number, column: string, value: string) => {
    onChange({
      ...draft,
      columns: draft.columns.map((c) => {
        if (c._id !== rowKey) return c
        const patch: Partial<DraftColumn> = {}
        if (column === 'name') patch.name = value
        else if (column === 'dataType') {
          patch.dataType = value
          // 切到不需要长度的类型时，清空长度；切到需要的类型时预填默认长度
          if (!typeNeedsLength(dialect, value)) patch.length = undefined
        } else if (column === 'length') {
          patch.length = value === '' ? undefined : Number(value)
        } else if (column === 'nullable') patch.nullable = value === 'true'
        else if (column === 'isPrimaryKey') patch.isPrimaryKey = value === 'true'
        else if (column === 'defaultValue') patch.defaultValue = value === '' ? null : value
        else if (column === 'comment') patch.comment = value === '' ? undefined : value
        return { ...c, ...patch }
      }),
    })
  }

  const addColumn = () => {
    onChange({
      ...draft,
      columns: [
        ...draft.columns,
        {
          _id: genDraftId('col'),
          name: 'new_column',
          dataType: 'varchar',
          unifiedType: 'string' as UnifiedType,
          length: 255,
          nullable: true,
          isPrimaryKey: false,
          defaultValue: null,
          comment: undefined,
        },
      ],
    })
  }
  const removeColumn = (id: string) => {
    onChange({
      ...draft,
      columns: draft.columns.map((c) => (c._id === id ? { ...c, _removed: true } : c)),
    })
  }

  // ===== 索引 =====
  const indexesResult: QueryResult = useMemo(() => {
    const visible = draft.indexes.filter((i) => !i._removed)
    return {
      columns: [
        { name: 'name', dataType: 'string' },
        { name: 'columns', dataType: 'string' },
        { name: 'isUnique', dataType: 'boolean' },
        { name: 'isPrimaryKey', dataType: 'boolean' },
      ],
      rows: visible.map((i) => ({
        __row_key__: i._id,
        name: i.name,
        columns: i.columns.join(', '),
        isUnique: i.isUnique ? 'true' : 'false',
        isPrimaryKey: i.isPrimaryKey ? 'true' : 'false',
      })),
      rowCount: visible.length,
      durationMs: 0,
    }
  }, [draft.indexes])

  const indexEditors: Record<string, ColumnEditor> = {
    name: { kind: 'text' },
    columns: { kind: 'text' },
    isUnique: { kind: 'checkbox', trueLabel: '是', falseLabel: '否' },
    isPrimaryKey: { kind: 'checkbox', trueLabel: '是', falseLabel: '否' },
  }

  const handleIndexCellChange = (rowKey: string | number, column: string, value: string) => {
    onChange({
      ...draft,
      indexes: draft.indexes.map((i) => {
        if (i._id !== rowKey) return i
        const patch: Partial<DraftIndex> = {}
        if (column === 'name') patch.name = value
        else if (column === 'columns')
          patch.columns = value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        else if (column === 'isUnique') patch.isUnique = value === 'true'
        else if (column === 'isPrimaryKey') patch.isPrimaryKey = value === 'true'
        return { ...i, ...patch }
      }),
    })
  }
  const addIndex = () =>
    onChange({
      ...draft,
      indexes: [
        ...draft.indexes,
        { _id: genDraftId('idx'), name: 'new_index', columns: [], isUnique: false },
      ],
    })
  const removeIndex = (id: string) =>
    onChange({
      ...draft,
      indexes: draft.indexes.map((i) => (i._id === id ? { ...i, _removed: true } : i)),
    })

  // ===== 外键 =====
  const fksResult: QueryResult = useMemo(() => {
    const visible = draft.foreignKeys.filter((f) => !f._removed)
    return {
      columns: [
        { name: 'name', dataType: 'string' },
        { name: 'columns', dataType: 'string' },
        { name: 'referencesTable', dataType: 'string' },
        { name: 'referencesColumns', dataType: 'string' },
        { name: 'onDelete', dataType: 'string' },
      ],
      rows: visible.map((f) => ({
        __row_key__: f._id,
        name: f.name,
        columns: f.columns.join(', '),
        referencesTable: f.referencesTable,
        referencesColumns: f.referencesColumns.join(', '),
        onDelete: f.onDelete ?? 'NO ACTION',
      })),
      rowCount: visible.length,
      durationMs: 0,
    }
  }, [draft.foreignKeys])

  const fkEditors: Record<string, ColumnEditor> = {
    name: { kind: 'text' },
    columns: { kind: 'text' },
    referencesTable: { kind: 'text' },
    referencesColumns: { kind: 'text' },
    onDelete: { kind: 'select', options: ON_DELETE_OPTIONS.map((o) => ({ label: o, value: o })) },
  }

  const handleFkCellChange = (rowKey: string | number, column: string, value: string) => {
    onChange({
      ...draft,
      foreignKeys: draft.foreignKeys.map((f) => {
        if (f._id !== rowKey) return f
        const patch: Partial<DraftForeignKey> = {}
        if (column === 'name') patch.name = value
        else if (column === 'columns')
          patch.columns = value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        else if (column === 'referencesTable') patch.referencesTable = value
        else if (column === 'referencesColumns')
          patch.referencesColumns = value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        else if (column === 'onDelete') patch.onDelete = value
        return { ...f, ...patch }
      }),
    })
  }
  const addFk = () =>
    onChange({
      ...draft,
      foreignKeys: [
        ...draft.foreignKeys,
        {
          _id: genDraftId('fk'),
          name: 'new_fk',
          columns: [],
          referencesTable: '',
          referencesColumns: [],
          onDelete: 'NO ACTION',
        },
      ],
    })
  const removeFk = (id: string) =>
    onChange({
      ...draft,
      foreignKeys: draft.foreignKeys.map((f) => (f._id === id ? { ...f, _removed: true } : f)),
    })

  // ===== 脏行高亮 =====
  const diff = useMemo(() => diffTableMeta(original, draft), [original, draft])
  const dirtyColKeys = useMemo(
    () =>
      new Set<string | number>([
        ...diff.columns.added.map((c) => c._id),
        ...diff.columns.changed.map((c) => c.draft._id),
      ]),
    [diff.columns],
  )
  const dirtyIdxKeys = useMemo(
    () =>
      new Set<string | number>([
        ...diff.indexes.added.map((i) => i._id),
        ...diff.indexes.changed.map((i) => i.draft._id),
      ]),
    [diff.indexes],
  )
  const dirtyFkKeys = useMemo(
    () =>
      new Set<string | number>([
        ...diff.foreignKeys.added.map((f) => f._id),
        ...diff.foreignKeys.changed.map((f) => f.draft._id),
      ]),
    [diff.foreignKeys],
  )

  // ===== DDL 预览（实时） =====
  const alterResult = useMemo(
    () => buildAlterStatements(dialect, original, draft),
    [dialect, original, draft],
  )
  const ddlPreview =
    alterResult.statements.length > 0 ? alterResult.statements.join(';\n') + ';' : ''

  return (
    <>
      <div className="detail-tabs">
        <button
          className={`tab ${tab === 'columns' ? 'active' : ''}`}
          onClick={() => switchTab('columns')}
        >
          列 ({draft.columns.filter((c) => !c._removed).length})
        </button>
        <button
          className={`tab ${tab === 'indexes' ? 'active' : ''}`}
          onClick={() => switchTab('indexes')}
        >
          索引 ({draft.indexes.filter((i) => !i._removed).length})
        </button>
        <button
          className={`tab ${tab === 'foreignKeys' ? 'active' : ''}`}
          onClick={() => switchTab('foreignKeys')}
        >
          外键 ({draft.foreignKeys.filter((f) => !f._removed).length})
        </button>
        {headerExtra && <div className="detail-tabs-extra">{headerExtra}</div>}
      </div>

      <div className="edit-row-actions">
        {tab === 'columns' && (
          <>
            <button
              className="btn btn-secondary btn-sm edit-add-btn"
              title="添加列"
              onClick={addColumn}
            >
              <Plus size={14} />
            </button>
            <button
              className="btn btn-danger btn-sm edit-remove-btn"
              disabled={selectedColKey === null}
              title={selectedColKey === null ? '先点左侧序号选中一列' : '删除选中的列'}
              onClick={() => {
                if (selectedColKey !== null) removeColumn(String(selectedColKey))
                setSelectedColKey(null)
              }}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
        {tab === 'indexes' && (
          <>
            <button
              className="btn btn-secondary btn-sm edit-add-btn"
              title="添加索引"
              onClick={addIndex}
            >
              <Plus size={14} />
            </button>
            <button
              className="btn btn-danger btn-sm edit-remove-btn"
              disabled={selectedIdxKey === null}
              title={selectedIdxKey === null ? '先点左侧序号选中一个索引' : '删除选中的索引'}
              onClick={() => {
                if (selectedIdxKey !== null) removeIndex(String(selectedIdxKey))
                setSelectedIdxKey(null)
              }}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
        {tab === 'foreignKeys' && (
          <>
            <button
              className="btn btn-secondary btn-sm edit-add-btn"
              title="添加外键"
              onClick={addFk}
            >
              <Plus size={14} />
            </button>
            <button
              className="btn btn-danger btn-sm edit-remove-btn"
              disabled={selectedFkKey === null}
              title={selectedFkKey === null ? '先点左侧序号选中一个外键' : '删除选中的外键'}
              onClick={() => {
                if (selectedFkKey !== null) removeFk(String(selectedFkKey))
                setSelectedFkKey(null)
              }}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      {tab === 'columns' && (
        <div className="edit-table-wrap">
          <DataGrid
            result={columnsResult}
            editable
            columnEditors={columnEditors}
            onCellChange={handleColumnCellChange}
            dirtyRowKeys={dirtyColKeys}
            selectedRowKey={selectedColKey}
            onSelectRow={(k) => setSelectedColKey(k === selectedColKey ? null : k)}
          />
        </div>
      )}

      {tab === 'indexes' && (
        <div className="edit-table-wrap">
          <DataGrid
            result={indexesResult}
            editable
            columnEditors={indexEditors}
            onCellChange={handleIndexCellChange}
            dirtyRowKeys={dirtyIdxKeys}
            selectedRowKey={selectedIdxKey}
            onSelectRow={(k) => setSelectedIdxKey(k === selectedIdxKey ? null : k)}
          />
        </div>
      )}

      {tab === 'foreignKeys' && (
        <div className="edit-table-wrap">
          <DataGrid
            result={fksResult}
            editable
            columnEditors={fkEditors}
            onCellChange={handleFkCellChange}
            dirtyRowKeys={dirtyFkKeys}
            selectedRowKey={selectedFkKey}
            onSelectRow={(k) => setSelectedFkKey(k === selectedFkKey ? null : k)}
          />
        </div>
      )}

      {/* DDL 预览框（只读 Monaco） */}
      <div className="edit-ddl-preview">
        <Editor
          height="180px"
          language="sql"
          theme="vs-dark"
          value={ddlPreview || '-- 无变更'}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'SF Mono', 'Menlo', monospace",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
            wordWrap: 'on',
            tabSize: 2,
          }}
        />
        {alterResult.unsupported.length > 0 && (
          <ul className="edit-ddl-unsupported">
            {alterResult.unsupported.map((u, i) => (
              <li key={i}>{u.reason}</li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

export { toDraftMeta }
