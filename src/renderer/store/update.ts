/**
 * 应用更新 store（Zustand）
 *
 * 订阅主进程推送的更新事件（update:stateChanged / update:downloadProgress），
 * 维护更新状态机与下载进度，供 UI 响应式展示。
 *
 * 挂载时（App 启动）调用 init()：先同步拉取一次当前状态（避免错过启动期
 * 主动推送），再绑定事件订阅。
 */
import { create } from 'zustand'
import { api } from '../api'
import type { UpdateStatus, UpdateInfo } from '@shared/types/update'

interface UpdateStore {
  /** 当前更新状态机 */
  status: UpdateStatus
  /** 新版本信息（available / downloaded 时有值） */
  info: UpdateInfo | undefined
  /** 下载进度百分比 0-100 */
  progress: number
  /** 最近一次错误信息 */
  errorMessage: string | undefined
  /** 是否正在执行检查/下载（checking / downloading 状态） */
  busy: boolean
  /** 初始化：同步当前状态 + 绑定事件订阅（返回取消订阅函数） */
  init: () => Promise<() => void>
  /** 手动触发检查更新 */
  checkForUpdates: () => Promise<void>
  /** 触发重启并安装（仅 downloaded 状态可用） */
  installUpdate: () => Promise<void>
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  status: 'idle',
  info: undefined,
  progress: 0,
  errorMessage: undefined,
  busy: false,

  init: async () => {
    // 先同步一次当前状态（窗口晚于主进程启动时可能错过启动期推送）
    try {
      const s = await api['update:getStatus']()
      set({
        status: s.status,
        info: s.info,
        progress: s.progress,
        errorMessage: s.errorMessage,
        busy: s.status === 'checking' || s.status === 'downloading',
      })
    } catch {
      // 同步失败不阻塞，事件订阅仍可补全
    }

    // 绑定状态变化事件
    const offState = window.on('update:stateChanged', (payload) => {
      set({
        status: payload.status,
        info: payload.info,
        errorMessage: payload.errorMessage,
        busy: payload.status === 'checking' || payload.status === 'downloading',
      })
    })

    // 绑定下载进度事件
    const offProgress = window.on('update:downloadProgress', (payload) => {
      set({ status: 'downloading', progress: payload.percent })
    })

    return () => {
      offState()
      offProgress()
    }
  },

  checkForUpdates: async () => {
    set({ busy: true, errorMessage: undefined })
    try {
      const result = await api['update:checkForUpdates']({ silent: false })
      set({ status: result.status, info: result.info, busy: false })
    } catch (err) {
      set({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        busy: false,
      })
    }
  },

  installUpdate: async () => {
    try {
      await api['update:installUpdate']()
    } catch (err) {
      set({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  },
}))

/** 便捷选择器：是否已下载完成、可触发重启 */
export const selectUpdateDownloaded = (s: UpdateStore): boolean => s.status === 'downloaded'
