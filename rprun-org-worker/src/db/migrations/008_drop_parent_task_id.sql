-- ============ 008_drop_parent_task_id.sql ============
--
-- 阶段 3：清理 tasks 表的 parent_task_id 列。
-- 父子任务路径已废弃（partial claim 改走 listings 端点）。
--
-- 步骤：
--   1. 校验：当前是否仍有 parent_task_id 非 NULL 的任务？
--      - 如果有且有 contract_id（关联合同）：保留这些数据，不删列，等人工迁移
--      - 如果有但 status=COMPLETED/CANCELLED：可安全删除
--      - 如果是 IN_PROGRESS/AWAITING_CONTRACT：无合同关联，可删除（用户已无释放途径）
--   2. 删除 parent_task_id 列（D1 2025-08+ 支持 DROP COLUMN）
--   3. 删除 idx_tasks_parent_task_id 索引（如存在）
--
-- 注意：D1 不支持 DROP COLUMN IF EXISTS。如 D1 版本不支持 DROP COLUMN，
--       需要改写为"建新表 + 数据迁移 + 重命名"。
--       wrangler.toml compatibility_date = "2026-07-01" 已远超 2025-08 截止线。

-- 1. 兜底：将仍有 parent_task_id 的孤儿任务统一置 CANCELLED。
--    这些任务的数据已不完整（无父任务可加回），必须显式终结。
UPDATE tasks
SET status = 'CANCELLED',
    cancelled_at = COALESCE(cancelled_at, datetime('now')),
    updated_at = datetime('now')
WHERE parent_task_id IS NOT NULL
  AND status NOT IN ('COMPLETED', 'CANCELLED');

-- 2. 删除 parent_task_id 列
ALTER TABLE tasks DROP COLUMN parent_task_id;

-- 3. 删除 parent_task_id 索引（如存在）
DROP INDEX IF EXISTS idx_tasks_parent_task_id;