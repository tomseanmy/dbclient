/**
 * 渲染进程侧的 API 封装
 *
 * 直接复用 window.api（由 preload 通过 contextBridge 注入），
 * 这里只做一层薄封装，方便后续加日志/重试/错误转换。
 */
import type { RendererApi } from '@shared/ipc'

export const api: RendererApi = window.api

export type { IpcChannel, IpcReq, IpcRes } from '@shared/ipc'
