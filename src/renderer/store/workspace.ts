/**
 * 工作区模式管理（Zustand）
 *
 * AI 工作区支持两种模式（顶部全局切换）：
 * - editor：人主导，AI 辅助（SQL 编辑器 + 补全 + 注释生成）
 * - agent：AI 主导，人监督（Codex 风格工作台，工具调用）
 *
 * 模式切换作用于当前激活的工作区 tab，切换时保留上下文
 * （草稿 SQL / 会话 / schema 勾选），平滑切换而非开新会话。
 */
import { create } from 'zustand'

export type WorkspaceMode = 'editor' | 'agent'

interface WorkspaceStore {
  /** 当前全局模式（默认编辑器） */
  mode: WorkspaceMode
  /** 切换模式 */
  setMode: (mode: WorkspaceMode) => void
  /** 在两种模式间切换 */
  toggle: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  mode: 'editor',

  setMode: (mode) => {
    if (get().mode === mode) return
    set({ mode })
  },

  toggle: () => set((s) => ({ mode: s.mode === 'editor' ? 'agent' : 'editor' })),
}))
