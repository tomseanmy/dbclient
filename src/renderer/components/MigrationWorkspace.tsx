/**
 * 数据库迁移工作区 —— 四步向导
 *
 * 步骤1：选源库 + 目标库（连接 + schema）
 * 步骤2：勾选源表 + 配置维度/策略/事务
 * 步骤3：生成脚本（按表分组）+ 勾选执行项
 * 步骤4：执行进度 + 结果
 */
import { useEffect, useState } from 'react'
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
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { useMigrationStore } from '../store/migration'
import { useConnectionStore, DB_LABELS } from '../store/connections'
import type { GeneratedStatement, ConnectionListItem } from '../api'

const STEP_LABELS = ['选择数据库', '选择表与设置', '生成脚本', '执行迁移'] as const

const RISK_CLASS: Record<GeneratedStatement['riskLevel'], string> = {
  safe: 'risk-safe',
  caution: 'risk-caution',
  danger: 'risk-danger',
}

export function MigrationWorkspace() {
  const store = useMigrationStore()
  const { connections, loadConnections } = useConnectionStore()
  const [showPlans, setShowPlans] = useState(false)
  const [planName, setPlanName] = useState('')

  useEffect(() => {
    void loadConnections()
    void store.loadPlans()
  }, [store, loadConnections])

  return (
    <div className="migration-workspace">
      {/* 步骤指示器 */}
      <div className="migration-stepper">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3 | 4
          return (
            <div
              key={n}
              className={`migration-step ${store.step === n ? 'migration-step-active' : ''} ${store.step > n ? 'migration-step-done' : ''}`}
              onClick={() => store.step >= n && store.setStep(n)}
            >
              <span className="step-number">{store.step > n ? '✓' : n}</span>
              <span className="step-label">{label}</span>
              {n < 4 && <ChevronRight size={14} className="step-sep" />}
            </div>
          )
        })}
      </div>

      {store.error && (
        <div className="migration-error">
          <AlertTriangle size={14} /> {store.error}
        </div>
      )}

      {/* 步骤1：选择数据库 */}
      {store.step === 1 && <Step1Databases connections={connections} />}

      {/* 步骤2：选择表与设置 */}
      {store.step === 2 && <Step2Tables />}

      {/* 步骤3：生成脚本 */}
      {store.step === 3 && (
        <Step3Script
          showPlans={showPlans}
          setShowPlans={setShowPlans}
          planName={planName}
          setPlanName={setPlanName}
        />
      )}

      {/* 步骤4：执行结果 */}
      {store.step === 4 && <Step4Result />}
    </div>
  )
}

