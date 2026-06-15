-- M4：LLM Provider 配置表
-- API Key 不存此表，存 CredentialStore（key 形如 llm:<providerId>）。
CREATE TABLE IF NOT EXISTS llm_providers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  models_json TEXT NOT NULL DEFAULT '[]',
  is_default  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_llm_providers_default ON llm_providers(is_default);
