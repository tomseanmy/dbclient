/**
 * AGENT 工具调用相关类型（主进程与渲染进程共享）
 *
 * AGENT 模式下，LLM 可调用工具（function calling）：
 * - 主进程把每次「工具调用」「工具结果」「思考文本」「最终回复」
 *   通过事件流推送给前端，前端渲染成卡片化的对话流。
 */

/** 工具调用事件：LLM 请求调用某工具 */
export interface ToolCallEvent {
  /** 本次 agent 流的 id（与 streamId 一致，用于事件过滤） */
  streamId: string
  /** 工具调用 id（LLM 返回，用于关联结果） */
  toolCallId: string
  /** 工具名 */
  name: string
  /** 工具参数（已解析的对象） */
  args: Record<string, unknown>
}

/** 工具结果事件：主进程执行工具后的结果 */
export interface ToolResultEvent {
  streamId: string
  toolCallId: string
  /** 是否执行成功 */
  ok: boolean
  /** 结果文本（序列化后，展示用）。查询结果会带行列摘要。 */
  result: string
  /** 结构化结果（供卡片渲染，如查询结果的行/列） */
  structured?: ToolResultStructured
}

/** 工具结果的结构化形态（卡片渲染用） */
export type ToolResultStructured =
  | { kind: 'query'; columns: string[]; rows: unknown[][]; rowCount: number; truncated: boolean }
  | { kind: 'tables'; tables: { name: string; type: string }[] }
  | {
      kind: 'schema'
      tableName: string
      columns: { name: string; dataType: string; isPrimaryKey: boolean }[]
    }
  | { kind: 'sql'; sql: string }
  | { kind: 'error'; message: string }

/** AGENT 思考/文本增量事件（区别于 ai:streamDelta，专用于 agent 的中间思考） */
export interface AgentTextEvent {
  streamId: string
  /** 本片段文本（可能是思考过程或最终回复的增量） */
  delta: string
}

/** AGENT 流的事件通道（复用 IpcEvents 机制） */
// 注：这些事件载荷类型在 ipc.ts 的 IpcEvents 中注册
