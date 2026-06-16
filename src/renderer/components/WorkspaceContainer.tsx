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
}

export function WorkspaceContainer({ connection, tabId }: WorkspaceContainerProps) {
  return <SqlWorkspace connection={connection} tabId={tabId} />
}
