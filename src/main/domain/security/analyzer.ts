/**
 * SQL 安全分析器
 *
 * 用 node-sql-parser 解析 SQL AST，判断语句类型与危险级别。
 * 解析失败时保守判为 dangerous（需确认），宁可误拦不漏放。
 */
import { Parser } from 'node-sql-parser'

/** SQL 语句类型 */
export type SqlType = 'query' | 'dml' | 'ddl' | 'unknown'

/** 危险级别 */
export type DangerLevel = 'safe' | 'write' | 'dangerous'

/** 分析结果 */
export interface SqlAnalysis {
  type: SqlType
  dangerLevel: DangerLevel
  reasons: string[]
  tables: string[]
  parseFailed: boolean
}

const DANGEROUS_KEYWORDS = ['DROP', 'TRUNCATE', 'SHUTDOWN', 'GRANT', 'REVOKE']

const parser = new Parser()

/** 分析单条 SQL */
export function analyzeSql(sql: string): SqlAnalysis {
  const trimmed = sql.trim()
  if (!trimmed) {
    return {
      type: 'unknown',
      dangerLevel: 'safe',
      reasons: ['空语句'],
      tables: [],
      parseFailed: false,
    }
  }

  const reasons: string[] = []
  const tables: string[] = []
  let type: SqlType = 'unknown'
  let dangerLevel: DangerLevel = 'safe'
  let parseFailed = false

  // 危险关键字黑名单
  for (const kw of DANGEROUS_KEYWORDS) {
    const re = new RegExp('\\b' + kw + '\\b', 'i')
    if (re.test(trimmed)) {
      dangerLevel = 'dangerous'
      reasons.push('包含危险关键字: ' + kw)
      if (kw === 'DROP' || kw === 'TRUNCATE') type = 'ddl'
    }
  }

  // 启发式类型判断
  if (type === 'unknown') {
    if (/^\s*(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|PRAGMA)\b/i.test(trimmed)) {
      type = 'query'
    } else if (/^\s*(INSERT|UPDATE|DELETE|REPLACE|MERGE)\b/i.test(trimmed)) {
      type = 'dml'
      if (dangerLevel === 'safe') dangerLevel = 'write'
    } else if (/^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i.test(trimmed)) {
      type = 'ddl'
      if (dangerLevel === 'safe') dangerLevel = 'write'
    }
  }

  // node-sql-parser 精确分析
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ast: any = parser.astify(trimmed)
    const stmts = Array.isArray(ast) ? ast : [ast]
    for (const stmt of stmts) {
      const stmtType: string = stmt?.type || stmt?.ast?.type || ''

      // 提取表名
      const tableRefs = stmt?.table || stmt?.tables || stmt?.ast?.table
      if (tableRefs) {
        const refs = Array.isArray(tableRefs) ? tableRefs : [tableRefs]
        for (const ref of refs) {
          const name = ref?.table || ref?.db
          if (name && !tables.includes(name)) tables.push(name)
        }
      }

      // DELETE/UPDATE 无 WHERE
      if (stmtType === 'delete' || stmtType === 'update') {
        const hasWhere = !!(stmt?.where || stmt?.ast?.where)
        if (!hasWhere) {
          dangerLevel = 'dangerous'
          reasons.push(stmtType.toUpperCase() + ' 缺少 WHERE 子句（全表操作）')
        }
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch {
    parseFailed = true
    if (dangerLevel === 'safe' && type !== 'query') {
      dangerLevel = 'dangerous'
      reasons.push('SQL 解析失败，保守判定为需确认')
    }
  }

  if (reasons.length === 0 && dangerLevel === 'safe') {
    reasons.push('只读查询')
  }

  return { type, dangerLevel, reasons, tables, parseFailed }
}

/** 分析多条语句，取最高危险级别 */
export function analyzeSqlBatch(sql: string): SqlAnalysis {
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (statements.length === 0) return analyzeSql('')

  const analyses = statements.map(analyzeSql)
  const dangerOrder: DangerLevel[] = ['safe', 'write', 'dangerous']
  const maxDanger = analyses.reduce((max, a) => {
    return dangerOrder.indexOf(a.dangerLevel) > dangerOrder.indexOf(max) ? a.dangerLevel : max
  }, 'safe' as DangerLevel)

  return {
    type: analyses[0]!.type,
    dangerLevel: maxDanger,
    reasons: [...new Set(analyses.flatMap((a) => a.reasons))],
    tables: [...new Set(analyses.flatMap((a) => a.tables))],
    parseFailed: analyses.some((a) => a.parseFailed),
  }
}
