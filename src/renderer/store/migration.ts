/**
 * 迁移功能状态管理（Zustand）—— 四步向导
 *
 * 步骤1：选源库 + 目标库（连接 + schema）
 * 步骤2：勾选源表 + 配置维度/策略/事务
 * 步骤3：生成脚本（按表分组）+ 勾选执行项
 * 步骤4：执行进度 + 结果
 */
import { create } from 'zustand'
import { api } from '../api'
import type {
  DataDiffItem,
  DataStrategy,
  GeneratedStatement,
  MigrationBatchResult,
  MigrationTablePair,
  SavedMigrationPlan,
  StructureDiffItem,
  TransactionStrategy,
  TypeMappingWarning,
} from '../api'

/** 步骤2/3 的表项（含勾选 + 目标表名） */
export interface TableSelection {
  /** 源表名 */
  sourceTable: string
  /** 目标表名（默认同名，可改） */
  targetTable: string
  /** 是否勾选迁移 */
  selected: boolean
  /** 结构 diff（步骤2生成时填充） */
  structureItems: StructureDiffItem[]
  /** 数据 diff（步骤2生成时填充） */
  dataItems: DataDiffItem[]
}

interface MigrationStore {
  // —— 步骤控制 ——
  step: 1 | 2 | 3 | 4

  // —— 步骤1：源/目标库 ——
  sourceConnId: string
  targetConnId: string
  sourceSchema: string
  targetSchema: string

  // —— 步骤2：表选择 + 选项 ——
  tables: TableSelection[]
  includeData: boolean
  strategy: DataStrategy
  transaction: TransactionStrategy

  // —— 步骤3：脚本（按表分组）——
  /** key = 目标表名 */
  scriptByTable: Record<string, GeneratedStatement[]>
  /** key = 目标表名，value = 勾选的语句下标 */
  selectedByTable: Record<string, number[]>
  warnings: TypeMappingWarning[]

  // —— 步骤4：执行结果 ——
  executing: boolean
  batchResult: MigrationBatchResult | null

  // —— 通用 ——
  loading: boolean
  error: string | null

  // —— 持久化方案 ——
  plans: SavedMigrationPlan[]

  // ===== Actions =====
  setStep: (s: 1 | 2 | 3 | 4) => void
  nextStep: () => void
  prevStep: () => void
  setSourceConn: (id: string) => void
  setTargetConn: (id: string) => void
  setSourceSchema: (s: string) => void
  setTargetSchema: (s: string) => void

  setTables: (tables: TableSelection[]) => void
  toggleTable: (sourceTable: string) => void
  setTargetTableName: (sourceTable: string, targetName: string) => void
  setIncludeData: (v: boolean) => void
  setStrategy: (s: DataStrategy) => void
  setTransaction: (t: TransactionStrategy) => void

  /** 步骤2→3：对所有勾选表跑 diff + 生成脚本 */
  generateAll: () => Promise<void>
  toggleStatement: (tableName: string, index: number) => void

  /** 步骤3→4：执行 */
  execute: () => Promise<void>

  loadPlans: () => Promise<void>
  savePlan: (name: string) => Promise<void>
  deletePlan: (id: string) => Promise<void>
  loadPlan: (plan: SavedMigrationPlan) => void

  reset: () => void
}

/** 从源/目标 schema/conn 推断目标方言（后端会校验，此处占位） */
function inferDialect(): 'mysql' | 'postgres' | 'sqlite' {
  return 'mysql'
}

