/**
 * AI 辅助面板（可复用）
 *
 * 在 SqlWorkspace 内展示 AI 对「解释/优化/NL2SQL/修复」的回复。
 * 包含回复文本 + SQL 卡片（复制/{t('aiAssist.insert')}编辑器/执行）。
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { ConnectionListItem, AiChatResponse, AssistAction } from '../api'
import { Loader2, X, Sparkles, Zap, MessageCircle, Wrench, Lock } from 'lucide-react'

interface AiAssistPanelProps {
  connection: ConnectionListItem
  /** 当前动作 */
  action: AssistAction
  /** 动作输入 */
  payload: { sql?: string; naturalText?: string; error?: string }
  onClose: () => void
  /** 点击「{t('aiAssist.insert')}编辑器」时回调（把 SQL 填入编辑器） */
  onInsertSql?: (sql: string) => void
  /** 点击「执行」时回调 */
  onExecuteSql?: (sql: string) => void
}

const ACTION_ICON: Record<AssistAction, React.ReactNode> = {
  explain: <Sparkles size={13} />,
  optimize: <Zap size={13} />,
  nl2sql: <MessageCircle size={13} />,
  fixError: <Wrench size={13} />,
}

const ACTION_TEXT: Record<AssistAction, string> = {
  explain: 'enums.assistAction.explain',
  optimize: 'enums.assistAction.optimize',
  nl2sql: 'enums.assistAction.nl2sql',
  fixError: 'enums.assistAction.fixError',
}

export function AiAssistPanel({
  connection,
  action,
  payload,
  onClose,
  onInsertSql,
  onExecuteSql,
}: AiAssistPanelProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiChatResponse | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // 挂载即触发 AI 调用
  useEffect(() => {
    let cancelled = false
    api['ai:assist']({
      connectionId: connection.id,
      action,
      payload,
    })
      .then((res) => {
        if (!cancelled) setResult(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载时调用一次
  }, [])

  const handleCopy = (sql: string) => {
    navigator.clipboard.writeText(sql)
    setCopied(sql)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="ai-assist-panel">
      <div className="ai-assist-header">
        <span className="ai-assist-title">
          {ACTION_ICON[action]} {t(ACTION_TEXT[action])}
        </span>
        <button className="btn-icon" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="ai-assist-body">
        {loading && (
          <div className="ai-assist-loading">
            <Loader2 size={14} className="spin" /> {t('aiAssist.thinking')}
          </div>
        )}

        {error && (
          <div className="result-error">
            <strong>{t('aiAssist.callFailed')}</strong>
            <pre>{error}</pre>
          </div>
        )}

        {result && (
          <>
            <div className="ai-assist-reply">{result.reply}</div>

            {result.sql && result.sql.length > 0 && (
              <div className="ai-chat-sql-cards">
                {result.sql.map((sql, i) => (
                  <div key={i} className="sql-card">
                    <div className="sql-card-header">
                      <span className="sql-card-label">SQL {i + 1}</span>
                      <div className="sql-card-actions">
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleCopy(sql)}
                        >
                          {copied === sql ? '✓' : t('ai.copy')}
                        </button>
                        {onInsertSql && (
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => onInsertSql(sql)}
                          >
                            {t('aiAssist.insert')}
                          </button>
                        )}
                        {onExecuteSql && (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => onExecuteSql(sql)}
                          >
                            {t('ai.execute')}
                          </button>
                        )}
                      </div>
                    </div>
                    <pre className="sql-card-code">{sql}</pre>
                  </div>
                ))}
              </div>
            )}

            {result.dataFlow && (
              <div className="ai-chat-dataflow">
                <Lock size={11} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                {result.dataFlow.summary}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
