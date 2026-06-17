import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const result = item.result
  const meta =
    result != null
      ? t('agentCards.detailRowsMs', {
          count: result.rowCount,
          suffix:
            (result.durationMs > 0
              ? t('agentCards.detailSuffixMs', { ms: result.durationMs })
              : '') + (result.truncated ? t('agentCards.detailTruncated') : ''),
        })
      : ''

  return (
    <div className="modal-overlay result-detail-overlay" onClick={onClose}>
      <div className="result-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="result-detail-head">
          <div className="result-detail-title">
            <Database size={14} />
            <span className="result-detail-conn">
              {item.connName || t('agentCards.queryResultFallback')}
            </span>
            <span className="result-detail-time">
              <Clock size={11} style={{ display: 'inline', verticalAlign: 'middle' }} />
              {formatTime(item.time)}
            </span>
          </div>
          <button className="btn-icon" onClick={onClose} title={t('common.close')}>
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
            {t('agentCards.detailTitle')}
            {meta && <span className="result-detail-meta">{meta}</span>}
          </div>
          <div className="result-detail-grid">
            {result && result.columns.length > 0 ? (
              <DataGrid result={result} editable={false} />
            ) : result ? (
              <div className="result-detail-empty">
                {result.message ?? t('agentCards.emptyResultMsg')}
              </div>
            ) : item.ok ? (
              <div className="result-detail-empty">
                {item.affected?.message ??
                  t('errors.db.rowsAffected', { count: item.affected?.rows ?? 0 })}
              </div>
            ) : (
              <div className="result-detail-empty result-detail-error">
                {item.error ?? t('agentCards.execFailed')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
