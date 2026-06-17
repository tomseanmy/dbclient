import { useTranslation } from 'react-i18next'
/**
 * AGENT 右侧{t('agentCards.execHistory')}面板（从 AgentWorkspace 拆分）
 *
 * 仅列表态：展示历次执行记录（状态 / SQL 摘要 / 时间 / 影响行数）。
 * - 查询类（有结果集 columns）：可点击 → onOpenDetail 弹出独立详情窗口。
 * - 增删改类（无结果集）：直接在列表标记影响行数，禁用点击（无需详情）。
 * - 失败：显示错误摘要，禁用点击。
 */
import { ChevronRight, ChevronLeft, Clock, Trash2, Terminal } from 'lucide-react'
import { formatTime } from '../../lib/format'
import type { ExecHistoryItem } from './types'

/** 是否为「查询类」条目（有结果集列，可展开详情窗口） */
function isQueryItem(item: ExecHistoryItem): boolean {
  return !!(item.ok && item.result && item.result.columns.length > 0)
}

export function ResultsPanel({
  history,
  collapsed,
  onOpenDetail,
  onToggleCollapse,
  onClear,
}: {
  history: ExecHistoryItem[]
  collapsed: boolean
  /** 点击查询类历史项：弹出详情窗口 */
  onOpenDetail: (item: ExecHistoryItem) => void
  onToggleCollapse: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  // 折叠态：竖排窄条，左侧向左箭头表示「可向左展开」
  if (collapsed) {
    return (
      <aside className="agent-results-panel agent-results-collapsed">
        <button
          className="agent-results-expand-btn"
          onClick={onToggleCollapse}
          title={t('agentCards.expandResults')}
        >
          <ChevronLeft size={15} />
          <span className="agent-results-expand-label">
            {history.length > 0
              ? t('agentCards.resultsCount', { count: history.length })
              : t('agentCards.results')}
          </span>
        </button>
      </aside>
    )
  }

  return (
    <aside className="agent-results-panel">
      <div className="agent-results-head">
        <span className="agent-results-title">
          {t('agentCards.execHistory')}
          {history.length > 0 && (
            <button
              className="btn-icon agent-results-clear"
              onClick={onClear}
              title={t('agentCards.clearHistory')}
            >
              <Trash2 size={13} />
            </button>
          )}
        </span>
        {/* 展开态：向右箭头表示「可向右收起」 */}
        <button
          className="btn-icon agent-results-collapse"
          onClick={onToggleCollapse}
          title={t('agentCards.collapseResults')}
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="agent-results-body">
        {history.length === 0 ? (
          <div className="agent-results-placeholder">
            <Terminal size={20} />
            <p>{t('agentCards.emptyHint')}</p>
            <p className="muted">{t('agentCards.emptyHint2')}</p>
          </div>
        ) : (
          <ul className="agent-result-list">
            {history.map((item) => {
              const isQuery = isQueryItem(item)
              return (
                <li key={item.id}>
                  <div
                    className={`agent-result-item ${item.ok ? '' : 'is-error'} ${
                      isQuery ? 'is-clickable' : 'is-static'
                    }`}
                    onClick={isQuery ? () => onOpenDetail(item) : undefined}
                    role={isQuery ? 'button' : undefined}
                    tabIndex={isQuery ? 0 : undefined}
                    onKeyDown={
                      isQuery
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onOpenDetail(item)
                            }
                          }
                        : undefined
                    }
                    title={isQuery ? t('agentCards.viewQueryResult') : undefined}
                  >
                    <div className="agent-result-row-top">
                      <span className={`agent-result-status ${item.ok ? 'ok' : 'err'}`}>
                        {item.ok ? '✓' : '✗'}
                      </span>
                      <span className="agent-result-sql" title={item.sql}>
                        {item.sql}
                      </span>
                    </div>
                    <span className="agent-result-meta-row">
                      <Clock size={10} />
                      {formatTime(item.time)}
                      {item.connName && <span className="muted">· {item.connName}</span>}
                      {/* 查询类：行数；增删改类：影响行数；失败：无附加 */}
                      {item.ok &&
                        item.result &&
                        item.result.columns.length > 0 &&
                        t('agentCards.rowsAffected', { count: item.result.rowCount })}
                      {item.ok && !item.result && item.affected?.message
                        ? t('agentCards.rowsAffectedMsg', { message: item.affected.message })
                        : t('agentCards.rowsAffected', { count: item.affected?.rows ?? 0 })}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
