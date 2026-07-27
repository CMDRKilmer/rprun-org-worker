-- ============ migrate-pending-tasks-to-listings.sql ============
-- 阶段 4 数据迁移：把 tasks 表里 status='PUBLISHED' 的任务导出为 listings。
-- 这是 008 migration 之后补的"市场挂单可显示"补丁：
--   listings 表是 006 创建的，但生产没任务在里面；
--   老 task 表的 PUBLISHED 行需要复制成 listings 才会出现在 MarketView。
--
-- 规则：
--   - 单 item 任务 → 1 条 listing (id = 'migrated-<taskId>')
--   - 多 item 任务 → N 条 listing (id = 'migrated-<taskId>-<idx>')
--   - status 固定为 'OPEN'
--   - 老 task 行不删除、不修改（兼容期）
--   - 已 AWAITING_CONTRACT / IN_PROGRESS / COMPLETED 的不导出（不在市场上）
--
-- 注：以下数据来自 wrangler d1 execute 查询生产 tasks 表的快照。
--   created_at / updated_at 保持原值；amount/price 从 contract_json.items[0] 取。
--   publisher 信息保持原样（与 task 行一致）。

-- Task 1: b99f0109-4913-4875-8580-baf5c331c86b
--   SELL 900 COF @850 ICA @HRT
INSERT OR IGNORE INTO listings (
  id, type, commodity, amount, remaining_amount, price, currency,
  location, origin, destination,
  publisher_id, publisher_username, publisher_company_code,
  status, created_at, updated_at
) VALUES (
  'migrated-b99f0109-4913-4875-8580-baf5c331c86b',
  'SELL', 'COF', 900, 900, 850, 'ICA',
  'HRT', NULL, NULL,
  'fd29d172-75df-4e4a-8cbf-8cdc1edc67cd', 'lighroy', 'LIGH',
  'OPEN', '2026-07-23T10:29:36.408Z', '2026-07-24 07:57:49'
);

-- Task 2: 6c60e687-da91-4005-9e2f-79c30d01a69a-d-0
--   BUY 150 BGO @3000 ICA @HRT
INSERT OR IGNORE INTO listings (
  id, type, commodity, amount, remaining_amount, price, currency,
  location, origin, destination,
  publisher_id, publisher_username, publisher_company_code,
  status, created_at, updated_at
) VALUES (
  'migrated-6c60e687-da91-4005-9e2f-79c30d01a69a-d-0',
  'BUY', 'BGO', 150, 150, 3000, 'ICA',
  'HRT', NULL, NULL,
  'fc6e7be788ddfbf94ee68799c299c65c', 'KAMISAMA223', 'LHGP',
  'OPEN', '2026-07-24 06:53:44', '2026-07-26 06:58:25'
);

-- Task 3: 04a8cf81-38dd-4cea-a563-fdcea6b74221
--   SELL 3000 EPO @180 ICA @HRT
INSERT OR IGNORE INTO listings (
  id, type, commodity, amount, remaining_amount, price, currency,
  location, origin, destination,
  publisher_id, publisher_username, publisher_company_code,
  status, created_at, updated_at
) VALUES (
  'migrated-04a8cf81-38dd-4cea-a563-fdcea6b74221',
  'SELL', 'EPO', 3000, 3000, 180, 'ICA',
  'HRT', NULL, NULL,
  'fd29d172-75df-4e4a-8cbf-8cdc1edc67cd', 'lighroy', 'LIGH',
  'OPEN', '2026-07-24T09:23:24.325Z', '2026-07-24T09:23:24.325Z'
);

-- Task 4: 037129b4-1ace-40f3-92a9-2f85c4e618c6
--   BUY 100000 PE @12 ICA @HRT
INSERT OR IGNORE INTO listings (
  id, type, commodity, amount, remaining_amount, price, currency,
  location, origin, destination,
  publisher_id, publisher_username, publisher_company_code,
  status, created_at, updated_at
) VALUES (
  'migrated-037129b4-1ace-40f3-92a9-2f85c4e618c6',
  'BUY', 'PE', 100000, 100000, 12, 'ICA',
  'HRT', NULL, NULL,
  'fc6e7be788ddfbf94ee68799c299c65c', 'KAMISAMA223', 'LHGP',
  'OPEN', '2026-07-26T15:51:28.400Z', '2026-07-26T15:51:28.400Z'
);