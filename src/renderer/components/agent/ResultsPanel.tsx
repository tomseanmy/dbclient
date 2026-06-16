/**
 * AGENT 右侧执行历史结果面板（从 AgentWorkspace 拆分）
 *
 * - 列表态：展示历次执行记录（时间 / SQL 摘要 / 状态），点击切换到结果视图。
 * - 结果态：用 DataGrid 渲染查询结果表（同表数据页体验），非查询语句只显示行数提示。
 */
import { ChevronLeft, Clock, Trash2, Terminal } from 'lucide-react'
import { DataGrid } from '../DataGrid'
import { formatTime } from '../../lib/format'
import type { ExecHistoryItem } from './types'

export function ResultsPanel({
  history,
  activeResultId,
  collapsed,
  onSelect,
  onToggleCollapse,
  onClear,
}: {
  history: ExecHistoryItem[]
  activeResultId: string | null
  collapsed: boolean
  onSelect: (id: string | null) => void
  onToggleCollapse: () => void
  onClear: () => void
}) {
  const active = activeResultId ? (history.find((h) => h.id === activeResultId) ?? null) : null

  // 折叠态：只渲染一个展开按钮（竖排窄条）
  if (collapsed) {
    return (
      <aside className="agent-results-panel agent-results-collapsed">
        <button
          className="agent-results-expand-btn"
          onClick={onToggleCollapse}
          title="展开结果面板"
        >
          <ChevronLeft size={15} className="agent-results-expand-icon" />
          <span className="agent-results-expand-label">
            {history.length > 0 ? `结果 ${history.length}` : '结果'}
          </span>
        </button>
      </aside>
    )
  }

  return (
    <aside className="agent-results-panel">
      <div className="agent-results-head">
        <span className="agent-results-title">
          {active ? '查询结果' : '执行历史'}
          {!active && history.length > 0 && (
            <button className="btn-icon agent-results-clear" onClick={onClear} title="清空历史">
              <Trash2 size={13} />
            </button>
          )}
        </span>
        <div className="agent-results-head-actions">
          {active && (
            <button
              className="btn-icon agent-results-back"
              onClick={() => onSelect(null)}
              title="返回列表"
            >
              <ChevronLeft size={15} />
            </button>
          )}
          <button
            className="btn-icon agent-results-collapse"
            onClick={onToggleCollapse}
            title="折叠面板"
          >
            <ChevronLeft size={15} className="agent-results-collapse-icon" />
          </button>
        </div>
      </div>

      <div className="agent-results-body">
        {active ? (
          active.ok && active.result ? (
            active.result.columns.length > 0 ? (
              <div className="agent-results-grid">
                <div className="agent-results-meta">
                  {active.result.rowCount} 行
                  {active.result.durationMs > 0 && ` · ${active.result.durationMs}ms`}
                  {active.result.truncated && ' · 已截断'}
                </div>
                <DataGrid result={active.result} editable={false} />
              </div>
            ) : (
              <div className="agent-results-empty">
                {active.result.message ?? '执行成功（无结果集）'}
              </div>
            )
          ) : (
            <div className="agent-results-error">{active.error ?? '执行失败'}</div>
          )
        ) : history.length === 0 ? (
          <div className="agent-results-placeholder">
            <Terminal size={20} />
            <p>执行 SQL 后，结果会出现在这里</p>
            <p className="muted">点击卡片中的「执行」按钮开始</p>
          </div>
        ) : (
          <ul className="agent-result-list">
            {history.map((item) => (
              <li key={item.id}>
                <button
                  className={`agent-result-item ${item.ok ? '' : 'is-error'}`}
                  onClick={() => onSelect(item.id)}
                >
                  <span className={`agent-result-status ${item.ok ? 'ok' : 'err'}`}>
                    {item.ok ? '✓' : '✗'}
                  </span>
                  <span className="agent-result-sql" title={item.sql}>
                    {item.sql}
                  </span>
                  <span className="agent-result-meta-row">
                    <Clock size={10} />
                    {formatTime(item.time)}
                    {item.connName && <span className="muted">· {item.connName}</span>}
                    {item.ok && item.result && item.result.columns.length > 0 && (
                      <span className="muted">· {item.result.rowCount} 行</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
