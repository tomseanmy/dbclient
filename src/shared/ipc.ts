/**
 * IPC 通道类型契约（主进程与渲染进程共享）
 *
 * 设计原则：
 * - 所有 IPC channel 的请求/响应类型在此集中声明，两端共享
 * - 渲染进程通过 preload 暴露的 window.api 调用，全程类型安全
 * - 后续 ai:* / mcp:* 在此扩展
 *
 * 新增 channel 时：
 * 1. 在 IpcContracts 中添加条目
 * 2. preload 白名单手动同步（见 src/preload/index.ts）
 * 3. 主进程 ipc/ 注册 handler
 */
import type {
  ConnectionConfig,
  ConnectionInput,
  ConnectionListItem,
  ConnectionTestInput,
  ConnectionTestResult,
} from './types/connection'
import type { RedisKeyOverview, Schema, Table, TableMeta } from './types/database'
import type { AiStreamDeltaPayload, AiStreamDonePayload, AiStreamErrorPayload } from './types/llm'
import type { ToolCallEvent, ToolResultEvent, AgentTextEvent } from './types/agent'
import type { AppSettings } from './types/settings'

// ===== 通道元数据：每个 channel 的请求/响应类型 =====
export interface IpcContracts {
  // ----- 应用级 -----
  'app:ping': {
    req: void
    res: { pong: 'pong'; ts: number; version: string }
  }
  'app:getInfo': {
    req: void
    res: {
      appVersion: string
      electronVersion: string
      nodeVersion: string
      platform: string
      userDataPath: string
    }
  }
  // 打开 userData 目录（Finder/资源管理器），用于设置页「存储路径」
  'app:openUserDataFolder': {
    req: void
    res: { ok: true }
  }
  // 用系统默认浏览器打开外链（开源地址等）
  'app:openExternal': {
    req: { url: string }
    res: { ok: true }
  }
  // 显示原生桌面通知（渲染进程无 Notification 权限，委托主进程）
  'app:notify': {
    req: { title: string; body?: string }
    res: { ok: true }
  }
  // ----- 连接管理 -----
  'connection:list': {
    req: void
    res: ConnectionListItem[]
  }
  'connection:get': {
    req: { id: string }
    res: ConnectionConfig | null
  }
  'connection:create': {
    req: ConnectionInput
    res: ConnectionConfig
  }
  'connection:update': {
    req: { id: string; input: ConnectionInput }
    res: ConnectionConfig
  }
  'connection:delete': {
    req: { id: string }
    res: { success: boolean }
  }
  'connection:test': {
    req: ConnectionTestInput
    res: ConnectionTestResult
  }

  // ----- 数据库浏览 -----
  'db:connect': {
    req: { connectionId: string }
    res: { success: boolean; message: string; serverInfo?: string }
  }
  'db:disconnect': {
    req: { connectionId: string }
    res: { success: boolean }
  }
  'db:listSchemas': {
    req: { connectionId: string }
    res: Schema[]
  }
  'db:listTables': {
    req: { connectionId: string; schema?: string }
    res: Table[]
  }
  'db:describeTable': {
    req: { connectionId: string; schema?: string; table: string }
    res: TableMeta
  }
  'db:getRedisOverview': {
    req: { connectionId: string }
    res: RedisKeyOverview
  }
  'db:executeQuery': {
    req: { connectionId: string; sql: string; limit?: number }
    res: import('./types/database').QueryResult
  }
  'db:executeStatement': {
    req: { connectionId: string; sql: string }
    res: { rowsAffected: number }
  }

  // ----- SQL 历史 -----
  'sqlHistory:list': {
    req: { connectionId?: string; limit?: number }
    res: {
      id: number
      connectionId: string | null
      sqlText: string
      status: string
      durationMs: number | null
      rowsAffected: number | null
      errorMessage: string | null
      source: string
      executedAt: string
    }[]
  }
  'sqlHistory:search': {
    req: { keyword: string; limit?: number }
    res: {
      id: number
      connectionId: string | null
      sqlText: string
      status: string
      durationMs: number | null
      rowsAffected: number | null
      errorMessage: string | null
      source: string
      executedAt: string
    }[]
  }
  'sqlHistory:clear': {
    req: { connectionId?: string }
    res: { success: boolean }
  }

