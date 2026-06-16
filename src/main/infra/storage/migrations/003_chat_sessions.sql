-- 003_chat_sessions.sql
-- AI 对话会话元信息表。
-- chat_history（001_init.sql 已建）存储会话内的逐条消息，
-- 本表存储会话本身的元信息（标题、关联连接、最后活动时间）。

CREATE TABLE IF NOT EXISTS chat_sessions (
  id            TEXT PRIMARY KEY,             -- 会话 id（前端生成，与 chat_history.session_id 对应）
  title         TEXT NOT NULL,                -- 会话标题（默认取首条用户消息前 N 字）
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  schema_name   TEXT,                         -- 关联 schema（PG 等）
  -- 创建/最后活动时间，用于任务列表排序
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_conn ON chat_sessions(connection_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at);
