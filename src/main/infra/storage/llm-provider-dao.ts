/**
 * LLM Provider 配置 DAO
 *
 * Provider 配置存本地 SQLite（llm_providers 表），API Key 单独走 CredentialStore。
 * 对外暴露的 list/get 不含 API Key。
 *
 * CredentialStore key 约定：`llm:<providerId>`
 */
import { randomUUID } from 'node:crypto'
import type { LlmProvider, LlmProviderInput } from '@shared/types/llm'
import { getDb } from './db'
import { getCredentialStore } from '../credential'

interface ProviderRow {
  id: string
  name: string
  base_url: string
  models_json: string
  sort_order: number
  created_at: string
  updated_at: string
}

function rowToProvider(row: ProviderRow): LlmProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    models: JSON.parse(row.models_json) as string[],
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** CredentialStore 的 key 前缀 */
export const credentialKey = (providerId: string): string => `llm:${providerId}`

export const llmProviderDao = {
  /** 列出所有 provider（不含 API Key） */
  list(): LlmProvider[] {
    const db = getDb()
    const rows = db
      .prepare(`SELECT * FROM llm_providers ORDER BY sort_order, name`)
      .all() as ProviderRow[]
    return rows.map(rowToProvider)
  },

  /** 获取单个 provider */
  get(id: string): LlmProvider | null {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM llm_providers WHERE id = ?`).get(id) as
      | ProviderRow
      | undefined
    return row ? rowToProvider(row) : null
  },

  /** 获取默认 provider（排序最前的第一个；分类默认模型见 app_settings） */
  getDefault(): LlmProvider | null {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM llm_providers ORDER BY sort_order LIMIT 1`).get() as
      | ProviderRow
      | undefined
    return row ? rowToProvider(row) : null
  },

  /** 获取 provider 的 API Key（从 CredentialStore） */
  async getApiKey(id: string): Promise<string | null> {
    return getCredentialStore().getPassword(credentialKey(id))
  },

  /** 新建 provider */
  async create(input: LlmProviderInput): Promise<LlmProvider> {
    const db = getDb()
    const id = randomUUID()
    const now = new Date().toISOString()

    db.prepare(
      `INSERT INTO llm_providers
        (id, name, base_url, models_json, sort_order, created_at, updated_at)
       VALUES
        (@id, @name, @base_url, @models_json, @sort_order, @created_at, @updated_at)`,
    ).run({
      id,
      name: input.name,
      base_url: input.baseUrl,
      models_json: JSON.stringify(input.models ?? []),
      sort_order: input.sortOrder ?? 0,
      created_at: now,
      updated_at: now,
    })

    if (input.apiKey) {
      await getCredentialStore().setPassword(credentialKey(id), input.apiKey)
    }

    const created = this.get(id)
    if (!created) {
      throw new Error(`Provider 创建后查询失败：${id}`)
    }
    return created
  },

  /** 更新 provider（apiKey 留空保持不变，与连接密码同一逻辑） */
  async update(id: string, input: LlmProviderInput): Promise<LlmProvider> {
    const db = getDb()
    const now = new Date().toISOString()

    db.prepare(
      `UPDATE llm_providers SET
        name = @name, base_url = @base_url, models_json = @models_json,
        sort_order = @sort_order, updated_at = @updated_at
       WHERE id = @id`,
    ).run({
      id,
      name: input.name,
      base_url: input.baseUrl,
      models_json: JSON.stringify(input.models ?? []),
      sort_order: input.sortOrder ?? 0,
      updated_at: now,
    })

    // 只有传入非空 apiKey 才更新；留空保持不变（避免 IPC 序列化误删）
    if (input.apiKey) {
      await getCredentialStore().setPassword(credentialKey(id), input.apiKey)
    }

    const updated = this.get(id)
    if (!updated) {
      throw new Error(`Provider 更新后查询失败：${id}`)
    }
    return updated
  },

  /** 删除 provider（同时删除 API Key） */
  async remove(id: string): Promise<void> {
    const db = getDb()
    db.prepare(`DELETE FROM llm_providers WHERE id = ?`).run(id)
    await getCredentialStore().deletePassword(credentialKey(id))
  },
}
