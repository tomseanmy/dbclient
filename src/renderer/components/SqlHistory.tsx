/**
 * SQL 历史面板
 *
 * 可折叠，展示执行过的 SQL，点击回填到编辑器。
 */
import { useState, useEffect, useCallback } from 'react'
import { History, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../api'

interface HistoryRecord {
  id: number
  connectionId: string | null
  sqlText: string
  status: string
  durationMs: number | null
  rowsAffected: number | null
  errorMessage: string | null
  source: string
  executedAt: string
}

interface SqlHistoryProps {
  connectionId: string
  onPick: (sql: string) => void
}

export function SqlHistory({ connectionId, onPick }: SqlHistoryProps) {
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    try {
      const list = keyword.trim()
        ? await api['sqlHistory:search']({ keyword })
        : await api['sqlHistory:list']({ connectionId })
      setRecords(list as HistoryRecord[])
    } catch {
      // 忽略
    }
  }, [connectionId, keyword])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 面板展开时加载数据是合法模式
    if (open) load()
  }, [open, load])

  return (
    <div className="sql-history-panel">
      <button className="history-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        <History size={12} /> 历史 ({records.length})
      </button>
      {open && (
        <div className="history-content">
          <div className="history-search">
            <Search size={12} />
            <input
              placeholder="搜索历史 SQL…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="history-list">
            {records.map((r) => (
              <div
                key={r.id}
                className={`history-item ${r.status === 'error' ? 'error' : ''}`}
                onClick={() => onPick(r.sqlText)}
                title={r.sqlText}
              >
                <span className={`history-status ${r.status}`}>
                  {r.status === 'success' ? '✓' : '✗'}
                </span>
                <span className="history-sql">{r.sqlText.slice(0, 60)}</span>
                <span className="history-meta">
                  {r.durationMs != null ? `${r.durationMs}ms` : ''}
                </span>
              </div>
            ))}
            {records.length === 0 && <div className="history-empty">暂无历史</div>}
          </div>
        </div>
      )}
    </div>
  )
}
