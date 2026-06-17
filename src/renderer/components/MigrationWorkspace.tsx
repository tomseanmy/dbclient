/**
 * 数据库迁移工作区 —— 四步向导
 *
 * 步骤1：选源库 + 目标库（连接 + schema）
 * 步骤2：勾选源表 + 配置维度/策略/事务
 * 步骤3：生成脚本（按表分组）+ 勾选执行项
 * 步骤4：执行进度 + 结果
 */
import { useEffect, useState, useRef } from 'react'
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
import { useTranslation } from 'react-i18next'
import { translateReason } from '@shared/i18n/composite'
import { useMigrationStore } from '../store/migration'
import { useConnectionStore, DB_LABELS } from '../store/connections'
import { api, type GeneratedStatement, type ConnectionListItem } from '../api'

const STEP_LABEL_KEYS = [
  'migrationWizard.stepSelectDb',
  'migrationWizard.stepSelectTables',
  'migrationWizard.stepGenerate',
  'migrationWizard.stepExecute',
] as const

const RISK_CLASS: Record<GeneratedStatement['riskLevel'], string> = {
  safe: 'risk-safe',
  caution: 'risk-caution',
  danger: 'risk-danger',
}

export function MigrationWorkspace() {
  const { t } = useTranslation()
  const store = useMigrationStore()
  const { connections, loadConnections } = useConnectionStore()
  const [planName, setPlanName] = useState('')

  useEffect(() => {
    void loadConnections()
    void store.loadPlans()
  }, [store, loadConnections])

  return (
    <div className="migration-workspace">
      {/* 步骤指示器 */}
      <div className="migration-stepper">
        {STEP_LABEL_KEYS.map((key, i) => {
          const n = (i + 1) as 1 | 2 | 3 | 4
          return (
            <div
              key={n}
              className={`migration-step ${store.step === n ? 'migration-step-active' : ''} ${store.step > n ? 'migration-step-done' : ''}`}
              onClick={() => store.step >= n && store.setStep(n)}
            >
              <span className="step-number">{store.step > n ? '✓' : n}</span>
              <span className="step-label">{t(key)}</span>
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
      {store.step === 3 && <Step3Script planName={planName} setPlanName={setPlanName} />}

      {/* 步骤4：执行结果 */}
      {store.step === 4 && <Step4Result />}
    </div>
  )
}

// ===== 步骤1：选择源库 + 目标库 =====
function Step1Databases({ connections }: { connections: ConnectionListItem[] }) {
  const store = useMigrationStore()
  const { t } = useTranslation()
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
          title={t('migrationWizard.sourceDb')}
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
          title={t('migrationWizard.targetDb')}
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
          {t('migrationWizard.nextSelectTables')} <ChevronRight size={15} />
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
  const { t } = useTranslation()
  return (
    <div className="db-picker">
      <h4>{props.title}</h4>
      <div className="form-field">
        <label>{t('migrationWizard.conn')}</label>
        <select
          className="settings-select"
          value={props.connId}
          onChange={(e) => props.onConnChange(e.target.value)}
        >
          <option value="">{t('migrationWizard.selectConn')}</option>
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
            <option value="">{t('migrationWizard.defaultSchema')}</option>
            {props.schemas.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {props.state?.error && <div className="db-error">{props.state.error}</div>}
      {props.state?.connecting && (
        <div className="db-status">{t('migrationWizard.connecting')}</div>
      )}
    </div>
  )
}

// ===== 步骤2：选择表 + 设置 =====
function Step2Tables() {
  const store = useMigrationStore()
  const { t } = useTranslation()
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
          .filter((tbl) => tbl.type === 'table')
          .map((tbl) => ({
            sourceTable: tbl.name,
            targetTable: tbl.name,
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
          <span>{t('migrationWizard.enableDataMigration')}</span>
        </label>
        {store.includeData && (
          <div className="form-field">
            <label>{t('migrationWizard.dataStrategy')}</label>
            <select
              className="settings-select"
              value={store.strategy}
              onChange={(e) => store.setStrategy(e.target.value as never)}
            >
              <option value="incremental">{t('migrationWizard.strategyIncremental')}</option>
              <option value="fullReplace">{t('migrationWizard.strategyFullReplace')}</option>
              <option value="insertOnly">{t('migrationWizard.strategyInsertOnly')}</option>
            </select>
          </div>
        )}
        <div className="form-field">
          <label>{t('migrationWizard.transaction')}</label>
          <select
            className="settings-select"
            value={store.transaction}
            onChange={(e) => store.setTransaction(e.target.value as never)}
          >
            <option value="single">{t('migrationWizard.txSingle')}</option>
            <option value="perStatement">{t('migrationWizard.txPerStatement')}</option>
            {!store.includeData && <option value="none">{t('migrationWizard.txNone')}</option>}
          </select>
        </div>
      </div>

      {store.includeData && (
        <div className="migration-hint migration-hint-warning">
          {t('migrationWizard.noRowUpdateNote')}
        </div>
      )}

      <div className="table-select-list">
        <div className="table-select-header">
          <span>
            {t('migrationWizard.sourceTables', {
              count: sourceTables.filter((x) => x.type === 'table').length,
            })}
          </span>
          <span>{t('migrationWizard.targetTableName')}</span>
          <span>{t('migrationWizard.selectedTables', { count: selectedCount })}</span>
        </div>
        {store.tables.map((tbl) => (
          <label
            key={tbl.sourceTable}
            className={`table-select-row ${tbl.selected ? 'table-select-row-checked' : ''}`}
          >
            <input
              type="checkbox"
              checked={tbl.selected}
              onChange={() => store.toggleTable(tbl.sourceTable)}
            />
            <span className="table-source-name">
              <Database size={13} /> {tbl.sourceTable}
            </span>
            <input
              className="table-target-input"
              value={tbl.targetTable}
              onChange={(e) => store.setTargetTableName(tbl.sourceTable, e.target.value)}
              disabled={!tbl.selected}
              placeholder={t('migrationWizard.targetPlaceholder')}
            />
          </label>
        ))}
      </div>

      <div className="step-footer">
        <button className="btn btn-secondary" onClick={() => store.setStep(1)}>
          {t('migrationWizard.prevStep')}
        </button>
        <button
          className="btn btn-primary"
          disabled={selectedCount === 0 || store.loading}
          onClick={() => void store.generateAll()}
        >
          {store.loading
            ? t('migrationWizard.generating')
            : t('migrationWizard.generateScript', { count: selectedCount })}
        </button>
      </div>
    </div>
  )
}

// ===== 步骤3：生成脚本（按表分组） =====
function Step3Script(props: { planName: string; setPlanName: (v: string) => void }) {
  const store = useMigrationStore()
  const { t } = useTranslation()
  const tableNames = Object.keys(store.scriptByTable)
  const totalStmts = Object.values(store.scriptByTable).reduce((s, arr) => s + arr.length, 0)
  const totalSelected = Object.values(store.selectedByTable).reduce((s, arr) => s + arr.length, 0)

  const [warningsExpanded, setWarningsExpanded] = useState(false)
  const [showPlansLocal, setShowPlansLocal] = useState(false)
  const plansRef = useRef<HTMLDivElement>(null)

  // 点击 Popover 外部关闭方案库
  useEffect(() => {
    if (!showPlansLocal) return
    const handler = (e: MouseEvent) => {
      if (plansRef.current && !plansRef.current.contains(e.target as Node)) {
        setShowPlansLocal(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPlansLocal])

  const handleDownload = async () => {
    const allSql = Object.entries(store.scriptByTable)
      .map(([tbl]) => {
        const sel = store.selectedByTable[tbl] ?? []
        const stmts2 = store.scriptByTable[tbl] ?? []
        // 仅导出勾选的语句
        const filtered = sel.map((i) => stmts2[i]).filter((s): s is GeneratedStatement => !!s)
        return `-- ===== ${tbl} =====\n${filtered.map((s) => s.sql).join(';\n')}`
      })
      .join('\n\n;\n\n')
    await api['migration:exportScript']({ sql: allSql, defaultName: `migration-${Date.now()}.sql` })
  }

  return (
    <div className="step-content">
      {/* 类型告警（默认折叠，点击展开） */}
      {store.warnings.length > 0 && (
        <div className="migration-warnings">
          <div className="warnings-header" onClick={() => setWarningsExpanded(!warningsExpanded)}>
            {warningsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <AlertTriangle size={14} />
            <h4>{t('migrationWizard.typeMapWarnings', { count: store.warnings.length })}</h4>
          </div>
          {warningsExpanded &&
            store.warnings.map((w, i) => (
              <div key={i} className={`warning-item warning-${w.severity}`}>
                <AlertTriangle size={13} />
                <span className="warning-col">{w.column}</span>
                <span className="warning-types">
                  {w.fromType} → {w.toType}
                </span>
                <span className="warning-reason">{translateReason(w.reason, t)}</span>
              </div>
            ))}
        </div>
      )}

      {/* 工具栏 */}
      <div className="script-toolbar">
        <span className="script-count">
          {t('migrationWizard.scriptSummary', { tables: tableNames.length, stmts: totalStmts })}
        </span>
        <span className="script-selected">
          {t('migrationWizard.scriptSelected', { count: totalSelected })}
        </span>
        <div className="script-toolbar-spacer" />
        <input
          className="plan-name-input"
          placeholder={t('migrationWizard.planNamePlaceholder')}
          value={props.planName}
          onChange={(e) => props.setPlanName(e.target.value)}
        />
        <button
          className="btn btn-text btn-sm"
          onClick={() =>
            void store.savePlan(
              props.planName ||
                t('migrationWizard.savePlanFallback', { date: new Date().toLocaleString() }),
            )
          }
        >
          <Save size={14} /> {t('migrationWizard.savePlan')}
        </button>
        <div className="plans-popover-wrapper" ref={plansRef}>
          <button
            className="btn btn-text btn-sm"
            onClick={() => {
              setShowPlansLocal(!showPlansLocal)
              if (!showPlansLocal) void store.loadPlans()
            }}
          >
            {t('migrationWizard.planLibrary', { count: store.plans.length })}
          </button>
          {showPlansLocal && store.plans.length > 0 && (
            <div className="plans-popover">
              {store.plans.map((p) => (
                <div key={p.id} className="plan-item">
                  <div className="plan-item-info">
                    <span className="plan-name">{p.name}</span>
                    <span className="plan-meta">
                      {t('migrationWizard.planTables', { count: p.pairs.length })}
                    </span>
                  </div>
                  <button
                    className="btn btn-text btn-sm"
                    onClick={() => {
                      store.loadPlan(p)
                      setShowPlansLocal(false)
                    }}
                  >
                    {t('migrationWizard.load')}
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
        </div>
        <button className="btn btn-text btn-sm" onClick={handleDownload}>
          <Download size={13} /> {t('migrationWizard.exportSql')}
        </button>
      </div>

      {/* 按表分组的脚本 */}
      <div className="script-groups">
        {tableNames.map((tableName) => (
          <TableScriptGroup key={tableName} tableName={tableName} />
        ))}
      </div>

      <div className="step-footer">
        <button className="btn btn-secondary" onClick={() => store.setStep(2)}>
          {t('migrationWizard.prevStep')}
        </button>
        <button
          className="btn btn-warning"
          disabled={store.executing || totalSelected === 0}
          onClick={() => void store.execute()}
        >
          <Play size={15} /> {t('migrationWizard.executeMigration', { count: totalSelected })}
        </button>
      </div>
    </div>
  )
}

/** 单张表的脚本折叠组 */
function TableScriptGroup({ tableName }: { tableName: string }) {
  const store = useMigrationStore()
  const { t } = useTranslation()
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
          {t('migrationWizard.stmtsSelected', { total: stmts.length, count: selected.length })}
        </span>
        <button
          className="btn btn-text btn-sm"
          onClick={(e) => {
            e.stopPropagation()
            toggleAll()
          }}
        >
          {selected.length === stmts.length
            ? t('migrationWizard.selectAllToggle')
            : t('migrationWizard.selectAllToggleAlt')}
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
  const { t } = useTranslation()
  if (!store.batchResult) return null
  const { results, totalSuccess, totalFailed, durationMs } = store.batchResult

  return (
    <div className="step-content">
      <div
        className={`exec-summary ${totalFailed === 0 ? 'exec-summary-success' : 'exec-summary-mixed'}`}
      >
        {totalFailed === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
        <span>
          {t('migrationWizard.migrationComplete', {
            success: totalSuccess,
            failed: totalFailed,
            ms: durationMs,
          })}
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
                {result.success
                  ? t('migrationWizard.batchResult', {
                      applied: result.applied,
                      ms: result.durationMs,
                    })
                  : t('migrationWizard.batchFailed', { ms: result.durationMs })}
              </span>
            </div>
            {result.failedItems && result.failedItems.length > 0 && (
              <div className="exec-failed-items">
                {result.failedItems.map((f, i) => (
                  <div key={i} className="failed-item">
                    <span className="failed-item-sql">
                      {f.sql.slice(0, 100) || t('migrationWizard.failedEmptySql')}
                    </span>
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
          {t('migrationWizard.backToScript')}
        </button>
        <button className="btn btn-primary" onClick={() => store.reset()}>
          {t('migrationWizard.newMigration')}
        </button>
      </div>
    </div>
  )
}
