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
import type {
  IpcChannel,
  IpcReq,
  IpcRes,
  RendererApi,
  IpcEventChannel,
  IpcEvents,
} from '@shared/ipc'

/** 基于 IPC 类型契约的类型安全调用辅助 */
function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcReq<C> extends void ? [] : [IpcReq<C>]
): Promise<IpcRes<C>> {
  const req = args[0]
  return ipcRenderer.invoke(channel, req) as Promise<IpcRes<C>>
}

/**
 * 订阅主进程 → 渲染进程的单向事件。
 * 返回取消订阅函数（组件卸载时调用，避免泄漏）。
 */
function on<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEvents[C]) => void,
): () => void {
  const wrapped = (_event: unknown, payload: IpcEvents[C]): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: RendererApi = {
  // ----- 应用级 -----
  'app:ping': () => invoke('app:ping'),
  'app:getInfo': () => invoke('app:getInfo'),
  'app:openUserDataFolder': () => invoke('app:openUserDataFolder'),
  'app:openExternal': (req) => invoke('app:openExternal', req),
  'app:notify': (req) => invoke('app:notify', req),

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
  'db:listRoles': (req) => invoke('db:listRoles', req),

  // ----- SQL 执行 -----
  'db:executeQuery': (req) => invoke('db:executeQuery', req),
  'db:executeStatement': (req) => invoke('db:executeStatement', req),

  // ----- SQL 历史 -----
  'sqlHistory:list': (req) => invoke('sqlHistory:list', req),
  'sqlHistory:search': (req) => invoke('sqlHistory:search', req),
  'sqlHistory:clear': (req) => invoke('sqlHistory:clear', req),

  // ----- 保存查询 -----
  'savedQuery:list': (req) => invoke('savedQuery:list', req),
  'savedQuery:search': (req) => invoke('savedQuery:search', req),
  'savedQuery:save': (req) => invoke('savedQuery:save', req),
  'savedQuery:update': (req) => invoke('savedQuery:update', req),
  'savedQuery:delete': (req) => invoke('savedQuery:delete', req),

  // ----- AI 对话会话 -----
  'chatSession:list': (req) => invoke('chatSession:list', req),
  'chatSession:create': (req) => invoke('chatSession:create', req),
  'chatSession:rename': (req) => invoke('chatSession:rename', req),
  'chatSession:delete': (req) => invoke('chatSession:delete', req),
  'chatSession:getMessages': (req) => invoke('chatSession:getMessages', req),
  'chatSession:appendMessage': (req) => invoke('chatSession:appendMessage', req),
  // ----- 安全与权限 -----
  'db:checkSql': (req) => invoke('db:checkSql', req),
  'db:confirmExecute': (req) => invoke('db:confirmExecute', req),
  'connection:elevate': (req) => invoke('connection:elevate', req),
  'connection:revokeElevation': (req) => invoke('connection:revokeElevation', req),
  'connection:getElevation': (req) => invoke('connection:getElevation', req),

  // ----- 审计日志 -----
  'audit:list': (req) => invoke('audit:list', req),
  'audit:search': (req) => invoke('audit:search', req),
  'audit:clear': (req) => invoke('audit:clear', req),

  // ----- LLM Provider 管理 -----
  'llm:listProviders': () => invoke('llm:listProviders'),
  'llm:createProvider': (req) => invoke('llm:createProvider', req),
  'llm:updateProvider': (req) => invoke('llm:updateProvider', req),
  'llm:deleteProvider': (req) => invoke('llm:deleteProvider', req),
  'llm:testProvider': (req) => invoke('llm:testProvider', req),
  'llm:getUsage': () => invoke('llm:getUsage'),
  'llm:clearUsage': () => invoke('llm:clearUsage'),

  // ----- AI 对话与辅助 -----
  'ai:chat': (req) => invoke('ai:chat', req),
  'ai:assist': (req) => invoke('ai:assist', req),
  'ai:chatStream': (req) => invoke('ai:chatStream', req),
  'ai:stopStream': (req) => invoke('ai:stopStream', req),
  'ai:agentRun': (req) => invoke('ai:agentRun', req),

  // ----- 应用设置 -----
  'settings:getAll': () => invoke('settings:getAll'),
  'settings:update': (req) => invoke('settings:update', req),

  // ----- 窗口控制（win/linux 自绘标题栏）-----
  'window:minimize': () => invoke('window:minimize'),
  'window:maximizeToggle': () => invoke('window:maximizeToggle'),
  'window:close': () => invoke('window:close'),
  'window:isMaximized': () => invoke('window:isMaximized'),

  // ----- 应用更新（electron-updater）-----
  'update:checkForUpdates': (req) => invoke('update:checkForUpdates', req),
  'update:installUpdate': () => invoke('update:installUpdate'),
  'update:getStatus': () => invoke('update:getStatus'),

  // ----- 数据库迁移 -----
  'migration:diffStructure': (req) => invoke('migration:diffStructure', req),
  'migration:diffData': (req) => invoke('migration:diffData', req),
  'migration:generateScript': (req) => invoke('migration:generateScript', req),
  'migration:previewRows': (req) => invoke('migration:previewRows', req),
  'migration:execute': (req) => invoke('migration:execute', req),
  'migration:exportScript': (req) => invoke('migration:exportScript', req),
  'migration:savePlan': (req) => invoke('migration:savePlan', req),
  'migration:listPlans': () => invoke('migration:listPlans'),
  'migration:getPlan': (req) => invoke('migration:getPlan', req),
  'migration:deletePlan': (req) => invoke('migration:deletePlan', req),
}

contextBridge.exposeInMainWorld('api', api)
/** 事件订阅：window.api.on(channel, listener) → 返回取消订阅函数 */
contextBridge.exposeInMainWorld(
  'on',
  // contextBridge 只允许函数跨域，这里直接暴露 on（参数/返回值都是可结构化克隆的）
  on,
)
// 暴露平台标识：渲染层首屏即可同步判断 mac/win/linux，无需 IPC 异步往返
contextBridge.exposeInMainWorld('platform', process.platform)
