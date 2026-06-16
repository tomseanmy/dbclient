/**
 * 保存查询面板
 *
 * 可折叠，展示用户命名的 SQL，点击回填到编辑器。
 * 与 SqlHistory 区别：这里是用户主动收藏的，历史是自动记录的执行过的。
 *
 * 面板内支持：
 * - 搜索（名称/SQL 文本）
 * - 点击回填编辑器
 * - 删除单条
 * - 保存当前编辑器 SQL（名称 + 描述）
 */
import { useState, useEffect, useCallback } from 'react'
import { Bookmark, Search, ChevronDown, ChevronUp, Trash2, Save } from 'lucide-react'
import { api } from '../api'
import type { SavedQueryRecord } from '../api'

interface SavedQueriesProps {
  connectionId: string
  /** 当前编辑器 SQL（用于「保存」） */
  currentSql: string
  /** 点击查询项时回填到编辑器 */
  onPick: (sql: string) => void
}

export function SavedQueries({ connectionId, currentSql, onPick }: SavedQueriesProps) {
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState<SavedQueryRecord[]>([])
  const [keyword, setKeyword] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')

  const load = useCallback(async () => {
    try {
      const list = keyword.trim()
        ? await api['savedQuery:search']({ keyword })
        : await api['savedQuery:list']({ connectionId })
      setRecords(list)
    } catch {
      // 忽略
    }
  }, [connectionId, keyword])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 面板展开时加载数据是合法模式
    if (open) load()
  }, [open, load])

  const handleSave = useCallback(async () => {
    const sql = currentSql.trim()
    const name = saveName.trim() || sql.slice(0, 30)
    if (!sql) return
    setSaving(true)
    try {
      await api['savedQuery:save']({ name, sqlText: sql, connectionId })
      setSaveName('')
      await load()
    } catch {
      // 忽略
    } finally {
      setSaving(false)
    }
  }, [currentSql, saveName, connectionId, load])

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api['savedQuery:delete']({ id })
        await load()
      } catch {
        // 忽略
      }
    },
    [load],
  )

  return (
    <div className="sql-history-panel">
      <button className="history-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        <Bookmark size={12} /> 已保存 ({records.length})
      </button>
      {open && (
        <div className="history-content">
          {/* 保存当前 SQL */}
          <div className="saved-save-row">
            <input
              className="saved-name-input"
              placeholder="命名保存当前 SQL…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              disabled={!currentSql.trim()}
            />
            <button
              className="icon-btn"
              title="保存当前 SQL"
              onClick={handleSave}
              disabled={saving || !currentSql.trim()}
            >
              <Save size={12} />
            </button>
          </div>
          <div className="history-search">
            <Search size={12} />
            <input
              placeholder="搜索保存的查询…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="history-list">
            {records.map((r) => (
              <div
                key={r.id}
                className="history-item"
                onClick={() => onPick(r.sqlText)}
                title={r.sqlText}
              >
                <Bookmark size={11} className="history-status" />
                <span className="history-sql">{r.name}</span>
                <button
                  className="icon-btn history-del"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(r.id)
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {records.length === 0 && <div className="history-empty">暂无保存的查询</div>}
          </div>
        </div>
      )}
    </div>
  )
}
