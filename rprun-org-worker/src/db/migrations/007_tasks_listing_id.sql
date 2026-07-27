-- ============ 007_tasks_listing_id.sql ============
--
-- 阶段 1（listings 全栈上线，前端不动）：
--   只 ADD 列，不动现有 partial claim 父子结构。
--   保留 parent_task_id 列、partialClaimTask 等旧逻辑。
--
-- 阶段 2 才 DROP parent_task_id（待前端切到 listings 后再做）。
--
-- 改动：
--   - 新增 listing_id：标记 task 由哪个挂单接取产生（老任务为 NULL）
--   - 新增 claim_seq：同一挂单下接取序号（从 1 开始，老任务为 NULL）

-- 1. 新增 listing_id / claim_seq 列（老数据为 NULL）
ALTER TABLE tasks ADD COLUMN listing_id TEXT REFERENCES listings(id);
ALTER TABLE tasks ADD COLUMN claim_seq INTEGER;

-- 2. 新增 listing_id 索引
CREATE INDEX IF NOT EXISTS idx_tasks_listing_id ON tasks (listing_id);

-- 注：parent_task_id 列保留（阶段 2 才 drop）。
-- 注：partial claim 父子任务数据保留（阶段 2 才清理）。