/**
 * Tab 脏状态管理（Zustand）
 *
 * 按 tabId 记录每个 tab 是否有未提交的修改：
 * - tableData：有未提交的增删改（changes.size > 0）
 * - sql：编辑器内容偏离初始模板
 * - tableDetail / chat / database：恒为未编辑，不上报
 *
 * 用于「关闭未编辑 Tab」等右键菜单操作。tab 关闭时需调用
 * clearDirty(tabId) 清理，避免内存泄漏。
 */
import { create } from 'zustand'

interface TabStore {
  /** tabId → 是否有未保存修改 */
  dirtyMap: Record<string, boolean>

  /** 上报某个 tab 的脏状态 */
  setDirty: (tabId: string, dirty: boolean) => void
  /** 查询某个 tab 是否脏 */
  isDirty: (tabId: string) => boolean
  /** 清理某个 tab 的脏标记（tab 关闭时调用） */
  clearDirty: (tabId: string) => void
}

export const useTabStore = create<TabStore>((set, get) => ({
  dirtyMap: {},

  setDirty: (tabId, dirty) =>
    set((s) => {
      // 避免无变化时产生新引用，减少无谓渲染
      if (!!s.dirtyMap[tabId] === dirty) return s
      const next = { ...s.dirtyMap }
      if (dirty) {
        next[tabId] = true
      } else {
        delete next[tabId]
      }
      return { dirtyMap: next }
    }),

  isDirty: (tabId) => !!get().dirtyMap[tabId],

  clearDirty: (tabId) =>
    set((s) => {
      if (!(tabId in s.dirtyMap)) return s
      const next = { ...s.dirtyMap }
      delete next[tabId]
      return { dirtyMap: next }
    }),
}))
