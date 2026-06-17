/**
 * i18n key 常量
 *
 * 主进程产出的「跨 IPC 边界、直接显示给用户」的字符串统一用 key 表达
 * （如安全 reason、连接/LLM/迁移错误、agent 工具结果）。
 * 渲染层对这些字段调 t() 翻译；非 key 的纯文本 t() 会原样回退，安全。
 *
 * 命名约定：与 src/shared/i18n/{zh-CN,en}.json 的嵌套结构一一对应。
 * 渲染层 JSX 内联文案则直接用 t('ns.key') 字面量，不必走本常量表。
 */

/** 安全策略 reason（policy.ts 产出，ConfirmDialog/PermissionNotice 渲染） */
export const SECURITY_REASON = {
  readonly: 'security.policy.readonly',
  dangerousNeedConfirm: 'security.policy.dangerousNeedConfirm',
  dangerousNeedConfirmProdElevated: 'security.policy.dangerousNeedConfirmProdElevated',
  prodDangerousDenied: 'security.policy.prodDangerousDenied',
  devWriteAllowed: 'security.policy.devWriteAllowed',
  stagingDdlNeedConfirm: 'security.policy.stagingDdlNeedConfirm',
  stagingDmlAllowed: 'security.policy.stagingDmlAllowed',
  prodElevatedDdlNeedConfirm: 'security.policy.prodElevatedDdlNeedConfirm',
  prodElevatedWriteAllowed: 'security.policy.prodElevatedWriteAllowed',
  prodWriteDenied: 'security.policy.prodWriteDenied',
} as const

/** 安全分析 reason（analyzer.ts 产出，ConfirmDialog 渲染，可带插值 {{keyword}}/{{stmtType}}） */
export const ANALYSIS_REASON = {
  emptyStatement: 'security.analysis.emptyStatement',
  dangerousKeyword: 'security.analysis.dangerousKeyword',
  missingWhere: 'security.analysis.missingWhere',
  parseFailed: 'security.analysis.parseFailed',
  readonly: 'security.analysis.readonly',
} as const

/** agent 工具结果文本（tools.ts 产出，ToolCard 渲染，可带插值） */
export const AGENT_TOOL_MSG = {
  tableCount: 'agent.tools.tableCount',
  listTablesFailed: 'agent.tools.listTablesFailed',
  describeSucceeded: 'agent.tools.describeSucceeded',
  describeFailed: 'agent.tools.describeFailed',
  missingTableParam: 'agent.tools.missingTableParam',
  readonlyQueryRejected: 'agent.tools.readonlyQueryRejected',
  queryResultRows: 'agent.tools.queryResultRows',
  queryFailed: 'agent.tools.queryFailed',
  sqlGenerated: 'agent.tools.sqlGenerated',
  sqlMissingInput: 'agent.tools.sqlMissingInput',
  sqlGenerateFailed: 'agent.tools.sqlGenerateFailed',
} as const
