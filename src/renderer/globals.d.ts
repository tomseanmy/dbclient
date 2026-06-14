/**
 * 渲染进程全局类型声明
 *
 * 声明 window.api 的类型，让组件中直接使用 window.api 时有类型提示。
 */
import type { RendererApi } from '@shared/ipc'

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}
