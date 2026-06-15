/**
 * 渲染进程侧的 API 封装
 *
 * 直接复用 window.api（由 preload 通过 contextBridge 注入）。
 * 新增 channel 时自动可用（RendererApi 已覆盖）。
 */
export const api = window.api

// 重新导出类型，方便组件使用
export type { SecurityCheckResult, ElevationStatus, AuditLogItem } from '@shared/types/security'

export type {
  ConnectionConfig,
  ConnectionInput,
  ConnectionListItem,
  ConnectionTestInput,
  ConnectionTestResult,
  Environment,
  DbType,
} from '@shared/types/connection'
export type {
  Schema,
  Table,
  TableMeta,
  Column,
  Index,
  ForeignKey,
  QueryResult,
  CellValue,
  RedisKeyOverview,
  ConnectionStatus,
  UnifiedType,
} from '@shared/types/database'