// ===== 步骤1：选择源库 + 目标库 =====
function Step1Databases({ connections }: { connections: ConnectionListItem[] }) {
  const store = useMigrationStore()
  const { states, connectDb, loadSchemas } = useConnectionStore()

  const sourceState = store.sourceConnId ? states[store.sourceConnId] : undefined
  const targetState = store.targetConnId ? states[store.targetConnId] : undefined

  // 选择连接后自动连接 + 加载 schema
  useEffect(() => {
    for (const connId of [store.sourceConnId, store.targetConnId]) {
      if (!connId) continue
      const st = states[connId]
      if (!st?.connected && !st?.connecting) {
        void connectDb(connId).then((ok) => {
          if (ok) void loadSchemas(connId)
        })
      } else if (st.connected && !st.schemas) {
        void loadSchemas(connId)
      }
    }
  }, [store.sourceConnId, store.targetConnId]) // eslint-disable-line react-hooks/exhaustive-deps

  const canNext =
    !!store.sourceConnId && !!store.targetConnId && sourceState?.connected && targetState?.connected

  return (
    <div className="step-content">
      <div className="migration-pickers">
        <DbPicker
          title="源数据库"
          connections={connections}
          connId={store.sourceConnId}
          schema={store.sourceSchema}
          schemas={sourceState?.schemas ?? []}
          state={sourceState}
          onConnChange={(id) => store.setSourceConn(id)}
          onSchemaChange={(s) => store.setSourceSchema(s)}
        />
        <div className="migration-arrow">
          <ArrowRight size={20} />
        </div>
        <DbPicker
          title="目标数据库"
          connections={connections}
          connId={store.targetConnId}
          schema={store.targetSchema}
          schemas={targetState?.schemas ?? []}
          state={targetState}
          onConnChange={(id) => store.setTargetConn(id)}
          onSchemaChange={(s) => store.setTargetSchema(s)}
        />
      </div>
      <div className="step-footer">
        <button
          className="btn btn-primary"
          disabled={!canNext}
          onClick={() => void store.setStep(2)}
        >
          下一步：选择表 <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

/** 数据库选择器（连接 + schema） */
function DbPicker(props: {
  title: string
  connections: ConnectionListItem[]
  connId: string
  schema: string
  schemas: { name: string }[]
  state: { connecting?: boolean; error?: string } | undefined
  onConnChange: (id: string) => void
  onSchemaChange: (s: string) => void
}) {
  return (
    <div className="db-picker">
      <h4>{props.title}</h4>
      <div className="form-field">
        <label>连接</label>
        <select
          className="settings-select"
          value={props.connId}
          onChange={(e) => props.onConnChange(e.target.value)}
        >
          <option value="">选择连接…</option>
          {props.connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（{DB_LABELS[c.type]}）
            </option>
          ))}
        </select>
      </div>
      {props.schemas.length > 0 && (
        <div className="form-field">
          <label>Schema</label>
          <select
            className="settings-select"
            value={props.schema}
            onChange={(e) => props.onSchemaChange(e.target.value)}
          >
            <option value="">（默认）</option>
            {props.schemas.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {props.state?.error && <div className="db-error">{props.state.error}</div>}
      {props.state?.connecting && <div className="db-status">连接中…</div>}
    </div>
  )
}

// ===== 步骤2：选择表 + 设置 =====
function Step2Tables() {
  const store = useMigrationStore()
  const { states, loadTables } = useConnectionStore()

  const sourceState = store.sourceConnId ? states[store.sourceConnId] : undefined
  const schema = store.sourceSchema || ''
  const sourceTables = schema ? (sourceState?.tables?.[schema] ?? []) : []

  // 加载源表列表
  useEffect(() => {
    if (store.sourceConnId && schema && !sourceState?.tables?.[schema]) {
      void loadTables(store.sourceConnId, schema)
    }
  }, [store.sourceConnId, schema]) // eslint-disable-line react-hooks/exhaustive-deps

  // 首次加载时初始化 tables 状态
  useEffect(() => {
    if (sourceTables.length > 0 && store.tables.length === 0) {
      store.setTables(
        sourceTables
          .filter((t) => t.type === 'table')
          .map((t) => ({
            sourceTable: t.name,
            targetTable: t.name,
            selected: false,
            structureItems: [],
            dataItems: [],
          })),
      )
    }
  }, [sourceTables.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCount = store.tables.filter((t) => t.selected).length

  return (
    <div className="step-content">
      <div className="migration-options">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={store.includeData}
            onChange={(e) => store.setIncludeData(e.target.checked)}
          />
          <span>启用数据迁移</span>
        </label>
        {store.includeData && (
          <div className="form-field">
            <label>数据策略</label>
            <select
              className="settings-select"
              value={store.strategy}
              onChange={(e) => store.setStrategy(e.target.value as never)}
            >
              <option value="incremental">增量（PK 新增/删除，不修改）</option>
              <option value="fullReplace">全量替换（清空 + 重灌）</option>
              <option value="insertOnly">仅新增（不删除目标多余）</option>
            </select>
          </div>
        )}
        <div className="form-field">
          <label>事务</label>
          <select
            className="settings-select"
            value={store.transaction}
            onChange={(e) => store.setTransaction(e.target.value as never)}
          >
            <option value="single">每表单事务（推荐）</option>
            <option value="perStatement">逐语句（大表分批）</option>
            {!store.includeData && <option value="none">无事务（仅 DDL）</option>}
          </select>
        </div>
      </div>

      {store.includeData && (
        <div className="migration-hint migration-hint-warning">
          ⚠ 不做行级 UPDATE（产品边界）。数据迁移强制事务。
        </div>
      )}

      <div className="table-select-list">
        <div className="table-select-header">
          <span>源表（{sourceTables.filter((t) => t.type === 'table').length} 张）</span>
          <span>目标表名</span>
          <span>已选 {selectedCount} 张</span>
        </div>
        {store.tables.map((t) => (
          <label
            key={t.sourceTable}
            className={`table-select-row ${t.selected ? 'table-select-row-checked' : ''}`}
          >
            <input
              type="checkbox"
              checked={t.selected}
              onChange={() => store.toggleTable(t.sourceTable)}
            />
            <span className="table-source-name">
              <Database size={13} /> {t.sourceTable}
            </span>
            <input
              className="table-target-input"
              value={t.targetTable}
              onChange={(e) => store.setTargetTableName(t.sourceTable, e.target.value)}
              disabled={!t.selected}
              placeholder="目标表名"
            />
          </label>
        ))}
      </div>

      <div className="step-footer">
        <button className="btn btn-secondary" onClick={() => store.setStep(1)}>
          上一步
        </button>
        <button
          className="btn btn-primary"
          disabled={selectedCount === 0 || store.loading}
          onClick={() => void store.generateAll()}
        >
          {store.loading ? '生成中…' : `生成脚本（${selectedCount} 张表）`}
        </button>
      </div>
    </div>
  )
}

// ===== 步骤3：生成脚本（按表分组） =====
function Step3Script(props: {
  showPlans: boolean
  setShowPlans: (v: boolean) => void
  planName: string
  setPlanName: (v: string) => void
}) {
  const store = useMigrationStore()
  const tableNames = Object.keys(store.scriptByTable)
  const totalStmts = Object.values(store.scriptByTable).reduce((s, arr) => s + arr.length, 0)
  const totalSelected = Object.values(store.selectedByTable).reduce((s, arr) => s + arr.length, 0)

  const handleDownload = () => {
    const allSql = Object.entries(store.scriptByTable)
      .map(([tbl, stmts]) => `-- ===== ${tbl} =====\n${stmts.map((s) => s.sql).join(';\n')}`)
      .join('\n\n;\n\n')
    const blob = new Blob([allSql], { type: 'text/sql' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `migration-${Date.now()}.sql`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="step-content">
      {/* 类型告警 */}
      {store.warnings.length > 0 && (
        <div className="migration-warnings">
          <h4>跨库类型映射告警（{store.warnings.length}）</h4>
          {store.warnings.slice(0, 10).map((w, i) => (
            <div key={i} className={`warning-item warning-${w.severity}`}>
              <AlertTriangle size={13} />
              <span className="warning-col">{w.column}</span>
              <span className="warning-types">
                {w.fromType} → {w.toType}
              </span>
              <span className="warning-reason">{w.reason}</span>
            </div>
          ))}
        </div>
      )}

      {/* 工具栏 */}
      <div className="script-toolbar">
        <span className="script-count">
          {tableNames.length} 张表 · {totalStmts} 条语句
        </span>
        <span className="script-selected">已选 {totalSelected}</span>
        <div className="script-toolbar-spacer" />
        <input
          className="plan-name-input"
          placeholder="方案名称"
          value={props.planName}
          onChange={(e) => props.setPlanName(e.target.value)}
        />
        <button
          className="btn btn-text btn-sm"
          onClick={() =>
            void store.savePlan(props.planName || `迁移 ${new Date().toLocaleString()}`)
          }
        >
          <Save size={14} /> 保存方案
        </button>
        <button
          className="btn btn-text btn-sm"
          onClick={() => {
            props.setShowPlans(!props.showPlans)
            void store.loadPlans()
          }}
        >
          方案库 ({store.plans.length})
        </button>
        <button className="btn btn-text btn-sm" onClick={handleDownload}>
          <Download size={13} /> 导出 .sql
        </button>
      </div>

      {/* 方案库 */}
      {props.showPlans && store.plans.length > 0 && (
        <div className="migration-plans">
          {store.plans.map((p) => (
            <div key={p.id} className="plan-item">
              <span className="plan-name">{p.name}</span>
              <span className="plan-meta">{p.pairs.length} 张表</span>
              <button
                className="btn btn-text btn-sm"
                onClick={() => {
                  store.loadPlan(p)
                  props.setShowPlans(false)
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
        </div>
      )}

      {/* 按表分组的脚本 */}
      <div className="script-groups">
        {tableNames.map((tableName) => (
          <TableScriptGroup key={tableName} tableName={tableName} />
        ))}
      </div>

      <div className="step-footer">
        <button className="btn btn-secondary" onClick={() => store.setStep(2)}>
          上一步
        </button>
        <button
          className="btn btn-warning"
          disabled={store.executing || totalSelected === 0}
          onClick={() => void store.execute()}
        >
          <Play size={15} /> 执行迁移（{totalSelected} 条）
        </button>
      </div>
    </div>
  )
}

/** 单张表的脚本折叠组 */
function TableScriptGroup({ tableName }: { tableName: string }) {
  const store = useMigrationStore()
  const [expanded, setExpanded] = useState(true)
  const stmts = store.scriptByTable[tableName] ?? []
  const selected = store.selectedByTable[tableName] ?? []

  const toggleAll = () => {
    const allSelected = selected.length === stmts.length && stmts.length > 0
    useMigrationStore.setState({
      selectedByTable: {
        ...store.selectedByTable,
        [tableName]: allSelected ? [] : stmts.map((_, i) => i),
      },
    })
  }

  return (
    <div className="table-group">
      <div className="table-group-header" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Database size={14} />
        <span className="table-group-name">{tableName}</span>
        <span className="table-group-count">
          {stmts.length} 条 · 已选 {selected.length}
        </span>
        <button
          className="btn btn-text btn-sm"
          onClick={(e) => {
            e.stopPropagation()
            toggleAll()
          }}
        >
          {selected.length === stmts.length ? '全不选' : '全选'}
        </button>
      </div>
      {expanded && (
        <div className="table-group-body">
          {stmts.map((stmt, i) => (
            <label key={i} className="script-row">
              <input
                type="checkbox"
                checked={selected.includes(i)}
                onChange={() => store.toggleStatement(tableName, i)}
              />
              <span className={`risk-badge ${RISK_CLASS[stmt.riskLevel]}`}>{stmt.riskLevel}</span>
              <span className={`script-kind script-kind-${stmt.kind}`}>
                {stmt.kind.toUpperCase()}
              </span>
              <pre className="script-sql">{stmt.sql}</pre>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 步骤4：执行结果 =====
function Step4Result() {
  const store = useMigrationStore()
  if (!store.batchResult) return null
  const { results, totalSuccess, totalFailed, durationMs } = store.batchResult

  return (
    <div className="step-content">
      <div
        className={`exec-summary ${totalFailed === 0 ? 'exec-summary-success' : 'exec-summary-mixed'}`}
      >
        {totalFailed === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
        <span>
          迁移完成：成功 {totalSuccess} 张表，失败 {totalFailed} 张表，总耗时 {durationMs}ms
        </span>
      </div>

      <div className="exec-table-results">
        {Object.entries(results).map(([tableName, result]) => (
          <div
            key={tableName}
            className={`exec-table-row ${result.success ? 'exec-row-success' : 'exec-row-failed'}`}
          >
            <div className="exec-row-header">
              {result.success ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
              <Database size={14} />
              <span className="exec-table-name">{tableName}</span>
              <span className="exec-table-meta">
                {result.success ? `成功 ${result.applied} 条` : '失败'} · {result.durationMs}ms
              </span>
            </div>
            {result.failedItems && result.failedItems.length > 0 && (
              <div className="exec-failed-items">
                {result.failedItems.map((f, i) => (
                  <div key={i} className="failed-item">
                    <span className="failed-item-sql">{f.sql.slice(0, 100) || '(空)'}</span>
                    <span className="failed-item-err">{f.error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="step-footer">
        <button className="btn btn-secondary" onClick={() => store.setStep(3)}>
          返回脚本
        </button>
        <button className="btn btn-primary" onClick={() => store.reset()}>
          新建迁移
        </button>
      </div>
    </div>
  )
}
