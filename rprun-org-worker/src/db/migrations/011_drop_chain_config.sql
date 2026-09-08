-- ============ 011_drop_chain_config.sql ============
-- 前端 rprun 已停用「环线面板全局配置」云同步（只按船同步），
-- 后端不再需要为每公司维护一份 '__config__' 快照。
-- 清理历史遗留的 '__config__' 行（每公司至多一条；删除幂等，可重复执行）。
-- 注意：wrangler d1 execute 不支持 BEGIN TRANSACTION，本文件为单条独立语句。

DELETE FROM chain_sync WHERE ship_id = '__config__';
