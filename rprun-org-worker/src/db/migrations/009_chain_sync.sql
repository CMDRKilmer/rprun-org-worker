-- ============ 009_chain_sync.sql ============
-- 环线多端同步（XIT FLEET 产业链）：
-- 每个 PrUn 公司账号一份环线快照，前端跨浏览器/设备经 org-api 服务器同步。
-- - company_code 即命名空间（来自 JWT），多账号天然隔离、同账号跨设备共享。
-- - payload 为 JSON（前端 ChainSyncDoc：环线配置 + chainRuns + 环线 ACT 包/触发器）。
-- - updated_at 为整数毫秒时间戳；PUT 带 baseUpdatedAt 做乐观锁（CAS），
--   服务端已有更新时返回 409 + 最新快照，前端重新合并后再推。
-- - 行数据不敏感（无密钥），但必须按 company_code 隔离读写（路由层保证）。

CREATE TABLE IF NOT EXISTS chain_sync (
  company_code     TEXT PRIMARY KEY,
  payload          TEXT NOT NULL,
  payload_version  INTEGER NOT NULL DEFAULT 1,
  updated_at       INTEGER NOT NULL,
  updated_by       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chain_sync_updated_at ON chain_sync (updated_at);
