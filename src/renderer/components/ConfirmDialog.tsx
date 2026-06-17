/**
 * 危险操作确认弹窗
 *
 * 显示 SQL + 风险级别 + 原因。
 * 最高危操作（DROP/TRUNCATE）要求手动输入关键词。
 */
import { useState } from 'react'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { translateReason } from '@shared/i18n/composite'
import type { SecurityCheckResult } from '../api'

interface ConfirmDialogProps {
  check: SecurityCheckResult
  sql: string
  onConfirm: (keyword?: string) => void
  onCancel: () => void
}

export function ConfirmDialog({ check, sql, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const isHighest = check.requireKeywordConfirm

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal confirm-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <div className="confirm-header">
          {isHighest ? (
            <ShieldAlert size={20} color="var(--danger)" />
          ) : (
            <AlertTriangle size={20} color="var(--warning)" />
          )}
          <h3>{isHighest ? t('confirm.highestTitle') : t('confirm.title')}</h3>
        </div>

        <p className="confirm-reason">{translateReason(check.reason, t)}</p>

        <div className="confirm-analysis">
          {check.analysis.reasons.map((r, i) => (
            <div key={i} className="confirm-reason-item">
              • {translateReason(r, t)}
            </div>
          ))}
          {check.analysis.tables.length > 0 && (
            <div className="confirm-tables">
              {t('confirm.tablesInvolved')}: {check.analysis.tables.join(', ')}
            </div>
          )}
        </div>

        <pre className="confirm-sql">{sql}</pre>

        {isHighest && (
          <div className="confirm-keyword-section">
            <label>
              {t('confirm.keywordPrompt')} <code>{check.confirmKeyword}</code>
              {t('confirm.keywordPromptSuffix')}
            </label>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={check.confirmKeyword}
              autoFocus
            />
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => onConfirm(isHighest ? keyword : undefined)}
            disabled={isHighest && keyword !== check.confirmKeyword}
          >
            {isHighest ? t('confirm.confirmExecute') : t('common.execute')}
          </button>
        </div>
      </div>
    </div>
  )
}
