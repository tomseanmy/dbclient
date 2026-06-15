/**
 * LLM Token 用量 DAO
 *
 * 基于 M0 预建的 llm_usage 表，记录每次 LLM 调用的 token 消耗。
 * 表结构（001_init.sql）：provider / model / *_tokens / estimated_cost / created_at
 */
import type { TokenUsage, UsageSummary } from '@shared/types/llm'
import { getDb } from './db'

interface UsageRow {
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  estimated_cost: number | null
  created_at: string
}

export interface UsageRecordInput {
  provider: string
  model: string
  usage: TokenUsage
  /** 调用来源：chat / explain / optimize / nl2sql / fixError */
  action?: string
}

export const llmUsageDao = {
  /** 记录一次调用的 token 用量 */
  record(input: UsageRecordInput): void {
    const db = getDb()
    db.prepare(
      `INSERT INTO llm_usage
        (provider, model, prompt_tokens, completion_tokens, total_tokens)
       VALUES
        (@provider, @model, @prompt_tokens, @completion_tokens, @total_tokens)`,
    ).run({
      provider: input.provider,
      model: input.model,
      prompt_tokens: input.usage.prompt,
      completion_tokens: input.usage.completion,
      total_tokens: input.usage.total,
    })
  },

  /** 汇总用量（按 provider 聚合） */
  summary(): UsageSummary {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT provider, model, prompt_tokens, completion_tokens, total_tokens
         FROM llm_usage`,
      )
      .all() as UsageRow[]

    const byProvider = new Map<string, { totalTokens: number; calls: number }>()
    let totalTokens = 0

    for (const r of rows) {
      const entry = byProvider.get(r.provider) ?? { totalTokens: 0, calls: 0 }
      entry.totalTokens += r.total_tokens
      entry.calls += 1
      byProvider.set(r.provider, entry)
      totalTokens += r.total_tokens
    }

    return {
      totalTokens,
      totalCalls: rows.length,
      byProvider: [...byProvider.entries()].map(([provider, v]) => ({
        provider,
        totalTokens: v.totalTokens,
        calls: v.calls,
      })),
    }
  },

  /** 清空用量记录 */
  clear(): void {
    const db = getDb()
    db.prepare(`DELETE FROM llm_usage`).run()
  },
}
