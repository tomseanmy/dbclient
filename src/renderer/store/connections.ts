/**
 * 连接状态管理（Zustand）
 *
 * 管理：连接列表、选中连接、新建/编辑表单状态、对象浏览状态。
 */
import { create } from 'zustand'
import { api, type ConnectionListItem, type DbType, type Environment } from '../api'

/** 对象树中单个连接的浏览状态 */
interface ConnectionState {
  /** 是否已连接到数据库服务器 */
  connected?: boolean
  /** 连接中（loading） */
  connecting?: boolean
  /** 错误信息 */
  error?: string
  /** 展开的 schema 列表 */
  schemas?: Awaited<ReturnType<(typeof api)['db:listSchemas']>>
  /** 选中的 schema 下的表列表（按 schema 名索引） */
  tables?: Record<string, Awaited<ReturnType<(typeof api)['db:listTables']>>>
}

interface ConnectionStore {
  /** 所有连接列表 */
  connections: ConnectionListItem[]
  loading: boolean

  /** 各连接的浏览状态（按连接 ID 索引） */
  states: Record<string, ConnectionState>

  /** 加载连接列表 */
  loadConnections: () => Promise<void>

  /** 连接到数据库 */
  connectDb: (connectionId: string) => Promise<boolean>
  /** 断开连接 */
  disconnectDb: (connectionId: string) => Promise<void>

  /** 加载 schema 列表 */
  loadSchemas: (connectionId: string) => Promise<void>
  /** 加载某 schema 下的表 */
  loadTables: (connectionId: string, schema: string) => Promise<void>
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connections: [],
  loading: false,
  states: {},

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
    set((s) => ({
      states: {
        ...s.states,
        [connectionId]: { connected: false },
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
}))

// 辅助：数据库类型标签与默认端口
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