export const useMigrationStore = create<MigrationStore>((set, get) => ({
  step: 1,
  sourceConnId: '',
  targetConnId: '',
  sourceSchema: '',
  targetSchema: '',
  tables: [],
  includeData: false,
  strategy: 'incremental',
  transaction: 'single',
  scriptByTable: {},
  selectedByTable: {},
  warnings: [],
  executing: false,
  batchResult: null,
  loading: false,
  error: null,
  plans: [],

  setStep: (s) => set({ step: s }),
  nextStep: () => set((st) => ({ step: Math.min(4, st.step + 1) as 1 | 2 | 3 | 4 })),
  prevStep: () => set((st) => ({ step: Math.max(1, st.step - 1) as 1 | 2 | 3 | 4 })),
  setSourceConn: (id) => set({ sourceConnId: id, sourceSchema: '', tables: [] }),
  setTargetConn: (id) => set({ targetConnId: id, targetSchema: '' }),
  setSourceSchema: (s) => set({ sourceSchema: s, tables: [] }),
  setTargetSchema: (s) => set({ targetSchema: s }),

  setTables: (tables) => set({ tables }),
  toggleTable: (sourceTable) =>
    set((st) => ({
      tables: st.tables.map((t) =>
        t.sourceTable === sourceTable ? { ...t, selected: !t.selected } : t,
      ),
    })),
  setTargetTableName: (sourceTable, targetName) =>
    set((st) => ({
      tables: st.tables.map((t) =>
        t.sourceTable === sourceTable ? { ...t, targetTable: targetName } : t,
      ),
    })),
  setIncludeData: (v) => set({ includeData: v }),
  setStrategy: (s) => set({ strategy: s }),
  setTransaction: (t) => set({ transaction: t }),

  generateAll: async () => {
    const {
      sourceConnId,
      targetConnId,
      sourceSchema,
      targetSchema,
      tables,
      includeData,
      strategy,
    } = get()
    const selectedTables = tables.filter((t) => t.selected)
    if (selectedTables.length === 0) {
      set({ error: '请至少勾选一张表' })
      return
    }
    set({ loading: true, error: null, scriptByTable: {}, selectedByTable: {}, warnings: [] })

    const scriptByTable: Record<string, GeneratedStatement[]> = {}
    const selectedByTable: Record<string, number[]> = {}
    const allWarnings: TypeMappingWarning[] = []

    const updatedTables: TableSelection[] = []
    try {
      // 逐表 diff + 生成脚本
      for (const t of selectedTables) {
        const source = {
          connectionId: sourceConnId,
          schema: sourceSchema || undefined,
          table: t.sourceTable,
        }
        const target = {
          connectionId: targetConnId,
          schema: targetSchema || undefined,
          table: t.targetTable,
        }

        // 结构 diff
        const structRes = await api['migration:diffStructure']({ source, target })
        allWarnings.push(...structRes.warnings)

        let dataItems: DataDiffItem[] = []
        if (includeData) {
          const dataRes = await api['migration:diffData']({ source, target, strategy })
          dataItems = dataRes.items
        }

        // 构造 pair 生成脚本
        const pair: MigrationTablePair = {
          source,
          target,
          structureItems: structRes.items,
          dataItems,
        }
        const plan = {
          pairs: [pair],
          dialect: inferDialect(),
          options: { useTransaction: get().transaction, strategy },
          warnings: structRes.warnings,
        }
        const scriptRes = await api['migration:generateScript']({ plan })
        scriptByTable[t.targetTable] = scriptRes.statements
        selectedByTable[t.targetTable] = scriptRes.statements.map((_, i) => i)
        // 回填 diff 结果到 tables（execute 时复用）
        updatedTables.push({ ...t, structureItems: structRes.items, dataItems: dataItems })
      }

      set({
        tables:
          updatedTables.length > 0
            ? get().tables.map(
                (t) => updatedTables.find((u) => u.sourceTable === t.sourceTable) ?? t,
              )
            : get().tables,
        scriptByTable,
        selectedByTable,
        warnings: allWarnings,
        loading: false,
        step: 3,
      })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  toggleStatement: (tableName, index) =>
    set((st) => {
      const current = st.selectedByTable[tableName] ?? []
      const next = current.includes(index)
        ? current.filter((i) => i !== index)
        : [...current, index]
      return { selectedByTable: { ...st.selectedByTable, [tableName]: next } }
    }),

  execute: async () => {
    const {
      sourceConnId,
      targetConnId,
      sourceSchema,
      targetSchema,
      tables,
      includeData,
      strategy,
      transaction,
      warnings,
    } = get()
    set({ executing: true, error: null, batchResult: null })

    try {
      // 构造完整 plan（pairs 从 tables 重建，含 diff 项）
      const pairs: MigrationTablePair[] = tables
        .filter((t) => t.selected)
        .map((t) => ({
          source: {
            connectionId: sourceConnId,
            schema: sourceSchema || undefined,
            table: t.sourceTable,
          },
          target: {
            connectionId: targetConnId,
            schema: targetSchema || undefined,
            table: t.targetTable,
          },
          structureItems: t.structureItems,
          dataItems: includeData ? t.dataItems : undefined,
        }))

      const plan = {
        pairs,
        dialect: inferDialect(),
        options: { useTransaction: transaction, strategy },
        warnings,
      }

      // selectedByTable 直接传（key = 目标表名）
      const result = await api['migration:execute']({
        plan,
        selectedByTable: get().selectedByTable,
      })
      set({ batchResult: result, executing: false, step: 4 })
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
      sourceConnId,
      targetConnId,
      sourceSchema,
      targetSchema,
      tables,
      includeData,
      strategy,
      transaction,
      warnings,
    } = get()
    if (tables.filter((t) => t.selected).length === 0) return
    try {
      const pairs: MigrationTablePair[] = tables
        .filter((t) => t.selected)
        .map((t) => ({
          source: {
            connectionId: sourceConnId,
            schema: sourceSchema || undefined,
            table: t.sourceTable,
          },
          target: {
            connectionId: targetConnId,
            schema: targetSchema || undefined,
            table: t.targetTable,
          },
          structureItems: t.structureItems,
          dataItems: includeData ? t.dataItems : undefined,
        }))
      const plan = {
        pairs,
        dialect: inferDialect(),
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

  loadPlan: (plan) => {
    const firstPair = plan.pairs[0]
    set({
      sourceConnId: firstPair?.source.connectionId ?? '',
      targetConnId: firstPair?.target.connectionId ?? '',
      sourceSchema: firstPair?.source.schema ?? '',
      targetSchema: firstPair?.target.schema ?? '',
      tables: plan.pairs.map((p) => ({
        sourceTable: p.source.table,
        targetTable: p.target.table,
        selected: true,
        structureItems: p.structureItems,
        dataItems: p.dataItems ?? [],
      })),
      includeData: plan.pairs.some((p) => (p.dataItems?.length ?? 0) > 0),
      strategy: plan.options.strategy,
      transaction: plan.options.useTransaction,
      warnings: plan.warnings ?? [],
      scriptByTable: {},
      selectedByTable: {},
      batchResult: null,
      step: 2,
    })
  },

  reset: () =>
    set({
      step: 1,
      sourceConnId: '',
      targetConnId: '',
      sourceSchema: '',
      targetSchema: '',
      tables: [],
      scriptByTable: {},
      selectedByTable: {},
      warnings: [],
      batchResult: null,
      error: null,
    }),
}))
