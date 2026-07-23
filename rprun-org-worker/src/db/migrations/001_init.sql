-- ============ 001_init.sql ============

-- users 表
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  prun_username   TEXT NOT NULL,
  company_code    TEXT NOT NULL,
  -- display_name 不设默认：SQLite/D1 不支持 DEFAULT 列引用，
  -- 历史曾用 `DEFAULT prun_username` 被解释为字符串字面量导致脏数据。
  -- 由 registerWithInvite 在 INSERT 时显式 bind prun_username。
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'COLLABORATOR'
                  CHECK (role IN ('BOARD','COLLABORATOR')),
  invite_code_id  TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT,
  UNIQUE (prun_username, company_code)
);
CREATE INDEX idx_users_username_company ON users (prun_username, company_code);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role ON users (role);

-- invite_codes 表
CREATE TABLE IF NOT EXISTS invite_codes (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  used_by_user_id TEXT UNIQUE,
  used_at         TEXT,
  revoked_at      TEXT
);
CREATE INDEX idx_invite_codes_code ON invite_codes (code);

-- refresh_tokens 表
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at      TEXT
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- tasks 表
CREATE TABLE IF NOT EXISTS tasks (
  id                     TEXT PRIMARY KEY,
  type                   TEXT NOT NULL CHECK (type IN ('BUY','SELL','SHIP','LOAN')),
  contract_json          TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'PUBLISHED'
                         CHECK (status IN ('PUBLISHED','AWAITING_CONTRACT','IN_PROGRESS','COMPLETED','CANCELLED')),
  publisher_id           TEXT NOT NULL REFERENCES users(id),
  publisher_username     TEXT NOT NULL,
  publisher_company_code TEXT NOT NULL,
  claimer_id             TEXT REFERENCES users(id),
  claimer_username       TEXT,
  claimer_company_code   TEXT,
  contract_id            TEXT UNIQUE,
  contract_creator       TEXT CHECK (contract_creator IN ('publisher','claimer')),
  expires_at             TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  published_at           TEXT,
  claimed_at             TEXT,
  in_progress_at         TEXT,
  completed_at           TEXT,
  cancelled_at           TEXT,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_publisher_status ON tasks (publisher_id, status);
CREATE INDEX idx_tasks_claimer_status ON tasks (claimer_id, status);
CREATE INDEX idx_tasks_type_status ON tasks (type, status);
CREATE INDEX idx_tasks_contract_id ON tasks (contract_id);
CREATE INDEX idx_tasks_updated_at ON tasks (updated_at);

-- task_notes 表
CREATE TABLE IF NOT EXISTS task_notes (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id       TEXT NOT NULL REFERENCES users(id),
  author_username TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_notes_task_created ON task_notes (task_id, created_at);

-- audit_logs 表
CREATE TABLE IF NOT EXISTS audit_logs (
  id              TEXT PRIMARY KEY,
  actor_type      TEXT NOT NULL,
  actor_id        TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_type, actor_id);

-- rate_limit_buckets 表（替代 KV 限流）
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_rate_limit_expires ON rate_limit_buckets (expires_at);

-- updated_at 触发器
CREATE TRIGGER IF NOT EXISTS trg_tasks_touch_updated_at
  AFTER UPDATE ON tasks
  FOR EACH ROW
  BEGIN
    UPDATE tasks SET updated_at = datetime('now') WHERE id = OLD.id;
  END;
