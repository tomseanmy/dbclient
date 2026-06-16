/**
 * 主进程 IPC 注册器
 *
 * 提供类型化的 registerHandler，确保 handler 的参数/返回类型与
 * src/shared/ipc.ts 中的契约一致。编译期保证，不靠运行时。
 *
 * 错误处理：handler 抛出的错误在此统一捕获并序列化。
 * - 普通错误：序列化为 `[channel] message`
 * - 结构化领域错误（携带可序列化 data 字段）：序列化为带元数据的形式，
 *   渲染进程可通过 parseIpcError() 还原结构化字段（见 lib/ipc-error.ts）。
 *   不解析时，err.message 仍为人类可读文本，向后兼容。
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcChannel, IpcReq, IpcRes } from '@shared/ipc'

/** 结构化错误的序列化前缀（前端据此识别并解析） */
export const IPC_ERROR_DATA_PREFIX = '__ipc_error_data__:'

/**
 * 若错误携带可序列化的结构化数据（领域错误类的 data getter），
 * 返回该数据；否则返回 null。
 */
function extractErrorData(err: unknown): Record<string, unknown> | null {
  if (err === null || typeof err !== 'object') return null
  const e = err as { data?: unknown; name?: string }
  // 领域错误类通过 data getter 暴露结构化字段
  if (e.data && typeof e.data === 'object') {
    return { name: e.name ?? 'Error', data: e.data as Record<string, unknown> }
  }
  return null
}

export function registerHandler<C extends IpcChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, req: IpcReq<C>) => Promise<IpcRes<C>> | IpcRes<C>,
): void {
  ipcMain.handle(channel, async (event, req) => {
    try {
      return await handler(event, req as IpcReq<C>)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const structured = extractErrorData(err)
      if (structured) {
        // 结构化错误：把 name + data 序列化为 JSON 附在 message 末尾，
        // 前端可通过 parseIpcError() 还原；不解析时显示 message 仍可读
        const encoded = JSON.stringify(structured)
        throw new Error(`[${channel}] ${message}\n${IPC_ERROR_DATA_PREFIX}${encoded}`)
      }
      throw new Error(`[${channel}] ${message}`)
    }
  })
}

/** 注册所有 IPC handler（应用启动时调用一次） */
export async function registerAllHandlers(): Promise<void> {
  const { registerAppHandlers } = await import('./app')
  const { registerConnectionHandlers } = await import('./connection')
  const { registerDatabaseHandlers } = await import('./database')
  const { registerSqlHistoryHandlers } = await import('./sql-history')
  const { registerSavedQueryHandlers } = await import('./saved-queries')
  const { registerChatSessionHandlers } = await import('./chat-sessions')
  const { registerSecurityHandlers } = await import('./security')
  const { registerLlmHandlers } = await import('./llm')
  const { registerAiHandlers } = await import('./ai')
  const { registerSettingsHandlers } = await import('./settings')
  const { registerWindowHandlers } = await import('./window')
  const { registerUpdateHandlers } = await import('./update')
  const { registerMigrationHandlers } = await import('./migration')
  registerAppHandlers()
  registerConnectionHandlers()
  registerDatabaseHandlers()
  registerSqlHistoryHandlers()
  registerSavedQueryHandlers()
  registerChatSessionHandlers()
  registerSecurityHandlers()
  registerLlmHandlers()
  registerAiHandlers()
  registerSettingsHandlers()
  registerWindowHandlers()
  registerUpdateHandlers()
  registerMigrationHandlers()
}
