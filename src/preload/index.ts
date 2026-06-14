/**
 * Preload 脚本 —— 渲染进程与主进程之间的安全桥
 *
 * 安全要点：
 * - contextIsolation: true（渲染进程无法直接访问 require/process）
 * - nodeIntegration: false
 * - 只通过 contextBridge 暴露白名单 API，不暴露 ipcRenderer 原始对象
 *
 * window.api 的形状由 RendererApi 类型严格约束，
 * 渲染进程调用时享受完整类型提示与编译期检查。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannel, IpcReq, IpcRes, RendererApi } from '@shared/ipc'

// 手工维护与 IpcChannel 同步的 api 对象。
// 这里显式列出每个 channel，避免动态构造丢失类型信息。
// 新增 channel 时需同步：1) ipc.ts 2) 此处 3) 主进程 handler
const api: RendererApi = {
  'app:ping': () => ipcRenderer.invoke('app:ping') as Promise<IpcRes<'app:ping'>>,
  'app:getInfo': () => ipcRenderer.invoke('app:getInfo') as Promise<IpcRes<'app:getInfo'>>,
}

contextBridge.exposeInMainWorld('api', api)

// 类型导出（供 preload 自身类型检查）
export type { IpcChannel, IpcReq, IpcRes, RendererApi }
