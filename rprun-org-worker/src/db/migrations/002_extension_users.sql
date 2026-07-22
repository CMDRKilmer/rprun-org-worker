-- ============ 002_extension_users.sql ============

-- extension_users 表：存储所有使用扩展的用户（包括未注册 ORG 的用户）
CREATE TABLE IF NOT EXISTS extension_users (
  id              TEXT PRIMARY KEY,
  prun_username   TEXT NOT NULL,
  company_code    TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  reported_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (prun_username, company_code)
);
CREATE INDEX idx_extension_users_username_company ON extension_users (prun_username, company_code);
CREATE INDEX idx_extension_users_reported ON extension_users (reported_at);
