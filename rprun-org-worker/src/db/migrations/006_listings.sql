-- ============ 006_listings.sql ============
--
-- 市场挂单与任务系统解耦：
-- - 新增 listings 表：市场挂单实体（无合同关联，无状态机，仅 CRUD）
-- - 挂单每被接取一次 → 创建一条独立 task + 扣 remaining_amount
-- - 老 tasks 表保留：原有 PUBLISHED 任务在迁移期内当作 listing 展示
--   （数据迁移脚本见 scripts/migrate-tasks-to-listings.sql）
--
-- 注：本文件只动 schema，不改老 tasks 表行。
-- 老 tasks 表的去 parent_task_id / 加 listing_id 列 见 007_tasks_listing_id.sql。

CREATE TABLE IF NOT EXISTS listings (
  id                     TEXT PRIMARY KEY,
  type                   TEXT NOT NULL CHECK (type IN ('BUY','SELL','SHIP')),
  commodity              TEXT NOT NULL,
  amount                 INTEGER NOT NULL CHECK (amount > 0),
  remaining_amount       INTEGER NOT NULL CHECK (remaining_amount >= 0),
  price                  REAL NOT NULL CHECK (price >= 0),
  currency               TEXT NOT NULL,
  location               TEXT,
  origin                 TEXT,
  destination            TEXT,
  publisher_id           TEXT NOT NULL REFERENCES users(id),
  publisher_username     TEXT NOT NULL,
  publisher_company_code TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'OPEN'
                         CHECK (status IN ('OPEN','CLOSED','CANCELLED','EXPIRED')),
  expires_at             TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_listings_commodity_status ON listings (commodity, status);
CREATE INDEX idx_listings_publisher_status ON listings (publisher_id, status);
CREATE INDEX idx_listings_status_expires ON listings (status, expires_at);
CREATE INDEX idx_listings_updated_at ON listings (updated_at);

CREATE TRIGGER IF NOT EXISTS trg_listings_touch_updated_at
  AFTER UPDATE ON listings
  FOR EACH ROW
  BEGIN
    UPDATE listings SET updated_at = datetime('now') WHERE id = OLD.id;
  END;