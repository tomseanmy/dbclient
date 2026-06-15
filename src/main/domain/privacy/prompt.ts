/**
 * System Prompt 模板集中管理
 *
 * Provider 不感知业务语义，所有 prompt 构造在领域层完成。
 * 按 action 产出不同的 system 指令，但共享 Schema 上下文注入。
 */
import type { DbType } from '@shared/types/connection'
import type { ChatMessage } from '@shared/types/llm'

/** 方言显示名 */
const DIALECT: Record<DbType, string> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  redis: 'Redis',
}

/**
 * NL2SQL / 通用对话的 system prompt。
 * 注入 DB 方言 + Schema 结构，约束 SQL 输出格式。
 */
export function buildChatSystemPrompt(dbType: DbType, schemaContext: string): string {
  return `你是一位经验丰富的数据库专家助手。用户正在操作一个 ${DIALECT[dbType]} 数据库。

以下是当前数据库的结构（Schema），仅含表/列/类型/注释，不含实际数据：

${schemaContext}

## 你的职责
1. 根据用户的自然语言需求，生成符合 ${DIALECT[dbType]} 方言的 SQL。
2. 生成的 SQL 用 \`\`\`sql 代码块包裹，并在代码块前后给出简短说明。
3. 如果用户的意图不明确或存在歧义，先提问确认，不要臆测。
4. 对于可能修改数据的操作（INSERT/UPDATE/DELETE）或危险操作（DROP/TRUNCATE），在说明中标注风险。
5. 只输出 SQL 和必要说明，不要执行任何操作。

## 输出格式示例
好的，查询所有用户的 SQL 如下：

\`\`\`sql
SELECT id, username, email FROM users ORDER BY created_at DESC LIMIT 100;
\`\`\`

这条语句查询 users 表最近 100 条记录。`
}

/** SQL 解释的 system prompt */
export function buildExplainPrompt(dbType: DbType, schemaContext: string): string {
  return `你是一位数据库专家。用户选中了一段 ${DIALECT[dbType]} SQL，请用清晰的自然语言解释它的作用。

数据库结构参考：
${schemaContext}

要求：
- 先一句话总结这条 SQL 做了什么。
- 如有必要，解释涉及的表/列/条件/连接。
- 如果发现潜在问题（如缺少 WHERE、性能隐患），主动指出。
- 用中文回答，简洁明了。`
}

/** SQL 优化建议的 system prompt */
export function buildOptimizePrompt(dbType: DbType, schemaContext: string): string {
  return `你是一位数据库性能优化专家。用户选中了一段 ${DIALECT[dbType]} SQL，请给出优化建议。

数据库结构参考（含索引信息）：
${schemaContext}

要求：
- 先分析这条 SQL 的潜在性能问题（全表扫描、缺少索引、N+1 等）。
- 给出具体的优化方案，优化后的 SQL 用 \`\`\`sql 代码块包裹。
- 结合现有索引/表结构，说明为什么这样优化。
- 用中文回答，务实具体。`
}

/** 自然语言转 SQL 的 system prompt */
export function buildNl2SqlPrompt(dbType: DbType, schemaContext: string): string {
  return `你是一位数据库专家。用户用自然语言描述了需求，请将其转换为 ${DIALECT[dbType]} SQL。

数据库结构参考：
${schemaContext}

要求：
- 生成的 SQL 用 \`\`\`sql 代码块包裹。
- 代码块前给出简短说明。
- 如果需求模糊，先列出你的假设。
- 默认只读查询（SELECT）；如需写操作，标注风险。`
}

/** 执行报错修复建议的 system prompt */
export function buildFixErrorPrompt(dbType: DbType, schemaContext: string): string {
  return `你是一位数据库专家。用户执行 ${DIALECT[dbType]} SQL 时报错了，请分析原因并给出修复方案。

数据库结构参考：
${schemaContext}

要求：
- 先指出错误原因。
- 给出修复后的 SQL（用 \`\`\`sql 代码块包裹）。
- 简要说明修改了什么、为什么。
- 用中文回答。`
}

/** 构造数据流向提示（供前端 UI 展示） */
export function describeDataFlow(
  providerName: string,
  includedTables: string[],
): { providerName: string; summary: string; tableNames: string[] } {
  const tableWord =
    includedTables.length > 0 ? `Schema（${includedTables.length} 张表）` : '对话文本'
  return {
    providerName,
    summary: `将向 ${providerName} 发送：${tableWord}`,
    tableNames: includedTables,
  }
}

/** 组装完整消息列表（system + 历史 + 当前 user） */
export function buildMessages(
  systemPrompt: string,
  history: ChatMessage[],
  userContent: string,
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userContent },
  ]
}
