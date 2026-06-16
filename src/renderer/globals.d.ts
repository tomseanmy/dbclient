/**
 * 渲染进程全局类型声明
 *
 * 声明 window.api 的类型，让组件中直接使用 window.api 时有类型提示。
 */
import type { RendererApi, IpcEventChannel, IpcEvents } from '@shared/ipc'

/** 事件订阅函数类型（与 preload 的 on 一致） */
type OnFn = <C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEvents[C]) => void,
) => () => void

declare global {
  interface Window {
    api: RendererApi
    /** 事件订阅：传入通道名与监听器，返回取消订阅函数 */
    on: OnFn
    /** 当前操作系统平台（preload 同步暴露：'darwin' | 'win32' | 'linux' 等） */
    platform: string
  }
}

export {}
