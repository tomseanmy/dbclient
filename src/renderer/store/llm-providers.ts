/**
 * LLM Provider 共享状态（Zustand）
 *
 * 解决：AgentWorkspace 与 ModelSettings 各自独立拉取 provider 列表、互不同步，
 * 导致在设置中新增 Provider 后，Agent 模式左下角「选择模型」仍处于禁用态，
 * 必须重启应用才生效。
 *
 * 通过单一数据源（本 store）共享，任何一方改动后调用 refresh() 即可全局刷新。
 *
 * 默认模型不再绑定 Provider（旧版 isDefault 已移除）：取而代之的是「默认 Agent 模型」
 * 与「默认补全模型」两项（见 app_settings / useSettingsStore）。本 store 只负责
 * 共享 Provider 列表，selectedProviderId 缺省为空——空时由网关按场景回退到分类默认。
 *
 * 用法：
 * - App 启动时调用 load()（幂等，仅首次真正请求）。
 * - ModelSettings 保存/删除后调用 refresh()。
 * - AgentWorkspace 直接订阅 providers / selectedProviderId。
 */
import { create } from 'zustand'
import { api, type LlmProvider } from '../api'

interface LlmProviderStore {
  /** provider 列表（加载前为空数组） */
  providers: LlmProvider[]
  /** 当前选中的 providerId（空表示用分类默认，由网关解析） */
  selectedProviderId: string
  /** 是否已加载过一次（load 幂等用） */
  loaded: boolean

  /** 首次加载（App 启动调用一次；已加载则 no-op） */
  load: () => Promise<void>
  /** 强制刷新（配置变更后调用，覆盖 loaded 幂等） */
  refresh: () => Promise<void>
  /** 切换选中 provider（传空串表示清除，改用分类默认） */
  setSelected: (id: string) => void
}

export const useLlmProviderStore = create<LlmProviderStore>((set, get) => ({
  providers: [],
  selectedProviderId: '',
  loaded: false,

  load: async () => {
    if (get().loaded) return
    await get().refresh()
  },

  refresh: async () => {
    try {
      const providers = await api['llm:listProviders']()
      // 若用户已选的 provider 仍存在则保留，否则清空（空 → 网关用分类默认）
      const prev = get().selectedProviderId
      const stillExists = prev ? providers.some((p) => p.id === prev) : false
      set({
        providers,
        selectedProviderId: stillExists ? prev : '',
        loaded: true,
      })
    } catch {
      // 拉取失败不应阻塞：标记 loaded 避免反复重试
      set({ loaded: true })
    }
  },

  setSelected: (id) => set({ selectedProviderId: id }),
}))
