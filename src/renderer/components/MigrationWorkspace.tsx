/**
 * 数据库迁移工作区
 *
 * 向导式布局：
 * 1. 源/目标连接+表选择（双栏）
 * 2. 维度选择（结构 / 数据）+ 策略
 * 3. diff 结果 + 类型告警
 * 4. 生成脚本预览（可勾选、可导出）
 * 5. 执行（事务守卫，结果展示）
 *
 * 数据安全：数据迁移强制事务（store 默认 single），UI 不暴露 none 选项给含数据方案。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Database,
  Download,
  Play,
  Save,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { useMigrationStore } from '../store/migration'
import { useConnectionStore, DB_LABELS } from '../store/connections'
import {
  type ConnectionListItem,
  type StructureDiffItem,
  type GeneratedStatement,
  type MigrationTarget,
} from '../api'

const DIFF_KIND_LABEL: Record<StructureDiffItem['kind'], string> = {
  createTable: '新建表',
  dropTable: '删除表',
  addColumn: '新增列',
  modifyColumn: '修改列',
  dropColumn: '删除列',
  addIndex: '新增索引',
  dropIndex: '删除索引',
  addForeignKey: '新增外键',
  dropForeignKey: '删除外键',
}

const RISK_CLASS: Record<GeneratedStatement['riskLevel'], string> = {
  safe: 'risk-safe',
  caution: 'risk-caution',
  danger: 'risk-danger',
}

export function MigrationWorkspace() {
  const store = useMigrationStore()
  const { connections, states, connectDb, loadSchemas, loadTables } = useConnectionStore()
  const [showPlans, setShowPlans] = useState(false)
  const [planName, setPlanName] = useState('')

  // 进入时加载持久化方案
  useEffect(() => {
    void store.loadPlans()
  }, [store])

  return (
    <div className="migration-workspace">
      <header className="migration-header">
        <h2>数据库迁移</h2>
        <span className="migration-subtitle">
          结构 diff + 数据 diff + 跨库迁移（MySQL ↔ PostgreSQL ↔ SQLite）
        </span>
      </header>

      {/* —— 步骤 1：源/目标选择 —— */}
      <section className="migration-pickers">
        <TargetPicker
          title="源（Source）"
          connections={connections}
          states={states}
          onConnect={connectDb}
          onLoadSchemas={loadSchemas}
          onLoadTables={loadTables}
          selected={store.source}
          onSelect={(t) => store.setSource(t)}
        />
        <div className="migration-arrow">
          <ArrowRight size={20} />
        </div>
        <TargetPicker
          title="目标（Target）"
          connections={connections}
          states={states}
          onConnect={connectDb}
          onLoadSchemas={loadSchemas}
          onLoadTables={loadTables}
          selected={store.target}
          onSelect={(t) => store.setTarget(t)}
        />
      </section>

      {/* —— 步骤 2：维度与策略 —— */}
      <section className="migration-options">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={store.includeData}
            onChange={(e) => store.setIncludeData(e.target.checked)}
          />
          <span>启用数据迁移</span>
        </label>
        {store.includeData && (
          <>
            <div className="form-field">
              <label>数据策略</label>
              <select
                value={store.strategy}
                onChange={(e) => store.setStrategy(e.target.value as never)}
              >
                <option value="incremental">增量（PK 新增/删除，不修改）</option>
                <option value="fullReplace">全量替换（清空 + 重灌）</option>
                <option value="insertOnly">仅新增（不删除目标多余）</option>
              </select>
            </div>
            <span className="migration-hint migration-hint-warning">
              ⚠ 不做行级 UPDATE（产品边界）。数据迁移强制事务。
            </span>
          </>
        )}
        <div className="form-field">
          <label>事务</label>
          <select
            value={store.transaction}
            onChange={(e) => store.setTransaction(e.target.value as never)}
          >
            <option value="single">单事务（全成功或全回滚，推荐）</option>
            <option value="perStatement">逐语句（大表分批提交）</option>
            {!store.includeData && <option value="none">无事务（仅 DDL）</option>}
          </select>
        </div>
      </section>

      {/* —— 操作按钮 —— */}
      <section className="migration-actions">
        <button
          className="btn btn-secondary btn-sm"
          disabled={!store.source || !store.target || store.loading}
          onClick={() => void store.runStructureDiff()}
        >
          结构 Diff
        </button>
        {store.includeData && (
          <button
            className="btn btn-secondary btn-sm"
            disabled={!store.source || !store.target || store.loading}
            onClick={() => void store.runDataDiff()}
          >
            数据 Diff
          </button>
        )}
        <button
          className="btn btn-primary btn-sm"
          disabled={store.loading}
          onClick={() => void store.generateScript()}
        >
          生成脚本
        </button>
        <div className="migration-actions-spacer" />
        <input
          className="plan-name-input"
          placeholder="方案名称"
          value={planName}
          onChange={(e) => setPlanName(e.target.value)}
        />
        <button
          className="btn btn-text btn-sm"
          disabled={!store.source || !store.target}
          onClick={() => void store.savePlan(planName || `迁移 ${new Date().toLocaleString()}`)}
          title="保存为可复用方案"
        >
          <Save size={14} /> 保存方案
        </button>
        <button
          className="btn btn-text btn-sm"
          onClick={() => {
            setShowPlans((v) => !v)
            void store.loadPlans()
          }}
        >
          方案库 ({store.plans.length})
        </button>
      </section>

      {store.error && (
        <div className="migration-error">
          <AlertTriangle size={14} /> {store.error}
        </div>
      )}

      {/* —— 方案库 —— */}
      {showPlans && store.plans.length > 0 && (
        <section className="migration-plans">
          {store.plans.map((p) => (
            <div key={p.id} className="plan-item">
              <span className="plan-name">{p.name}</span>
              <span className="plan-meta">
                {p.source.table} → {p.target.table}
              </span>
              <button
                className="btn btn-text btn-sm"
                onClick={() => {
                  store.loadPlan(p)
                  setShowPlans(false)
                }}
              >
                加载
              </button>
              <button
                className="btn btn-text btn-sm btn-danger-text"
                onClick={() => void store.deletePlan(p.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </section>
      )}

      {/* —— 类型告警 —— */}
      {store.warnings.length > 0 && (
        <section className="migration-warnings">
          <h4>跨库类型映射告警</h4>
          {store.warnings.map((w, i) => (
            <div key={i} className={`warning-item warning-${w.severity}`}>
              <AlertTriangle size={13} />
              <span className="warning-col">{w.column}</span>
              <span className="warning-types">
                {w.fromType} → {w.toType}
              </span>
              <span className="warning-reason">{w.reason}</span>
            </div>
          ))}
        </section>
      )}

      {/* —— diff 摘要 —— */}
      {(store.structureItems.length > 0 || store.dataItems.length > 0) && (
        <section className="migration-diff-summary">
          <DiffSummary items={store.structureItems} dataCount={store.dataItems.length} />
        </section>
      )}

      {/* —— 脚本预览 —— */}
      {store.statements.length > 0 && (
        <section className="migration-script">
          <div className="script-toolbar">
            <span className="script-count">{store.statements.length} 条语句</span>
            <span className="script-selected">已选 {store.selectedIndexes.length}</span>
            <button className="btn btn-text btn-sm" onClick={store.selectAll}>
              全选
            </button>
            <button className="btn btn-text btn-sm" onClick={store.selectNone}>
              全不选
            </button>
            <div className="script-toolbar-spacer" />
            <button
              className="btn btn-text btn-sm"
              onClick={() => downloadScript(store.statements)}
            >
              <Download size={13} /> 导出 .sql
            </button>
          </div>
          <div className="script-list">
            {store.statements.map((stmt, i) => (
              <label key={i} className="script-row">
                <input
                  type="checkbox"
                  checked={store.selectedIndexes.includes(i)}
                  onChange={() => store.toggleSelect(i)}
                />
                <span className={`risk-badge ${RISK_CLASS[stmt.riskLevel]}`}>{stmt.riskLevel}</span>
                <span className={`script-kind script-kind-${stmt.kind}`}>
                  {stmt.kind.toUpperCase()}
                </span>
                <pre className="script-sql">{stmt.sql}</pre>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* —— 执行 —— */}
      {store.statements.length > 0 && (
        <section className="migration-exec">
          <button
            className="btn btn-warning"
            disabled={store.executing || store.selectedIndexes.length === 0}
            onClick={() => void store.execute()}
          >
            <Play size={15} /> 执行迁移（{store.selectedIndexes.length} 条）
          </button>
          {store.result && <ExecResult result={store.result} />}
        </section>
      )}
    </div>
  )
}

/** 源/目标选择器：连接 → schema → 表 */
function TargetPicker(props: {
  title: string
  connections: ConnectionListItem[]
  states: ReturnType<typeof useConnectionStore.getState>['states']
  onConnect: (id: string) => Promise<boolean>
  onLoadSchemas: (id: string) => Promise<void>
  onLoadTables: (id: string, schema: string) => Promise<void>
  selected: MigrationTarget | null
  onSelect: (t: MigrationTarget | null) => void
}) {
  const { title, connections, states, selected, onSelect, onConnect, onLoadSchemas, onLoadTables } =
    props
  const connId = selected?.connectionId ?? ''
  const state = connId ? states[connId] : undefined
  const schemas = state?.schemas ?? []
  const tables = selected?.schema ? (state?.tables?.[selected.schema] ?? []) : []

  // 选择连接后自动连接 + 加载 schemas
  useEffect(() => {
    if (!connId) return
    if (!state?.connected && !state?.connecting) {
      void onConnect(connId).then((ok) => {
        if (ok) void onLoadSchemas(connId)
      })
    } else if (state.connected && !state.schemas) {
      void onLoadSchemas(connId)
    }
  }, [connId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 选择 schema 后加载表
  useEffect(() => {
    if (connId && selected?.schema && !state?.tables?.[selected.schema]) {
      void onLoadTables(connId, selected.schema)
    }
  }, [connId, selected?.schema]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="target-picker">
      <h4>{title}</h4>
      <div className="form-field">
        <label>连接</label>
        <select
          value={connId}
          onChange={(e) => {
            const id = e.target.value
            if (!id) {
              onSelect(null)
              return
            }
            const c = connections.find((x) => x.id === id)
            onSelect({
              connectionId: id,
              table: '',
              schema: c?.type === 'sqlite' ? undefined : undefined,
            })
          }}
        >
          <option value="">选择连接…</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（{DB_LABELS[c.type]}）
            </option>
          ))}
        </select>
      </div>
      {schemas.length > 0 && (
        <div className="form-field">
          <label>Schema</label>
          <select
            value={selected?.schema ?? ''}
            onChange={(e) =>
              onSelect(
                selected ? { ...selected, schema: e.target.value || undefined, table: '' } : null,
              )
            }
          >
            <option value="">（默认）</option>
            {schemas.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="form-field">
        <label>表</label>
        <select
          value={selected?.table ?? ''}
          onChange={(e) => onSelect(selected ? { ...selected, table: e.target.value } : null)}
          disabled={tables.length === 0}
        >
          <option value="">选择表…</option>
          {tables
            .filter((t) => t.type === 'table')
            .map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
        </select>
      </div>
      {state?.error && <div className="target-error">{state.error}</div>}
      {state?.connecting && <div className="target-status">连接中…</div>}
    </div>
  )
}

/** diff 摘要展示 */
function DiffSummary({ items, dataCount }: { items: StructureDiffItem[]; dataCount: number }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1
    return c
  }, [items])
  return (
    <div className="diff-summary">
      <Database size={14} /> 结构：
      {Object.entries(counts).map(([k, n]) => (
        <span key={k} className="diff-chip">
          {DIFF_KIND_LABEL[k as StructureDiffItem['kind']]} ×{n}
        </span>
      ))}
      {dataCount > 0 && <span className="diff-chip diff-chip-data">数据操作 ×{dataCount}</span>}
    </div>
  )
}

/** 执行结果展示 */
function ExecResult({
  result,
}: {
  result: NonNullable<ReturnType<typeof useMigrationStore.getState>['result']>
}) {
  return (
    <div className={`exec-result ${result.success ? 'exec-success' : 'exec-failed'}`}>
      {result.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
      <span>
        {result.success ? '迁移成功' : '迁移失败'}：成功 {result.applied} 条，失败 {result.failed}{' '}
        条，耗时 {result.durationMs}ms
      </span>
      {result.failedItems && result.failedItems.length > 0 && (
        <div className="exec-failed-items">
          {result.failedItems.map((f, i) => (
            <div key={i} className="failed-item">
              <span className="failed-item-sql">{f.sql.slice(0, 80)}</span>
              <span className="failed-item-err">{f.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 导出脚本为 .sql 文件 */
function downloadScript(statements: GeneratedStatement[]): void {
  const sql = statements.map((s) => s.sql).join(';\n\n') + ';\n'
  const blob = new Blob([sql], { type: 'text/sql' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `migration-${Date.now()}.sql`
  a.click()
  URL.revokeObjectURL(url)
}