  // ----- 保存查询 -----
  'savedQuery:list': {
    req: { connectionId?: string }
    res: import('./types/saved-query').SavedQueryRecord[]
  }
  'savedQuery:search': {
    req: { keyword: string }
    res: import('./types/saved-query').SavedQueryRecord[]
  }
  'savedQuery:save': {
    req: import('./types/saved-query').SavedQueryInput
    res: import('./types/saved-query').SavedQueryRecord
  }
  'savedQuery:update': {
    req: {
      id: string
      patch: import('./types/saved-query').SavedQueryUpdatePatch
    }
    res: { success: boolean }
  }
  'savedQuery:delete': {
    req: { id: string }
    res: { success: boolean }
  }

  // ----- AI 对话会话 -----
  'chatSession:list': {
    req: { connectionId?: string }
    res: import('./types/chat-session').ChatSession[]
  }
  'chatSession:create': {
    req: import('./types/chat-session').ChatSessionInput
    res: import('./types/chat-session').ChatSession
  }
  'chatSession:rename': {
    req: { id: string; title: string }
    res: { success: boolean }
  }
  'chatSession:delete': {
    req: { id: string }
    res: { success: boolean }
  }
  'chatSession:getMessages': {
    req: { sessionId: string }
    res: import('./types/chat-session').ChatMessageRecord[]
  }
  'chatSession:appendMessage': {
    req: {
      sessionId: string
      connectionId?: string | null
      role: import('./types/chat-session').ChatMessageRecord['role']
      content: string
      sqlText?: string | null
    }
    res: { success: boolean }
  }

  // ----- 安全与权限 -----
  'db:checkSql': {
    req: { connectionId: string; sql: string }
    res: import('./types/security').SecurityCheckResult
  }
  'db:confirmExecute': {
    req: { connectionId: string; sql: string; confirmedKeyword?: string }
    res: import('./types/database').QueryResult
  }
  'connection:elevate': {
    req: { connectionId: string }
    res: import('./types/security').ElevationStatus
  }
  'connection:revokeElevation': {
    req: { connectionId: string }
    res: { success: boolean }
  }
  'connection:getElevation': {
    req: { connectionId: string }
    res: import('./types/security').ElevationStatus
  }

  // ----- 审计日志 -----
  'audit:list': {
    req: { connectionId?: string; limit?: number }
    res: import('./types/security').AuditLogItem[]
  }
  'audit:search': {
    req: { keyword: string; limit?: number }
    res: import('./types/security').AuditLogItem[]
  }
  'audit:clear': {
    req: { connectionId?: string }
    res: { success: boolean }
  }

  // ----- LLM Provider 管理 -----
  'llm:listProviders': {
    req: void
    res: import('./types/llm').LlmProvider[]
  }
  'llm:createProvider': {
    req: import('./types/llm').LlmProviderInput
    res: import('./types/llm').LlmProvider
  }
  'llm:updateProvider': {
    req: { id: string; input: import('./types/llm').LlmProviderInput }
    res: import('./types/llm').LlmProvider
  }
  'llm:deleteProvider': {
    req: { id: string }
    res: { success: boolean }
  }
  'llm:testProvider': {
    req: import('./types/llm').LlmProviderInput
    res: import('./types/llm').ProviderTestResult
  }
  'llm:getUsage': {
    req: void
    res: import('./types/llm').UsageSummary
  }
  'llm:clearUsage': {
    req: void
    res: { success: boolean }
  }

