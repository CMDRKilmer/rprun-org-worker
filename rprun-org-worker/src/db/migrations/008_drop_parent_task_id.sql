-- ============ 008_drop_parent_task_id.sql ============
--
-- 阶段 3：清理 tasks 表的 parent_task_id 列。
-- 父子任务路径已废弃（partial claim 改走 listings 端点）。
--
-- 步骤（顺序很重要：SQLite 不允许 DROP COLUMN 时索引仍引用该列）：
--   1. 兜底：parent_task_id 非 NULL 且非终态 → 置 CANCELLED（数据兜底）
--   2. DROP INDEX idx_tasks_parent_task_id（先 drop 索引）
--   3. ALTER TABLE tasks DROP COLUMN parent_task_id
--
-- 注意：D1 2025-08+ 支持 DROP COLUMN。wrangler.toml compatibility_date = "2026-07-01"
--       已远超截止线。

-- 1. 兜底：将仍有 parent_task_id 的孤儿任务统一置 CANCELLED。
UPDATE tasks
SET status = 'CANCELLED',
    cancelled_at = COALESCE(cancelled_at, datetime('now')),
    updated_at = datetime('now')
WHERE parent_task_id IS NOT NULL
  AND status NOT IN ('COMPLETED', 'CANCELLED');

-- 2. 先 drop 索引（SQLite 限制：DROP COLUMN 之前必须先清掉引用该列的索引）
--    索引名由 005 migration 决定：idx_tasks_parent_task
DROP INDEX IF EXISTS idx_tasks_parent_task;

-- 3. 删除 parent_task_id 列
ALTER TABLE tasks DROP COLUMN parent_task_id;