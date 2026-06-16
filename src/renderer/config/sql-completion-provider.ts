/**
 * Monaco SQL 补全 Provider 注册
 *
 * 注册一个 CompletionItemProvider，提供：
 * - 表名/视图名补全（FROM / JOIN / INTO 后，或字母触发）
 * - 列名补全（`alias.` 或 SELECT/WHERE 上下文）
 * - SQL 关键字 / 常用函数 / snippet 模板
 *
 * 数据源来自 sql-completion 服务（当前激活连接的 schema）。
 * 全局只注册一次（按语言 sql）。
 */
import type { languages, CancellationToken } from 'monaco-editor'
import { getCompletionSchema, preloadColumns } from '../services/sql-completion'

let registered = false

/** SQL 关键字（小写归一化比对，补全项用大写展示） */
const KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'ON',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
  'CREATE TABLE',
  'DROP TABLE',
  'ALTER TABLE',
  'AS',
  'DISTINCT',
  'UNION',
  'UNION ALL',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS NULL',
  'IS NOT NULL',
  'IN',
  'NOT IN',
  'BETWEEN',
  'LIKE',
  'EXISTS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'ASC',
  'DESC',
  'PRIMARY KEY',
  'FOREIGN KEY',
  'REFERENCES',
  'INDEX',
  'EXPLAIN',
  'SHOW',
  'DESCRIBE',
  'WITH',
  'RECURSIVE',
]

/** snippet 模板：插入多行结构 */
const SNIPPETS: { label: string; insert: string }[] = [
  {
    label: 'SELECT * FROM',
    insert: 'SELECT\n  *\nFROM ${1:table}\nWHERE ${2:condition}',
  },
  {
    label: 'JOIN ... ON',
    insert: 'JOIN ${1:table} ON ${2:a.id} = ${3:b.id}',
  },
  {
    label: 'GROUP BY ... HAVING',
    insert: 'GROUP BY ${1:column}\nHAVING ${2:condition}',
  },
  {
    label: 'INSERT INTO',
    insert: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})',
  },
  {
    label: 'LEFT JOIN',
    insert: 'LEFT JOIN ${1:table} ON ${2:a.id} = ${3:b.id}',
  },
]

/**
 * 注册 SQL 补全 provider（应用启动调用一次）。
 * @param monaco monaco-editor 命名空间（loader.config 后可用）
 */
export function registerSqlCompletion(monaco: typeof import('monaco-editor')): void {
  if (registered) return
  registered = true

  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    async provideCompletionItems(
      model,
      position,
      _context,
      token: CancellationToken,
    ): Promise<languages.CompletionList> {
      const lineUntil = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const suggestions: languages.CompletionItem[] = []
      const ctx = await getCompletionSchema()

      // 触发 token 取消时，不阻塞
      if (token.isCancellationRequested) return { suggestions }

      // —— 列补全：alias. 形式 ——
      const dotMatch = lineUntil.match(/(\w+)\.\s*\w*$/)
      if (dotMatch && ctx) {
        const alias = dotMatch[1]!
        // 解析 alias → 表名：从已输入 SQL 中找 `表名 alias` 或 `表名 AS alias`
        const aliasPattern = new RegExp(
          `(?:FROM|JOIN)\\s+(\\w+)(?:\\s+(?:AS\\s+)?${escapeRe(alias)})\\b`,
          'i',
        )
        const aliasHit = lineUntil.match(aliasPattern)
        if (aliasHit) {
          const table = aliasHit[1]!
          const cols = ctx.columnsOf(table)
          for (const c of cols) {
            suggestions.push({
              label: c.name,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: c.name,
              detail: `${c.dataType}${c.isPrimaryKey ? ' 🔑PK' : ''}`,
              sortText: '0' + c.name,
              range,
            })
          }
          if (suggestions.length > 0) return { suggestions }
        }
      }

      // —— 表名补全：FROM/JOIN/INTO/UPDATE 后 ——
      const afterTableKw = /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+\w*$/i.test(lineUntil)

      if (ctx) {
        for (const t of ctx.tables) {
          suggestions.push({
            label: t.name,
            kind:
              t.type === 'view'
                ? monaco.languages.CompletionItemKind.Unit
                : monaco.languages.CompletionItemKind.Struct,
            insertText: t.name,
            detail: t.type === 'view' ? '视图' : '表',
            sortText: '1' + t.name,
            range,
          })
        }
        // 预热列结构（表多时异步进行，不阻塞本次补全）
        void preloadColumns()
      }

      // —— 列名补全（无 alias 时）：SELECT/WHERE 上下文 ——
      if (ctx && !afterTableKw) {
        const colCtx = /(SELECT|WHERE|SET|BY|AND|OR|HAVING)\s+/i.test(lineUntil)
        if (colCtx) {
          // 收集 FROM 中出现的表的列（去重）
          const fromTables = extractFromTables(lineUntil)
          const seen = new Set<string>()
          for (const t of fromTables) {
            for (const c of ctx.columnsOf(t)) {
              if (!seen.has(c.name)) {
                seen.add(c.name)
                suggestions.push({
                  label: c.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: c.name,
                  detail: `${c.dataType}${c.isPrimaryKey ? ' 🔑PK' : ''}`,
                  sortText: '2' + c.name,
                  range,
                })
              }
            }
          }
        }
      }

      // —— 关键字 / snippet（通用，排序靠后）——
      for (const kw of KEYWORDS) {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          sortText: '3' + kw,
          range,
        })
      }
      for (const sn of SNIPPETS) {
        suggestions.push({
          label: sn.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: sn.insert,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: '4' + sn.label,
          range,
        })
      }

      return { suggestions }
    },
  })
}

/** 从 SQL 文本中粗略提取 FROM/JOIN 后的表名（用于列补全上下文） */
function extractFromTables(sql: string): string[] {
  const tables: string[] = []
  const re = /\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?\w+)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) {
    if (m[1]) tables.push(m[1])
  }
  return tables
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
