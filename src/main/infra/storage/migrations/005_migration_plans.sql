-- 005_migration_plans.sql
-- 迁移方案持久化（M5 D3 决策：必做）。
-- 仅存储迁移配置（源/目标连接、表清单、维度、选项、告警），不存储任何数据行。
-- plan_json 存 MigrationPlan 全量序列化。

CREATE TABLE IF NOT EXISTS migration_plans (
  id            TEXT PRIMARY KEY,             -- 方案 id（UUID）
  name          TEXT NOT NULL,                -- 方案名称（用户可读）
  source_conn   TEXT NOT NULL,                -- 源连接 id
  target_conn   TEXT NOT NULL,                -- 目标连接 id
  plan_json     TEXT NOT NULL,                -- MigrationPlan 全量 JSON（不含 id/时间戳）
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_migration_plans_source ON migration_plans(source_conn);
CREATE INDEX IF NOT EXISTS idx_migration_plans_target ON migration_plans(target_conn);
CREATE INDEX IF NOT EXISTS idx_migration_plans_updated ON migration_plans(updated_at);
