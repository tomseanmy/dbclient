/**
 * AGENT 工具定义与执行
 *
 * 每个工具包含：
 * - schema（OpenAI 兼容 function-calling 描述，传给 LLM）
 * - 执行器（接 connectionId + 参数，返回结构化结果）
 *
 * 安全原则（T2.5）：
 * - 只读查询工具（runReadQuery）静态拦截非只读 SQL，绝不执行写操作
 * - 写操作不作为自动工具暴露（AGENT 首版聚焦"分析"场景）
 *   写需求通过 generateSql 工具生成 SQL 卡片，由用户在编辑器确认执行
 * - 所有工具调用记审计日志（source = ai-agent）
 */
import type { ToolDefinition } from '@main/domain/llm/client'
import type { ToolResultStructured } from '@shared/types/agent'
import { getDriver } from '@main/domain/db/manager'
import { checkSql } from '@main/domain/executor'
import { auditLogDao } from '@main/infra/storage/audit-log-dao'
import { logger } from '@main/infra/logger'

/** 工具执行结果 */
export interface ToolExecResult {
  /** 是否成功 */
  ok: boolean
  /** 序列化结果文本（回灌给 LLM + 前端展示） */
  result: string
  /** 结构化结果（前端卡片渲染） */
  structured?: ToolResultStructured
}

/** 工具执行器签名 */
export type ToolExecutor = (
  connectionId: string,
  schema: string | undefined,
  args: Record<string, unknown>,
) => Promise<ToolExecResult>

/** 判断 SQL 是否只读（白名单：仅这些前缀允许自动执行） */
function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase()
  return (
    trimmed.startsWith('SELECT') ||
    trimmed.startsWith('WITH') ||
    trimmed.startsWith('EXPLAIN') ||
    trimmed.startsWith('SHOW') ||
    trimmed.startsWith('DESCRIBE') ||
    trimmed.startsWith('PRAGMA')
  )
}

/** 记审计（工具调用） */
function audit(
  connectionId: string,
  action: string,
  detail: string,
  decision: 'allow' | 'deny',
): void {
  auditLogDao.record({
    source: 'ai',
    connectionId,
    action,
    detail: detail.slice(0, 500),
    decision,
    rowsAffected: null,
    riskLevel: decision === 'deny' ? 'agent_tool_blocked' : null,
  })
}

// —— 工具 schema（传给 LLM）——

const TOOLS_SCHEMA: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'listTables',
      description: '列出当前数据库中的所有表和视图。当你需要了解数据库结构时调用。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describeTable',
      description:
        '查看指定表的列结构（列名、类型、主键、注释等）。当你需要了解某张表的字段细节时调用。',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: '表名' },
        },
        required: ['table'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runReadQuery',
      description:
        '执行只读查询（SELECT/WITH/EXPLAIN/SHOW）并返回结果。仅用于读取数据，严禁用于写操作。最多返回 50 行。',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: '只读 SQL 语句' },
        },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generateSql',
      description:
        '生成 SQL（不执行）。用于需要写操作（INSERT/UPDATE/DELETE/DDL）时生成 SQL 文本，由用户确认后执行。',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: '要生成的 SQL 的需求描述' },
          sql: { type: 'string', description: '生成的 SQL 语句' },
        },
        required: ['sql'],
      },
    },
  },
]

export function getToolsSchema(): ToolDefinition[] {
  return TOOLS_SCHEMA
}

// —— 工具执行器 ——

