/**
 * SQL 工作区（M3 版本）
 *
 * 执行流程：
 *   1. 用户点执行
 *   2. 先调 db:checkSql 预检
 *   3a. allowed → 直接执行 db:executeQuery
 *   3b. confirmRequired → 弹 ConfirmDialog，确认后调 db:confirmExecute
 *   3c. denied → 显示 PermissionNotice（可提权）
 *
 * 布局（需求 3）：
 *   左侧主区 = 编辑器 + 自然语言输入栏 + 结果区（DataGrid）
 *   右侧侧栏 = AI 辅助卡片（类似 VSCode 中的 Claude Code）
 *
 * 保存关联（需求 1）：
 *   - 从保存查询打开时携带 savedQueryId，之后 Cmd/Ctrl+S 直接更新该记录（不再弹命名框）
 *   - 未关联的查询首次保存需命名，保存后绑定 id；后续再保存直接更新
 *   - tab 脏标记 = 当前编辑器内容偏离「上次保存的基线」
 */
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { Download, Copy, Check, ChevronDown, Sparkles, Wrench, Save, X } from 'lucide-react'
import { api, type ConnectionListItem, type QueryResult, type SecurityCheckResult } from '../api'
import type { AssistAction } from '../api'
import { useConnectionStore } from '../store/connections'
import { SqlEditor } from './SqlEditor'
import { DataGrid } from './DataGrid'
import { SqlHistory } from './SqlHistory'
import { SavedQueries } from './SavedQueries'
import { ConfirmDialog } from './ConfirmDialog'
import { notify } from '../services/notifications'
import { PermissionNotice } from './PermissionNotice'
import { AiAssistPanel } from './AiAssistPanel'
import { useTabStore } from '../store/tabs'
import {
  setCompletionContext,
  clearCompletionContext,
  invalidateCompletionCache,
} from '../services/sql-completion'
import { exportResultCsv, exportResultJson } from '../lib/export'

/** SQL 编辑器初始模板，偏离即视为「已编辑」 */
const INITIAL_SQL = i18next.t('sql.initialSql')

interface SqlWorkspaceProps {
  connection: ConnectionListItem
  /** 所属 tab 的 id，用于上报脏状态（编辑器内容偏离初始模板） */
  tabId: string
  /** 预填的初始 SQL（从保存的查询打开时） */
  initialSql?: string
  /** 关联的保存查询 id（从保存的查询打开时；之后保存直接更新该记录） */
  savedQueryId?: string
  /**
   * 首次保存（新建查询落地为记录）后回调，通知父组件把当前 tab
   * 关联到该保存查询（更新 savedQueryId/Name，让 tab 标题变为「查询名@数据库」）。
   */
  onQueryBound?: (savedQuery: { id: string; name: string }) => void
}

