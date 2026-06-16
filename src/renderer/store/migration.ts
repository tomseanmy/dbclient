/**
 * 迁移功能状态管理（Zustand）
 *
 * 管理迁移向导的交互状态：源/目标选择、diff 结果、生成脚本、执行结果。
 * 以及持久化方案的列表加载。
 *
 * 复用 useConnectionStore 的连接/schemas/tables 数据，不重复拉取。
 */
import { create } from 'zustand'
import { api } from '../api'
import type {
  StructureDiffItem,
  DataDiffItem,
  DataStrategy,
  GeneratedStatement,
  TypeMappingWarning,
  MigrationResult,
  MigrationTarget,
  SavedMigrationPlan,
  TransactionStrategy,
} from '../api'

/** 迁移向导状态 */
interface MigrationStore {
  // —— 源/目标选择 ——
  source: MigrationTarget | null
  target: MigrationTarget | null
  /** 数据迁移策略 */
  strategy: DataStrategy
  /** 事务策略 */
  transaction: TransactionStrategy
  /** 是否启用数据迁移（false=仅结构） */
  includeData: boolean

  // —— diff 结果 ——
  structureItems: StructureDiffItem[]
  dataItems: DataDiffItem[]
  warnings: TypeMappingWarning[]
  /** 勾选执行的语句下标 */
  selectedIndexes: number[]
  /** 生成的脚本 */
  statements: GeneratedStatement[]

  // —— 执行 ——
  executing: boolean
  result: MigrationResult | null

  // —— 通用 ——
  loading: boolean
  error: string | null

  // —— 持久化方案 ——
  plans: SavedMigrationPlan[]

  // ===== Actions =====
  setSource: (t: MigrationTarget | null) => void
  setTarget: (t: MigrationTarget | null) => void
  setStrategy: (s: DataStrategy) => void
  setTransaction: (t: TransactionStrategy) => void
  setIncludeData: (v: boolean) => void

  runStructureDiff: () => Promise<void>
  runDataDiff: () => Promise<void>
  generateScript: () => Promise<void>
  toggleSelect: (index: number) => void
  selectAll: () => void
  selectNone: () => void
  execute: () => Promise<void>

  loadPlans: () => Promise<void>
  savePlan: (name: string) => Promise<void>
  deletePlan: (id: string) => Promise<void>
  loadPlan: (plan: SavedMigrationPlan) => void

  reset: () => void
}

export const useMigrationStore = create<MigrationStore>((set, get) => ({
  source: null,
  target: null,
  strategy: 'incremental',
  transaction: 'single',
  includeData: false,
  structureItems: [],
  dataItems: [],
  warnings: [],
  selectedIndexes: [],
  statements: [],
  executing: false,
  result: null,
  loading: false,
  error: null,
  plans: [],

  setSource: (t) =>
    set({ source: t, structureItems: [], dataItems: [], statements: [], result: null }),
  setTarget: (t) =>
    set({ target: t, structureItems: [], dataItems: [], statements: [], result: null }),
  setStrategy: (s) => set({ strategy: s }),
  setTransaction: (t) => set({ transaction: t }),
  setIncludeData: (v) => set({ includeData: v, dataItems: [], statements: [] }),

  runStructureDiff: async () => {
    const { source, target } = get()
    if (!source || !target) {
      set({ error: '请先选择源和目标表' })
      return
    }
    set({ loading: true, error: null })
    try {
      const res = await api['migration:diffStructure']({ source, target })
      set({ structureItems: res.items, warnings: res.warnings, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  runDataDiff: async () => {
    const { source, target, strategy } = get()
    if (!source || !target) {
      set({ error: '请先选择源和目标表' })
      return
    }
    set({ loading: true, error: null })
    try {
      const res = await api['migration:diffData']({ source, target, strategy })
      set({ dataItems: res.items, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  generateScript: async () => {
    const {
      source,
      target,
      structureItems,
      dataItems,
      strategy,
      transaction,
      includeData,
      warnings,
    } = get()
    if (!source || !target) {
      set({ error: '请先选择源和目标表' })
      return
    }
    set({ loading: true, error: null })
    try {
      // 推断目标方言由后端 assertMigratable 处理；这里传 'mysql' 占位，后端会覆盖
      const plan = {
        source,
        target,
        dialect: 'mysql' as const,
        structureItems,
        dataItems: includeData ? dataItems : [],
        options: { useTransaction: transaction, strategy },
        warnings,
      }
      const res = await api['migration:generateScript']({ plan })
      set({
        statements: res.statements,
        selectedIndexes: res.statements.map((_, i) => i), // 默认全选
        loading: false,
      })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  toggleSelect: (index) =>
    set((s) => ({
      selectedIndexes: s.selectedIndexes.includes(index)
        ? s.selectedIndexes.filter((i) => i !== index)
        : [...s.selectedIndexes, index],
    })),

  selectAll: () => set((s) => ({ selectedIndexes: s.statements.map((_, i) => i) })),
  selectNone: () => set({ selectedIndexes: [] }),

  execute: async () => {
    const {
      source,
      target,
      structureItems,
      dataItems,
      strategy,
      transaction,
      includeData,
      warnings,
      selectedIndexes,
    } = get()
    if (!source || !target) return
    set({ executing: true, error: null, result: null })
    try {
      const plan = {
        source,
        target,
        dialect: 'mysql' as const,
        structureItems,
        dataItems: includeData ? dataItems : [],
        options: { useTransaction: transaction, strategy },
        warnings,
      }
      const result = await api['migration:execute']({ plan, selectedIndexes })
      set({ result, executing: false })
    } catch (err) {
      set({ executing: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  loadPlans: async () => {
    try {
      const plans = await api['migration:listPlans']()
      set({ plans })
    } catch (err) {
      console.error('加载迁移方案失败', err)
    }
  },

  savePlan: async (name) => {
    const {
      source,
      target,
      structureItems,
      dataItems,
      strategy,
      transaction,
      includeData,
      warnings,
    } = get()
    if (!source || !target) return
    try {
      const plan = {
        source,
        target,
        dialect: 'mysql' as const,
        structureItems,
        dataItems: includeData ? dataItems : [],
        options: { useTransaction: transaction, strategy },
        warnings,
        name,
      }
      await api['migration:savePlan']({ plan })
      await get().loadPlans()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  deletePlan: async (id) => {
    try {
      await api['migration:deletePlan']({ id })
      await get().loadPlans()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  loadPlan: (plan) =>
    set({
      source: plan.source,
      target: plan.target,
      structureItems: plan.structureItems,
      dataItems: plan.dataItems ?? [],
      warnings: plan.warnings ?? [],
      strategy: plan.options.strategy,
      transaction: plan.options.useTransaction,
      includeData: (plan.dataItems?.length ?? 0) > 0,
      statements: [],
      selectedIndexes: [],
      result: null,
    }),

  reset: () =>
    set({
      source: null,
      target: null,
      structureItems: [],
      dataItems: [],
      warnings: [],
      selectedIndexes: [],
      statements: [],
      result: null,
      error: null,
    }),
}))