const EXECUTORS: Record<string, ToolExecutor> = {
  async listTables(connectionId, schema) {
    try {
      const driver = getDriver(connectionId)
      const tables = await driver.listTables(schema)
      audit(connectionId, 'query_readonly', `listTables (${tables.length} 张表)`, 'allow')
      const summary = tables.map((t) => t.name).join(', ')
      return {
        ok: true,
        result: `共 ${tables.length} 张表/视图：${summary}`,
        structured: {
          kind: 'tables',
          tables: tables.map((t) => ({ name: t.name, type: t.type })),
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      audit(connectionId, 'query_readonly', `listTables 失败: ${message}`, 'deny')
      return { ok: false, result: `列出表失败: ${message}` }
    }
  },

  async describeTable(connectionId, schema, args) {
    const table = String(args.table ?? '')
    if (!table) return { ok: false, result: '缺少 table 参数' }
    try {
      const driver = getDriver(connectionId)
      const meta = await driver.describeTable({ schema, table })
      audit(connectionId, 'query_readonly', `describeTable: ${table}`, 'allow')
      const cols = meta.columns
        .map((c) => `${c.name} ${c.dataType}${c.isPrimaryKey ? ' PK' : ''}`)
        .join(', ')
      return {
        ok: true,
        result: `表 ${table} 的列：${cols}`,
        structured: {
          kind: 'schema',
          tableName: table,
          columns: cols2structured(meta.columns),
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      audit(connectionId, 'query_readonly', `describeTable ${table} 失败: ${message}`, 'deny')
      return { ok: false, result: `查看表结构失败: ${message}` }
    }
  },

  async runReadQuery(connectionId, schema, args) {
    const sql = String(args.sql ?? '')
    if (!sql) return { ok: false, result: '缺少 sql 参数' }

    // T2.5 安全层：静态拦截非只读 SQL（绝不自动执行写操作）
    if (!isReadOnlySql(sql)) {
      audit(connectionId, 'query_write', `AGENT 工具拦截非只读 SQL: ${sql.slice(0, 200)}`, 'deny')
      logger.warn('AGENT 工具拦截非只读 SQL', { connectionId, sql: sql.slice(0, 100) })
      return {
        ok: false,
        result:
          '安全限制：runReadQuery 仅允许只读查询（SELECT/WITH/EXPLAIN/SHOW）。如需写操作请用 generateSql 生成 SQL 让用户确认。',
        structured: { kind: 'error', message: '只读查询工具拒绝了写操作' },
      }
    }

    // 进一步走完整安全检查（环境/提权），只读查询任何环境都 allow
    const check = checkSql({ connectionId, source: 'ai' }, sql)
    if (!check.allowed) {
      audit(connectionId, check.analysis.type, `AGENT 工具安全检查拒绝: ${check.reason}`, 'deny')
      return {
        ok: false,
        result: `安全检查未通过：${check.reason}`,
        structured: { kind: 'error', message: check.reason },
      }
    }

    try {
      const driver = getDriver(connectionId)
      const result = await driver.executeQuery(sql, { limit: 50 })
      audit(connectionId, 'query_readonly', `runReadQuery (${result.rowCount} 行)`, 'allow')
      const columns = result.columns.map((c) => c.name)
      // 对象行 → 按 columns 顺序的二维数组（结构化结果与序列化统一）
      const rows2d = result.rows.map((r) => columns.map((c) => r[c] ?? null))
      // 序列化前 20 行给 LLM（避免 token 爆炸）
      const preview = rows2d.slice(0, 20)
      const summary = `查询返回 ${result.rowCount} 行，列：${columns.join(', ')}。\n前 ${preview.length} 行：\n${serializeRows(columns, preview)}`
      return {
        ok: true,
        result: summary,
        structured: {
          kind: 'query',
          columns,
          rows: rows2d,
          rowCount: result.rowCount,
          truncated: result.rowCount > 50,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // T2.7：执行错误的 SQL 时返回结构化错误，供 agent loop 回灌给 LLM 自修复
      audit(connectionId, 'query_readonly', `runReadQuery 失败: ${message}`, 'deny')
      return {
        ok: false,
        result: `查询执行失败：${message}`,
        structured: { kind: 'error', message },
      }
    }
  },

  async generateSql(connectionId, _schema, args) {
    const sql = String(args.sql ?? '')
    if (!sql) return { ok: false, result: '缺少 sql 参数' }
    // 仅生成不执行；记审计标注来源
    audit(connectionId, 'generate_sql', `AGENT 生成 SQL: ${sql.slice(0, 200)}`, 'allow')
    return {
      ok: true,
      result: `已生成 SQL（需用户确认后执行）：${sql}`,
      structured: { kind: 'sql', sql },
    }
  },
}

/** 执行工具（按名字分发） */
export async function executeTool(
  name: string,
  connectionId: string,
  schema: string | undefined,
  args: Record<string, unknown>,
): Promise<ToolExecResult> {
  const executor = EXECUTORS[name]
  if (!executor) {
    return { ok: false, result: `未知工具: ${name}` }
  }
  return executor(connectionId, schema, args)
}

// —— 辅助 ——

import type { Column } from '@shared/types/database'

function cols2structured(
  columns: Column[],
): { name: string; dataType: string; isPrimaryKey: boolean }[] {
  return columns.map((c) => ({ name: c.name, dataType: c.dataType, isPrimaryKey: c.isPrimaryKey }))
}

/** 把行序列化为 Markdown 表格（回灌 LLM 用） */
function serializeRows(columns: string[], rows: unknown[][]): string {
  if (rows.length === 0) return '（无数据）'
  const header = `| ${columns.join(' | ')} |`
  const sep = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map((c) => formatCell(c)).join(' | ')} |`).join('\n')
  return `${header}\n${sep}\n${body}`
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 100)
  return String(v).slice(0, 100)
}