export function SqlWorkspace({
  connection,
  tabId,
  initialSql,
  savedQueryId: initialSavedQueryId,
  onQueryBound,
}: SqlWorkspaceProps) {
  const { t } = useTranslation()
  const triggerRefresh = useConnectionStore((s) => s.triggerRefresh)
  const [sql, setSql] = useState(initialSql ?? INITIAL_SQL)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmCheck, setConfirmCheck] = useState<SecurityCheckResult | null>(null)
  const [confirmSql, setConfirmSql] = useState('')
  const [deniedCheck, setDeniedCheck] = useState<SecurityCheckResult | null>(null)
  const [aiPanel, setAiPanel] = useState<{
    action: AssistAction
    payload: { sql?: string; naturalText?: string; error?: string }
  } | null>(null)
  const [nlInput, setNlInput] = useState('')
  /** 保存查询弹窗（首次命名时） */
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  /** 当前关联的保存查询 id（绑定的记录），null 表示尚未关联 */
  const [savedQueryId, setSavedQueryId] = useState<string | undefined>(initialSavedQueryId)
  /**
   * 「上次保存的基线」：编辑器内容偏离此值即视为有改动（驱动 tab 脏标记）。
   * - 从保存查询打开：基线 = 该查询内容（打开即「干净」）
   * - 新建查询：基线 = 初始模板
   * - 每次保存后更新为最新内容，脏标记随之清除
   */
  const [baselineSql, setBaselineSql] = useState(
    initialSavedQueryId ? (initialSql ?? INITIAL_SQL) : INITIAL_SQL,
  )

  const isMac = typeof window !== 'undefined' && window.platform === 'darwin'

  /** 执行保存：已关联记录 → 直接更新；未关联 → 新建并绑定 id */
  const handleSave = useCallback(async () => {
    const sqlText = sql.trim()
    if (!sqlText) return
    setSaving(true)
    try {
      if (savedQueryId) {
        // 已关联：直接更新内容，不再弹命名框
        await api['savedQuery:update']({ id: savedQueryId, patch: { sqlText } })
        setSql(sqlText)
        setBaselineSql(sqlText)
      } else {
        // 未关联：新建（名称留空时取 SQL 前 30 字符）
        const name = saveName.trim() || sqlText.slice(0, 30)
        const record = await api['savedQuery:save']({
          name,
          sqlText,
          connectionId: connection.id,
        })
        setSavedQueryId(record.id)
        setSql(sqlText)
        setBaselineSql(sqlText)
        setSaveName('')
        setSaveOpen(false)
        // 通知父组件：当前 tab 关联到这个新记录（迁移 id + 更新标题）
        onQueryBound?.({ id: record.id, name: record.name })
      }
      // 触发刷新，让数据库详情页「查询」tab 重新加载保存的列表
      triggerRefresh()
      // 窗口失焦时提醒保存完成
      void notify('queryComplete', t('sql.savedTitle'), t('sql.savedBody'))
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [sql, saveName, savedQueryId, connection.id, triggerRefresh, onQueryBound, t])

  // Cmd/Ctrl+S 保存当前 SQL（阻止浏览器默认保存）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        const sqlText = sql.trim()
        if (!sqlText || sql === baselineSql) return
        if (savedQueryId) {
          // 已关联：直接静默更新，不弹窗
          void handleSave()
        } else {
          // 未关联：首次命名
          setSaveName('')
          setSaveOpen(true)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [sql, baselineSql, savedQueryId, handleSave])

  // 上报脏状态到 tab store（编辑器内容偏离「上次保存基线」即视为有改动）
  const setTabDirty = useTabStore((s) => s.setDirty)
  useEffect(() => {
    setTabDirty(tabId, sql.trim() !== baselineSql.trim())
  }, [tabId, sql, baselineSql, setTabDirty])

  // 设置 SQL 补全上下文（当前连接），卸载时清除；refreshTick 变化时失效缓存
  const refreshTick = useConnectionStore((s) => s.refreshTick)
  useEffect(() => {
    setCompletionContext(connection.id, undefined)
    return () => clearCompletionContext()
  }, [connection.id])
  useEffect(() => {
    // 对象树刷新（DDL 执行后）时，失效该连接的补全缓存
    if (refreshTick > 0) invalidateCompletionCache(connection.id)
  }, [refreshTick, connection.id])

  const doExecute = useCallback(
    async (sqlToRun: string) => {
      setExecuting(true)
      setError(null)
      setResult(null)
      try {
        const res = await api['db:executeQuery']({
          connectionId: connection.id,
          sql: sqlToRun,
        })
        setResult(res)
        // 如果是写操作（有 message 说明是非 SELECT），刷新对象树
        if (res.message) {
          triggerRefresh()
        }
        // 窗口失焦时提醒用户查询已完成
        void notify(
          'queryComplete',
          t('sql.queryComplete'),
          res.message
            ? res.message
            : t('sql.resultRowsMs', { count: res.rowCount ?? 0, ms: res.durationMs ?? 0 }),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setExecuting(false)
      }
    },
    [connection.id, triggerRefresh, t],
  )

  const handleExecute = useCallback(
    async (sqlToRun: string) => {
      if (!sqlToRun.trim()) return
      setExecuting(true)
      setError(null)
      setResult(null)
      setDeniedCheck(null)

      try {
        // 先预检
        const check = await api['db:checkSql']({
          connectionId: connection.id,
          sql: sqlToRun,
        })

        if (check.denied) {
          setDeniedCheck(check)
          setExecuting(false)
          return
        }

        if (check.confirmRequired) {
          setConfirmCheck(check)
          setConfirmSql(sqlToRun)
          setExecuting(false)
          return
        }

        // 直接执行
        await doExecute(sqlToRun)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setExecuting(false)
      }
    },
    [connection.id, doExecute],
  )

  const handleConfirm = async (keyword?: string) => {
    setConfirmCheck(null)
    setExecuting(true)
    try {
      const res = await api['db:confirmExecute']({
        connectionId: connection.id,
        sql: confirmSql,
        confirmedKeyword: keyword,
      })
      setResult(res)
      // 确认执行的是危险操作，一定刷新
      triggerRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExecuting(false)
    }
  }

  const exportCsv = () => {
    if (!result) return
    exportResultCsv(connection.name + '-query.csv', result)
    setExportOpen(false)
  }

  const exportJson = () => {
    if (!result) return
    exportResultJson(connection.name + '-query.json', result)
    setExportOpen(false)
  }

  const copyResult = async () => {
    if (!result) return
    const headers = result.columns.map((c) => c.name).join('\t')
    const lines = result.rows.map((row) =>
      result.columns
        .map((c) => (row[c.name] === null ? '' : String(row[c.name])).replace(/\t/g, ' '))
        .join('\t'),
    )
    await navigator.clipboard.writeText([headers, ...lines].join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    setExportOpen(false)
  }

  // ===== AI 辅助（结果展示在右侧侧栏，见需求 3） =====
  const handleAiExplain = useCallback((sqlText: string) => {
    setAiPanel({ action: 'explain', payload: { sql: sqlText } })
  }, [])

  const handleAiOptimize = useCallback((sqlText: string) => {
    setAiPanel({ action: 'optimize', payload: { sql: sqlText } })
  }, [])

  const handleNl2Sql = useCallback(() => {
    const text = nlInput.trim()
    if (!text) return
    setAiPanel({ action: 'nl2sql', payload: { naturalText: text } })
    setNlInput('')
  }, [nlInput])

  const handleAiFixError = useCallback(() => {
    if (!error) return
    setAiPanel({ action: 'fixError', payload: { sql, error } })
  }, [error, sql])

  const dialect =
    connection.type === 'postgres'
      ? 'postgresql'
      : connection.type === 'sqlite'
        ? 'sqlite'
        : 'mysql'

  // AI 侧栏内容：有正在进行的 AI 任务时才展示（需求 3）
  const aiSide = useMemo(
    () =>
      aiPanel ? (
        <AiAssistPanel
          connection={connection}
          action={aiPanel.action}
          payload={aiPanel.payload}
          onClose={() => setAiPanel(null)}
          onInsertSql={(s) => {
            setSql(s)
            setAiPanel(null)
          }}
          onExecuteSql={(s) => {
            handleExecute(s)
            setAiPanel(null)
          }}
        />
      ) : null,
    [aiPanel, connection, handleExecute],
  )

  return (
    <div className={`sql-workspace ${aiSide ? 'sql-workspace-with-side' : ''}`}>
      {/* 左侧主区：编辑器 + 自然语言输入 + 结果 */}
      <div className="sql-workspace-main">
        <SqlEditor
          value={sql}
          onChange={setSql}
          onExecute={handleExecute}
          executing={executing}
          dialect={dialect}
          onAiExplain={handleAiExplain}
          onAiOptimize={handleAiOptimize}
          database={connection.database || connection.name}
        />

        {/* 自然语言转 SQL 输入框 */}
        <div className="nl2sql-bar">
          <Sparkles size={12} />
          <input
            className="nl2sql-input"
            value={nlInput}
            onChange={(e) => setNlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNl2Sql()
            }}
            placeholder={t('sql.nlPlaceholder')}
          />
          <button
            className="btn btn-sm btn-primary"
            onClick={handleNl2Sql}
            disabled={!nlInput.trim()}
          >
            {t('sql.generateSql')}
          </button>
        </div>

        {deniedCheck && (
          <PermissionNotice
            check={deniedCheck}
            connectionId={connection.id}
            onElevated={() => {
              setDeniedCheck(null)
              handleExecute(confirmSql || sql)
            }}
            onDismiss={() => setDeniedCheck(null)}
          />
        )}

        {confirmCheck && (
          <ConfirmDialog
            check={confirmCheck}
            sql={confirmSql}
            onConfirm={handleConfirm}
            onCancel={() => setConfirmCheck(null)}
          />
        )}

        {error && (
          <div className="result-error result-error-inline">
            <div className="result-error-head">
              <strong>{t('sql.execError')}</strong>
              <button className="btn btn-sm btn-warning" onClick={handleAiFixError}>
                <Wrench size={12} /> {t('sql.letAiFix')}
              </button>
            </div>
            <pre>{error}</pre>
          </div>
        )}

        {/* 结果区：贴合容器，不再使用圆角/边框/外边距（需求 2） */}
        {result ? (
          <div className="result-section">
            <div className="result-toolbar">
              <span className="result-info">
                {t('sql.resultRows', { count: result.rowCount })}
                {result.durationMs > 0 && ' · ' + result.durationMs + 'ms'}
                {result.truncated && <span className="truncated-warn">{t('sql.truncated')}</span>}
                {result.message && <span className="result-message">{result.message}</span>}
              </span>
              <div className="result-actions">
                <button
                  className="btn-icon btn-text"
                  onClick={copyResult}
                  title={t('sql.copyResult')}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />} {t('common.copy')}
                </button>
                <div className="export-wrapper">
                  <button className="btn-icon btn-text" onClick={() => setExportOpen(!exportOpen)}>
                    <Download size={12} /> {t('sql.export')} <ChevronDown size={10} />
                  </button>
                  {exportOpen && (
                    <div className="export-menu">
                      <button onClick={exportCsv}>CSV</button>
                      <button onClick={exportJson}>JSON</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* 与表数据页共用同一个 DataGrid（需求 2） */}
            <div className="result-grid-wrapper">
              <DataGrid result={result} />
            </div>
          </div>
        ) : (
          !error &&
          !deniedCheck && (
            <div className="result-placeholder">
              <p>{t('sql.resultEmpty')}</p>
            </div>
          )
        )}

        <SqlHistory connectionId={connection.id} onPick={(s) => setSql(s)} />
        <SavedQueries connectionId={connection.id} currentSql={sql} onPick={(s) => setSql(s)} />

        {/* 保存查询弹窗（首次命名） */}
        {saveOpen && (
          <div className="modal-overlay" onClick={() => setSaveOpen(false)}>
            <div className="modal save-sql-modal" onClick={(e) => e.stopPropagation()}>
              <div className="confirm-header">
                <Save size={18} color="var(--primary)" />
                <h3>{t('sql.saveQuery')}</h3>
              </div>
              <p className="save-sql-hint">{t('sql.saveQueryDesc')}</p>
              <input
                className="save-sql-name-input"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t('sql.queryNamePlaceholder')}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                }}
              />
              <pre className="save-sql-preview">
                {sql.slice(0, 200)}
                {sql.length > 200 ? '…' : ''}
              </pre>
              <div className="modal-actions">
                <span className="save-sql-shortcut">{isMac ? '⌘' : 'Ctrl'} + S</span>
                <div className="toolbar-spacer" />
                <button className="btn btn-secondary" onClick={() => setSaveOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? t('connection.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 右侧 AI 侧栏（需求 3）：类似 VSCode 中的 Claude Code */}
      {aiSide && (
        <aside className="sql-workspace-aiside">
          <div className="sql-workspace-aiside-head">
            <Sparkles size={14} />
            <span>{t('sql.aiAssistant')}</span>
            <div className="toolbar-spacer" />
            <button
              className="btn-icon"
              title={t('sql.closeSidebar')}
              onClick={() => setAiPanel(null)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="sql-workspace-aiside-body">{aiSide}</div>
        </aside>
      )}
    </div>
  )
}
