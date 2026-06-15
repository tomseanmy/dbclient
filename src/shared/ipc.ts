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
  'llm:setDefaultProvider': {
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
