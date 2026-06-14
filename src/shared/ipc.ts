/**
 * IPC 通道类型契约（主进程与渲染进程共享）
 *
 * 设计原则：
 * - 所有 IPC channel 的请求/响应类型在此集中声明，两端共享
 * - 渲染进程通过 preload 暴露的 window.api 调用，全程类型安全
 * - 后续 db:* / ai:* / mcp:* / connection:* 在此扩展
 *
 * 新增 channel 时：
 * 1. 在 IPC_CONTRACTS 中添加条目
 * 2. preload 白名单自动包含（基于此类型）
 * 3. 主进程 ipc/registry 注册 handler
 */

// ===== 通道元数据：每个 channel 的请求/响应类型 =====
export interface IpcContracts {
  // 应用级
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
