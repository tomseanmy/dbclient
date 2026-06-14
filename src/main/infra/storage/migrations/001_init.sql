-- M0 初始 schema：001_init.sql
-- 应用本地数据库的全部表结构。
-- 敏感字段（密码、API Key）在应用层加密后写入，DB 中只见密文。
-- M0 阶段建全部表，即使空着，避免后续频繁迁移。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================================
-- 1. 应用元信息：记录 schema 版本、配置等
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============================================================================
-- 2. 数据库连接配置
--    M1 模块写入。敏感字段（password / api_key）以密文存储。
-- ============================================================================
CREATE TABLE IF NOT EXISTS connections (
  id              TEXT PRIMARY KEY,           -- uuid
  name            TEXT NOT NULL,              -- 用户可读名称
  type            TEXT NOT NULL,              -- mysql | postgres | sqlite | redis
  host            TEXT,                       -- SQLite 无需 host
  port            INTEGER,
  username        TEXT,
  -- 密码密文（AES-256-GCM，主密码/keytar 派生密钥加密）
  password_cipher TEXT,
  database        TEXT,                       -- 库名 / Redis db index / SQLite 文件路径
  -- 连接选项 JSON：charset / ssl / ssh_tunnel / redis_mode(cluster|single) 等
  options         TEXT,
  -- 环境：dev | staging | prod，驱动权限策略（PRD M9）
  environment     TEXT NOT NULL DEFAULT 'dev',
  -- 分组（用户自定义，用于侧边栏组织）
  group_id        TEXT,
  color           TEXT,                       -- 用户标记颜色
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_connections_group ON connections(group_id);
CREATE INDEX IF NOT EXISTS idx_connections_sort ON connections(sort_order);

-- ============================================================================
-- 3. 连接分组（可选的侧边栏组织）
-- ============================================================================
CREATE TABLE IF NOT EXISTS connection_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- 4. 保存的查询（用户命名收藏的 SQL）
-- ============================================================================
CREATE TABLE IF NOT EXISTS saved_queries (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sql_text      TEXT NOT NULL,
  -- 可关联到具体连接，也可为空（通用查询）
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- 5. SQL 执行历史
-- ============================================================================
CREATE TABLE IF NOT EXISTS sql_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,
  sql_text      TEXT NOT NULL,
  -- success | error
  status        TEXT NOT NULL,
  duration_ms   INTEGER,                      -- 执行耗时
  rows_affected INTEGER,                      -- 影响行数
  error_message TEXT,
  -- gui | ai | mcp —— 调用来源（对应「三条执行路径」）
  source        TEXT NOT NULL DEFAULT 'gui',
  executed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sql_history_conn ON sql_history(connection_id);
CREATE INDEX IF NOT EXISTS idx_sql_history_time ON sql_history(executed_at);

-- ============================================================================
-- 6. AI 对话历史
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 一个会话由多轮消息组成
  session_id    TEXT NOT NULL,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  role          TEXT NOT NULL,                -- user | assistant | system | tool
  content       TEXT NOT NULL,
  -- 关联的 SQL（assistant 生成时可附带）
  sql_text      TEXT,
  -- LLM 用量统计
  model         TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens  INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_time ON chat_history(created_at);

-- ============================================================================
-- 7. Schema 缓存（避免每次都查询 information_schema）
--    M2/M4 使用。带版本，过期重刷。
-- ============================================================================
CREATE TABLE IF NOT EXISTS schema_cache (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  -- 缓存的库名（一个连接可能跨多个库）
  database_name TEXT NOT NULL,
  -- 完整 schema 快照（JSON：表/列/类型/注释/索引/外键）
  snapshot      TEXT NOT NULL,
  -- schema 版本（用于判断是否需要刷新）
  version       TEXT,
  refreshed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_cache_unique
  ON schema_cache(connection_id, database_name);

-- ============================================================================
-- 8. 审计日志（只追加，不可改写）
--    所有写操作 + AI 生成执行 + MCP 调用均记录。安全合规依据。
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- gui | ai | mcp —— 操作来源
  source        TEXT NOT NULL,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  -- action 类型：query_readonly | query_write | ddl | dangerous_confirmed | elevate | ...
  action        TEXT NOT NULL,
  -- 执行的 SQL 或操作描述
  detail        TEXT,
  -- allow | deny | confirm_required —— 权限判定结果
  decision      TEXT NOT NULL,
  -- 影响行数（如适用）
  rows_affected INTEGER,
  -- 危险级别（如有）：drop | truncate | delete_no_where | ...
  risk_level    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_conn ON audit_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

-- ============================================================================
-- 9. LLM Token / 费用统计
-- ============================================================================
CREATE TABLE IF NOT EXISTS llm_usage (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  provider         TEXT NOT NULL,             -- provider 名称
  model            TEXT NOT NULL,
  prompt_tokens    INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  -- 估算费用（美元），由 provider 配置的单价计算
  estimated_cost   REAL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_time ON llm_usage(created_at);

-- ============================================================================
-- 初始化元数据
-- ============================================================================
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('created_at', datetime('now'));
