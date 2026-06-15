/**
 * 连接状态管理（Zustand）
 *
 * 管理：连接列表、对象浏览状态。
 * 支持手动刷新与 DDL 执行后自动刷新。
 */
import { create } from 'zustand'
import { api, type ConnectionListItem, type DbType, type Environment } from '../api'

/** 对象树中单个连接的浏览状态 */
interface ConnectionState {
  connected?: boolean
  connecting?: boolean
  error?: string
  schemas?: Awaited<ReturnType<(typeof api)['db:listSchemas']>>
  tables?: Record<string, Awaited<ReturnType<(typeof api)['db:listTables']>>>
}

interface ConnectionStore {
  connections: ConnectionListItem[]
  loading: boolean
  states: Record<string, ConnectionState>
  /** 全局刷新计数器，DDL 执行后递增，ObjectTree 监听它自动刷新 */
  refreshTick: number

  loadConnections: () => Promise<void>

  connectDb: (connectionId: string) => Promise<boolean>
  disconnectDb: (connectionId: string) => Promise<void>

  loadSchemas: (connectionId: string) => Promise<void>
  loadTables: (connectionId: string, schema: string) => Promise<void>

  /** 刷新指定连接的所有已展开数据（schemas + 已加载的 tables） */
  refreshConnection: (connectionId: string) => Promise<void>
  /** 触发全局刷新信号（DDL 执行后调用） */
  triggerRefresh: () => void
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connections: [],
  loading: false,
  states: {},
  refreshTick: 0,

  loadConnections: async () => {
    set({ loading: true })
    try {
      const connections = await api['connection:list']()
      set({ connections, loading: false })
    } catch (err) {
      set({ loading: false })
      console.error('加载连接列表失败', err)
    }
  },

  connectDb: async (connectionId) => {
    set((s) => ({
      states: {
        ...s.states,
        [connectionId]: { ...s.states[connectionId], connecting: true, error: undefined },
      },
    }))
    try {
      const result = await api['db:connect']({ connectionId })
      set((s) => ({
        states: {
          ...s.states,
          [connectionId]: {
            ...s.states[connectionId],
            connecting: false,
            connected: result.success,
            error: result.success ? undefined : result.message,
          },
        },
      }))
      return result.success
    } catch (err) {
      set((s) => ({
        states: {
          ...s.states,
          [connectionId]: {
            ...s.states[connectionId],
            connecting: false,
            connected: false,
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }))
      return false
    }
  },

  disconnectDb: async (connectionId) => {
    await api['db:disconnect']({ connectionId })
    // 断开时清空缓存，避免重连后看到旧数据
    set((s) => ({
      states: {
        ...s.states,
        [connectionId]: { connected: false, schemas: undefined, tables: undefined },
      },
    }))
  },

  loadSchemas: async (connectionId) => {
    const schemas = await api['db:listSchemas']({ connectionId })
    set((s) => ({
      states: {
        ...s.states,
        [connectionId]: { ...s.states[connectionId], schemas },
      },
    }))
  },

  loadTables: async (connectionId, schema) => {
    const tables = await api['db:listTables']({ connectionId, schema })
    set((s) => {
      const prev = s.states[connectionId] ?? {
        connected: false,
        connecting: false,
        tables: {},
      }
      return {
        states: {
          ...s.states,
          [connectionId]: {
            connected: prev.connected,
            connecting: prev.connecting,
            error: prev.error,
            schemas: prev.schemas,
            tables: { ...prev.tables, [schema]: tables },
          },
        },
      }
    })
  },

  refreshConnection: async (connectionId) => {
    const state = get().states[connectionId]
    if (!state?.connected) return
    // 刷新 schemas
    await get().loadSchemas(connectionId)
    // 刷新已加载的 tables
    if (state.tables) {
      const schemas = Object.keys(state.tables)
      await Promise.all(schemas.map((sc) => get().loadTables(connectionId, sc)))
    }
  },

  triggerRefresh: () => {
    set((s) => ({ refreshTick: s.refreshTick + 1 }))
  },
}))

// 辅助常量
export const DB_LABELS: Record<DbType, string> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  redis: 'Redis',
}

export const DEFAULT_PORTS: Record<DbType, number> = {
  mysql: 3306,
  postgres: 5432,
  sqlite: 0,
  redis: 6379,
}

export const ENV_LABELS: Record<Environment, string> = {
  dev: 'Dev',
  staging: 'Staging',
  prod: 'Prod',
}

export const ENV_COLORS: Record<Environment, string> = {
  dev: '#16a34a',
  staging: '#d97706',
  prod: '#dc2626',
}
