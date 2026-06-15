/**
 * SQL 编辑器组件
 *
 * Monaco 编辑器 + 工具栏（执行/格式化/EXPLAIN）。
 * 快捷键：Cmd/Ctrl+Enter 执行全部，Cmd/Ctrl+Shift+Enter 执行选中。
 */
import { useRef, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { KeyMod, KeyCode } from 'monaco-editor'
import { Play, Wand2, Loader2 } from 'lucide-react'
import { format as formatSql } from 'sql-formatter'

interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  onExecute: (sql: string) => void
  executing: boolean
  /** 数据库方言，用于格式化 */
  dialect?: 'mysql' | 'postgresql' | 'sqlite'
}

export function SqlEditor({ value, onChange, onExecute, executing, dialect }: SqlEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const handleEditorMount = (ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed
    // Cmd/Ctrl+Enter 执行全部
    ed.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => {
      onExecute(value)
    })
    // Cmd/Ctrl+Shift+Enter 执行选中
    ed.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter, () => {
      const selection = ed.getSelection()
      const selected = selection ? ed.getModel()?.getValueInRange(selection) : ''
      onExecute(selected || value)
    })
  }

  const getSelectedOrAll = useCallback((): string => {
    const ed = editorRef.current
    if (!ed) return value
    const selection = ed.getSelection()
    const selected = selection ? ed.getModel()?.getValueInRange(selection) : ''
    return (selected && selected.trim()) || value
  }, [value])

  const handleExecute = () => {
    onExecute(getSelectedOrAll())
  }

  const handleFormat = () => {
    try {
      const formatted = formatSql(value, {
        language:
          dialect === 'postgresql' ? 'postgresql' : dialect === 'sqlite' ? 'sqlite' : 'mysql',
        tabWidth: 2,
      })
      onChange(formatted)
    } catch {
      // 格式化失败忽略
    }
  }

  return (
    <div className="sql-editor-container">
      <div className="sql-toolbar">
        <button
          className="btn btn-primary btn-sm"
          onClick={handleExecute}
          disabled={executing || !value.trim()}
        >
          {executing ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
          {executing ? '执行中…' : '执行'}
        </button>
        <span className="toolbar-hint">⌘+Enter 执行全部 · ⌘+⇧+Enter 执行选中</span>
        <div className="toolbar-spacer" />
        <button className="btn-icon btn-text" onClick={handleFormat} title="格式化 SQL">
          <Wand2 size={12} /> 格式化
        </button>
      </div>
      <div className="monaco-wrapper">
        <Editor
          height="240px"
          language="sql"
          theme="vs-dark"
          value={value}
          onChange={(v) => onChange(v ?? '')}
          onMount={handleEditorMount}
          options={{
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
  )
}
