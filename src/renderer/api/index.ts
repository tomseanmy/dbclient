/**
 * 渲染进程侧的 API 封装
 *
 * 直接复用 window.api（由 preload 通过 contextBridge 注入）。
 * 新增 channel 时自动可用（RendererApi 已覆盖）。
 */
export const api = window.api

// 重新导出类型，方便组件使用
export type { SecurityCheckResult, ElevationStatus, AuditLogItem } from '@shared/types/security'

// 表结构编辑：diff + ALTER 生成
export type {
  TableDialect,
  DraftTableMeta,
  DraftColumn,
  DraftIndex,
  DraftForeignKey,
} from '@shared/db/alter-generator'

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
  DatabaseRole,
} from '@shared/types/database'
export type {
  SavedQueryRecord,
  SavedQueryInput,
  SavedQueryUpdatePatch,
} from '@shared/types/saved-query'
export type { ChatSession, ChatMessageRecord, ChatSessionInput } from '@shared/types/chat-session'
export type {
  ToolCallEvent,
  ToolResultEvent,
  AgentTextEvent,
  ToolResultStructured,
} from '@shared/types/agent'
export type { AgentRunRequest } from '@shared/types/agent-run'
export type { UpdateStatus, UpdateInfo } from '@shared/types/update'
export type {
  LlmProvider,
  LlmProviderInput,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  TokenUsage,
  ProviderTestResult,
  DataFlowNotice,
  AiChatRequest,
  AiChatResponse,
  AiAssistRequest,
  AssistAction,
  UsageSummary,
  AiChatStreamRequest,
  AiStreamDeltaPayload,
  AiStreamDonePayload,
  AiStreamErrorPayload,
} from '@shared/types/llm'
export type {
  MigrationTarget,
  StructureDiffItem,
  DataDiffItem,
  DataStrategy,
  TransactionStrategy,
  MigrationDialect,
  TypeMappingWarning,
  WarningSeverity,
  GeneratedStatement,
  MigrationPlan,
  SavedMigrationPlan,
  SavedMigrationPlanInput,
  MigrationResult,
  MigrationFailedItem,
  MigrationOptions,
} from '@shared/types/migration'
