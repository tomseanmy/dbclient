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
 *
 * 维护说明：新增 channel 时需手动在此处添加对应条目。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannel, IpcReq, IpcRes, RendererApi } from '@shared/ipc'

/** 基于 IPC 类型契约的类型安全调用辅助 */
function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcReq<C> extends void ? [] : [IpcReq<C>]
): Promise<IpcRes<C>> {
  const req = args[0]
  return ipcRenderer.invoke(channel, req) as Promise<IpcRes<C>>
}

const api: RendererApi = {
  // ----- 应用级 -----
  'app:ping': () => invoke('app:ping'),
  'app:getInfo': () => invoke('app:getInfo'),

  // ----- 连接管理 -----
  'connection:list': () => invoke('connection:list'),
  'connection:get': (req) => invoke('connection:get', req),
  'connection:create': (req) => invoke('connection:create', req),
  'connection:update': (req) => invoke('connection:update', req),
  'connection:delete': (req) => invoke('connection:delete', req),
  'connection:test': (req) => invoke('connection:test', req),

  // ----- 数据库浏览 -----
  'db:connect': (req) => invoke('db:connect', req),
  'db:disconnect': (req) => invoke('db:disconnect', req),
  'db:listSchemas': (req) => invoke('db:listSchemas', req),
  'db:listTables': (req) => invoke('db:listTables', req),
  'db:describeTable': (req) => invoke('db:describeTable', req),
  'db:getRedisOverview': (req) => invoke('db:getRedisOverview', req),
}

contextBridge.exposeInMainWorld('api', api)
