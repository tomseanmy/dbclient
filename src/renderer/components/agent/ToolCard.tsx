import { useTranslation } from 'react-i18next'
/**
 * AGENT 工具调用卡片（从 AgentWorkspace 拆分）
 *
 * 展示工具名/参数 + 结果（查询结果用表格，结构/表列表/SQL/错误各自渲染）。
 */
import { Wrench } from 'lucide-react'
import { formatCell } from '../../lib/format'
import { TOOL_META, type ToolEntry } from './types'
import type { ToolResultEvent } from '../../api'

/** 工具调用卡片：展示工具名/参数 + 结果（查询结果用表格） */
export function ToolCard({
  entry,
  connectionId: _connectionId,
}: {
  entry: ToolEntry
  connectionId: string
}) {
  const { t } = useTranslation()
  const meta = TOOL_META[entry.name]
  const Icon = meta?.icon ?? Wrench
  const result = entry.result

  return (
    <div className="agent-tool-card">
      <div className="agent-tool-head">
        <Icon size={13} />
        <span className="agent-tool-name">{meta ? t(meta.label) : entry.name}</span>
        {entry.name === 'runReadQuery' && (
          <code className="agent-tool-sql">{String(entry.args.sql ?? '').slice(0, 60)}</code>
        )}
        {entry.name === 'describeTable' && (
          <code className="agent-tool-sql">{String(entry.args.table ?? '')}</code>
        )}
        {result ? (
          result.ok ? (
            <span className="agent-tool-status ok">✓</span>
          ) : (
            <span className="agent-tool-status err">✗</span>
          )
        ) : (
          <span className="agent-tool-status pending">…</span>
        )}
      </div>
      {/* 结果内容 */}
      {result && result.structured?.kind === 'query' && (
        <ResultTable structured={result.structured} />
      )}
      {result && result.structured?.kind === 'tables' && (
        <div className="agent-tool-result">
          {result.structured.tables.map((t) => (
            <span key={t.name} className="agent-table-chip">
              {t.name}
            </span>
          ))}
        </div>
      )}
      {result && result.structured?.kind === 'schema' && (
        <div className="agent-tool-result">
          {result.structured.columns.map((c) => (
            <div key={c.name} className="agent-col-row">
              <code>{c.name}</code>
              <span className="muted">{c.dataType}</span>
              {c.isPrimaryKey && <span className="pk-tag">PK</span>}
            </div>
          ))}
        </div>
      )}
      {result && result.structured?.kind === 'sql' && (
        <pre className="sql-card-code">{result.structured.sql}</pre>
      )}
      {result && result.structured?.kind === 'error' && (
        <div className="agent-tool-error">{result.structured.message}</div>
      )}
      {result && !result.ok && !result.structured && (
        <div className="agent-tool-error">{result.result}</div>
      )}
    </div>
  )
}

/** 查询结果表格（前若干行） */
function ResultTable({
  structured,
}: {
  structured: Extract<ToolResultEvent['structured'], { kind: 'query' }>
}) {
  const { t } = useTranslation()
  const previewRows = structured.rows.slice(0, 8)
  return (
    <div className="agent-result-table">
      <div className="agent-result-meta">
        {t('agentCards.rowsTruncated', { count: structured.rowCount })}
      </div>
      <table>
        <thead>
          <tr>
            {structured.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{formatCell(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
