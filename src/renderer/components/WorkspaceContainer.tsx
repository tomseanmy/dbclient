/**
 * 编辑器模式工作区容器
 *
 * AGENT 模式已提升为应用级全局覆盖层（见 App.tsx），不再在此挂载。
 * 本容器只承载 editor 模式（SqlWorkspace + AiAssistPanel）。
 */
import { SqlWorkspace } from './SqlWorkspace'
import type { ConnectionListItem } from '../api'

interface WorkspaceContainerProps {
  connection: ConnectionListItem
  tabId: string
  /** 预填的初始 SQL（从保存的查询打开时） */
  initialSql?: string
  /** 关联的保存查询 id（从保存的查询打开时；之后保存直接更新该记录） */
  savedQueryId?: string
  /** 首次保存后回调（把当前 tab 关联到新创建的保存查询） */
  onQueryBound?: (savedQuery: { id: string; name: string }) => void
}

export function WorkspaceContainer({
  connection,
  tabId,
  initialSql,
  savedQueryId,
  onQueryBound,
}: WorkspaceContainerProps) {
  return (
    <SqlWorkspace
      connection={connection}
      tabId={tabId}
      initialSql={initialSql}
      savedQueryId={savedQueryId}
      onQueryBound={onQueryBound ? (sq) => onQueryBound(sq) : undefined}
    />
  )
}
