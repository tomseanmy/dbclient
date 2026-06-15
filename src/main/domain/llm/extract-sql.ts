/**
 * 从 LLM 回复文本中提取 SQL 代码块。
 *
 * 支持 ```sql ... ``` 围栏格式，也兼容无围栏的纯 SQL（启发式）。
 * 返回所有提取到的 SQL 片段，首个视为推荐。
 */

const FENCED_SQL = /```(?:sql|SQL)?\s*\n([\s\S]*?)```/g

/**
 * 提取回复中的 SQL。
 * @returns SQL 字符串数组（可能为空）
 */
export function extractSql(text: string): string[] {
  const results: string[] = []

  // 1. 匹配围栏代码块（```sql 或 ``` 无语言标记）
  let match: RegExpExecArray | null
  FENCED_SQL.lastIndex = 0
  while ((match = FENCED_SQL.exec(text)) !== null) {
    const code = match[1]?.trim()
    if (code) results.push(code)
  }

  if (results.length > 0) return results

  // 2. 启发式：整段看起来像 SQL（含关键字且无中文标点）则当作 SQL
  const trimmed = text.trim()
  const sqlKeywords = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|PRAGMA)\b/i
  if (sqlKeywords.test(trimmed) && trimmed.length < 2000) {
    results.push(trimmed)
  }

  return results
}
