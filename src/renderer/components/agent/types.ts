/**
 * AGENT 工作台共享类型（components/agent/ 子组件间共用）
 */
import type { ToolResultEvent, QueryResult } from '../../api'
import { Database, Table2, Terminal, Wrench, type LucideIcon } from 'lucide-react'

/** 工具调用条目（调用 + 待配对的结果） */
export interface ToolEntry {
  type: 'tool'
  toolCallId: string
  name: string
  args: Record<string, unknown>
  result?: ToolResultEvent
}

/** 对话流条目联合 */
export type Entry =
  | { type: 'user'; content: string }
  | ToolEntry
  | { type: 'assistant'; content: string; sql?: string[]; streaming?: boolean }

/** 执行历史条目（右侧面板用） */
export interface ExecHistoryItem {
  id: string
  /** 执行时间戳 */
  time: number
  /** 执行的 SQL（截断展示用） */
  sql: string
  /** 执行状态 */
  ok: boolean
  /** 查询结果（成功且为查询语句时） */
  result: QueryResult | null
  /** 错误信息（失败时） */
  error?: string
  /** 关联连接名（多连接场景下标识来源） */
  connName: string
  /** 非查询语句（增删改）的影响行数 / 反馈信息（成功且无结果集时） */
  affected?: { rows: number; message?: string }
}

/** 工具名 → 显示信息（label 存 i18n key，渲染层 t() 翻译） */
export const TOOL_META: Record<string, { label: string; icon: LucideIcon }> = {
  listTables: { label: 'enums.tool.listTables', icon: Database },
  describeTable: { label: 'enums.tool.describeTable', icon: Table2 },
  runReadQuery: { label: 'enums.tool.runReadQuery', icon: Terminal },
  generateSql: { label: 'enums.tool.generateSql', icon: Wrench },
}
