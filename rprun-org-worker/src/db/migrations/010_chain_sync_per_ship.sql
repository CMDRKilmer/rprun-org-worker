-- ============ 010_chain_sync_per_ship.sql ============
-- chain_sync 改为按船存储：(company_code, ship_id) 复合主键。
-- 每艘船的环线快照独立同步、互不覆盖（009 为整包存储，任一变会整体覆盖）。
-- ship_id 可传任意字符串：实际船 id 存运行状态；'__config__' 存环线面板全局配置。
-- 注：旧 009 整包行无法精确拆分（actionPackages/triggers 为多船混合），
-- 直接重建（DROP + CREATE）。功能刚上线，客户端重新上传即可。

DROP TABLE IF EXISTS chain_sync;

CREATE TABLE chain_sync (
  company_code     TEXT NOT NULL,
  ship_id          TEXT NOT NULL,
  payload          TEXT NOT NULL,
  payload_version  INTEGER NOT NULL DEFAULT 1,
  updated_at       INTEGER NOT NULL,
  updated_by       TEXT NOT NULL,
  PRIMARY KEY (company_code, ship_id)
);

CREATE INDEX IF NOT EXISTS idx_chain_sync_company_updated ON chain_sync (company_code, updated_at);
