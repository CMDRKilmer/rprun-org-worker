-- ============ 005_partial_claim_parent_task.sql ============
--
-- 为支持"裁剪接取量"（partial claim），tasks 表新增 parent_task_id 字段：
--   - 部分接取时，原任务 amount 缩到 (原 - claim)，状态保持 PUBLISHED
--     继续在市场上等别人接取。
--   - 给当前接取者创建一个反向子任务（type 反向，amount = claim），
--     状态 AWAITING_CONTRACT，parent_task_id 指回原任务。
--
-- 子任务的反向语义（用于反向合同）：
--   - 父 BUY（发布者想买入）→ 子 SELL（接取者要把货卖给发布者）
--   - 父 SELL（发布者想卖出）→ 子 BUY（接取者要从发布者处买入）
--   - 父 SHIP/LOAN：暂不开放 partial claim
--
-- parent_task_id 不强加 FK（避免 cascade 误删）；约定在 service 层
-- 保证引用有效。

ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;
CREATE INDEX idx_tasks_parent_task ON tasks (parent_task_id);