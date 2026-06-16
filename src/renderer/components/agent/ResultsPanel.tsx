/**
 * AGENT 右侧执行历史面板（从 AgentWorkspace 拆分）
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
  // 折叠态：竖排窄条，左侧向左箭头表示「可向左展开」
  if (collapsed) {
    return (
      <aside className="agent-results-panel agent-results-collapsed">
        <button
          className="agent-results-expand-btn"
          onClick={onToggleCollapse}
          title="展开结果面板"
        >
          <ChevronLeft size={15} />
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
          执行历史
          {history.length > 0 && (
            <button className="btn-icon agent-results-clear" onClick={onClear} title="清空历史">
              <Trash2 size={13} />
            </button>
          )}
        </span>
        {/* 展开态：向右箭头表示「可向右收起」 */}
        <button
          className="btn-icon agent-results-collapse"
          onClick={onToggleCollapse}
          title="折叠面板"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="agent-results-body">
        {history.length === 0 ? (
          <div className="agent-results-placeholder">
            <Terminal size={20} />
            <p>执行 SQL 后，结果会出现在这里</p>
            <p className="muted">点击卡片中的「执行」按钮开始</p>
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
                    title={isQuery ? '点击查看查询结果' : undefined}
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
                        `· ${item.result.rowCount} 行`}
                      {item.ok &&
                        !item.result &&
                        `· ${item.affected?.message ?? (item.affected?.rows ?? 0) + ' 行受影响'}`}
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
