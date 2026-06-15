/**
 * 主进程 IPC 注册器
 *
 * 提供类型化的 registerHandler，确保 handler 的参数/返回类型与
 * src/shared/ipc.ts 中的契约一致。编译期保证，不靠运行时。
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcChannel, IpcReq, IpcRes } from '@shared/ipc'

export function registerHandler<C extends IpcChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, req: IpcReq<C>) => Promise<IpcRes<C>> | IpcRes<C>,
): void {
  ipcMain.handle(channel, async (event, req) => {
    try {
      return await handler(event, req as IpcReq<C>)
    } catch (err) {
      // 统一错误处理：把 Error 序列化后抛出，渲染进程能拿到 message
      const message = err instanceof Error ? err.message : String(err)
      // 重新抛出非 Error 对象，ipcMain 会序列化 Error.message
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
  const { registerSecurityHandlers } = await import('./security')
  const { registerLlmHandlers } = await import('./llm')
  registerAppHandlers()
  registerConnectionHandlers()
  registerDatabaseHandlers()
  registerSqlHistoryHandlers()
  registerSecurityHandlers()
  registerLlmHandlers()
}
