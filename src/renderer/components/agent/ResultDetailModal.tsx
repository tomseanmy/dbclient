/**
 * 执行结果详情弹窗（独立窗口，上下结构）
 *
 * 解决：右侧执行历史面板太窄，不适合展示查询结果。改为点击「查询类」历史项
 * 弹出全屏弹窗：上半 SQL editor（只读）、下半查询结果列表（DataGrid）。
 *
 * 仅查询类（有结果集 columns）条目可打开；增删改类在列表态直接标记影响行数、禁用点击。
 */
import { X, Database, Clock } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { DataGrid } from '../DataGrid'
import { formatTime } from '../../lib/format'
import type { ExecHistoryItem } from './types'

export function ResultDetailModal({
  item,
  onClose,
}: {
  item: ExecHistoryItem
  onClose: () => void
}) {
  const result = item.result
  const meta =
    result != null
      ? `${result.rowCount} 行${result.durationMs > 0 ? ` · ${result.durationMs}ms` : ''}${
          result.truncated ? ' · 已截断' : ''
        }`
      : ''

  return (
    <div className="modal-overlay result-detail-overlay" onClick={onClose}>
      <div className="result-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="result-detail-head">
          <div className="result-detail-title">
            <Database size={14} />
            <span className="result-detail-conn">{item.connName || '查询结果'}</span>
            <span className="result-detail-time">
              <Clock size={11} style={{ display: 'inline', verticalAlign: 'middle' }} />
              {formatTime(item.time)}
            </span>
          </div>
          <button className="btn-icon" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 上：SQL editor（只读） */}
        <div className="result-detail-sql">
          <div className="result-detail-section-label">SQL</div>
          <div className="result-detail-editor">
            <Editor
              height="220px"
              language="sql"
              theme="vs-dark"
              value={item.sql}
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
          </div>
        </div>

        {/* 下：查询结果列表 */}
        <div className="result-detail-result">
          <div className="result-detail-section-label">
            结果{meta && <span className="result-detail-meta">{meta}</span>}
          </div>
          <div className="result-detail-grid">
            {result && result.columns.length > 0 ? (
              <DataGrid result={result} editable={false} />
            ) : result ? (
              <div className="result-detail-empty">{result.message ?? '执行成功（无结果集）'}</div>
            ) : item.ok ? (
              <div className="result-detail-empty">
                {item.affected?.message ?? `${item.affected?.rows ?? 0} 行受影响`}
              </div>
            ) : (
              <div className="result-detail-empty result-detail-error">
                {item.error ?? '执行失败'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
