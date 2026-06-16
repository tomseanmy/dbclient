-- 应用级设置（KV）
-- 与 app_meta 区分：app_meta 存系统元数据（schema_version 等），
-- app_settings 存用户可配置项（主题、语言、通知偏好等）。
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