  // ----- AI 对话与辅助 -----
  'ai:chat': {
    req: import('./types/llm').AiChatRequest
    res: import('./types/llm').AiChatResponse
  }
  'ai:assist': {
    req: import('./types/llm').AiAssistRequest
    res: import('./types/llm').AiChatResponse
  }
  /**
   * 流式对话：invoke 只确认「流已发起」，返回 streamId；
   * 增量文本/结束/错误通过下面三个事件通道推送（见 AiStreamEvents）。
   */
  'ai:chatStream': {
    req: import('./types/llm').AiChatStreamRequest
    res: { streamId: string; ok: true }
  }
  /**
   * 停止流式对话：中止指定 streamId 对应的底层 SSE fetch。
   * 已结束/不存在的 streamId 视为 no-op。
   */
  'ai:stopStream': {
    req: { streamId: string }
    res: { ok: true }
  }
  /**
   * AGENT 流式（带工具调用）：invoke 发起，返回 streamId；
   * 通过 agent:* 事件推送工具调用/结果/文本增量，agent:done 结束。
   */
  'ai:agentRun': {
    req: import('./types/agent-run').AgentRunRequest
    res: { streamId: string; ok: true }
  }

  // ----- 应用设置 -----
  'settings:getAll': {
    req: void
    res: AppSettings
  }
  'settings:update': {
    req: Partial<AppSettings>
    res: AppSettings
  }

  // ----- 窗口控制（win/linux 自绘标题栏按钮使用）-----
  'window:minimize': {
    req: void
    res: void
  }
  'window:maximizeToggle': {
    req: void
    res: void
  }
  'window:close': {
    req: void
    res: void
  }
  'window:isMaximized': {
    req: void
    res: boolean
  }
}

// ===== 派生类型 =====
export type IpcChannel = keyof IpcContracts

/** 通道 C 的请求参数类型 */
export type IpcReq<C extends IpcChannel> = IpcContracts[C]['req']

/** 通道 C 的响应数据类型 */
export type IpcRes<C extends IpcChannel> = IpcContracts[C]['res']

/**
 * 辅助：判断请求类型是否为 void，用于决定 invoke 的参数数量。
 * void / undefined 视为无参。
 */
type IsVoid<T> = [T] extends [void] ? true : [T] extends [undefined] ? true : false

/**
 * 渲染进程可见的 API 形状（由 preload 通过 contextBridge 暴露）。
 * 每个 channel 变成一个方法：有参则接收参数，无参则零参数。
 */
export type RendererApi = {
  [C in IpcChannel]: IsVoid<IpcReq<C>> extends true
    ? () => Promise<IpcRes<C>>
    : (req: IpcReq<C>) => Promise<IpcRes<C>>
}

// ===== 主进程 → 渲染进程的单向事件通道（webContents.send）=====
// 这类通道不走 invoke（无返回值），仅供主进程主动推送。
// 渲染进程通过 window.api.on(channel, cb) 订阅（见 preload 的 on 封装）。

/** 主进程推送给渲染进程的事件通道名 → 载荷类型 */
export interface IpcEvents {
  /** 流式对话增量文本 */
  'ai:streamDelta': AiStreamDeltaPayload
  /** 流式对话完成（最终回复 + SQL + 数据流向） */
  'ai:streamDone': AiStreamDonePayload
  /** 流式对话出错 */
  'ai:streamError': AiStreamErrorPayload
  // —— AGENT 工具调用流 ——
  /** LLM 请求调用某工具 */
  'agent:toolCall': ToolCallEvent
  /** 工具执行结果 */
  'agent:toolResult': ToolResultEvent
  /** AGENT 文本增量（思考过程 / 最终回复） */
  'agent:text': AgentTextEvent
  /** AGENT 流完成（携带最终回复 + SQL） */
  'agent:done': { streamId: string; reply: string; sql?: string[] }
  /** AGENT 流出错 */
  'agent:error': { streamId: string; message: string }
}

/** 所有事件通道名 */
export type IpcEventChannel = keyof IpcEvents
