-- ============ cleanup-migrated-tasks.sql ============
-- 阶段 4 收尾清理：删除所有"已被 listings 表接管"的旧 task 行。
-- 架构迁移完成（006/007/008 + 数据迁移 + release 路径修复）后，
--   老 task 行只是历史残留，应清理以保持"我的发布/我的接取"视图干净。
--
-- 清理对象分类：
--   A) 老原始 PUBLISHED 挂单（已迁 listings）：直接 DELETE
--      - b99f0109 (SELL 900 COF lighroy) → migrated-b99f0109
--      - 04a8cf81 (SELL 3000 EPO lighroy) → migrated-04a8cf81
--      - 037129b4 (BUY 100000 PE KAMISAMA223) → migrated-037129b4
--
--   B) 孤儿子任务（task.listing_id 已迁 listings）：
--      - 先 UPDATE listings.remaining_amount += task.contract_json.items[0].amount
--        （让被部分接走的数量回到市场）
--      - 再 DELETE FROM tasks
--      - 子任务 55731007 + 1d803e6e + 2e983b5a → 累计 +3 到 migrated-037129b4
--      - 子任务 e4adb5a1 → +1 到 migrated-b99f0109
--
-- 注：claim 已被 lighroy 接走过 1 个（e4adb5a1），迁移后 remaining=899 是对的；
--    清理后应该恢复到 900。

-- A) 直接删除老原始挂单（已被 listing 接管）
DELETE FROM tasks WHERE id IN (
  'b99f0109-4913-4875-8580-baf5c331c86b',
  '04a8cf81-38dd-4cea-a563-fdcea6b74221',
  '037129b4-1ace-40f3-92a9-2f85c4e618c6'
);

-- B) 恢复 listing 剩余量（从孤儿子任务的 contract_json.items[0].amount 读）

-- 子任务 55731007（claim_seq=1, amount=1）→ migrated-037129b4 +1
UPDATE listings
SET remaining_amount = remaining_amount + 1
WHERE id = 'migrated-037129b4-1ace-40f3-92a9-2f85c4e618c6';
DELETE FROM tasks WHERE id = '55731007-4846-48f1-adee-72ca36747bd0';

-- 子任务 1d803e6e（claim_seq=2, amount=1）→ migrated-037129b4 +1
UPDATE listings
SET remaining_amount = remaining_amount + 1
WHERE id = 'migrated-037129b4-1ace-40f3-92a9-2f85c4e618c6';
DELETE FROM tasks WHERE id = '1d803e6e-e8ae-4e43-beaf-5a92c6676561';

-- 子任务 2e983b5a（claim_seq=3, amount=1）→ migrated-037129b4 +1
UPDATE listings
SET remaining_amount = remaining_amount + 1
WHERE id = 'migrated-037129b4-1ace-40f3-92a9-2f85c4e618c6';
DELETE FROM tasks WHERE id = '2e983b5a-f900-49d7-be0e-9803b10a4eaf';

-- 子任务 e4adb5a1（claim_seq=1, amount=1）→ migrated-b99f0109 +1
UPDATE listings
SET remaining_amount = remaining_amount + 1
WHERE id = 'migrated-b99f0109-4913-4875-8580-baf5c331c86b';
DELETE FROM tasks WHERE id = 'e4adb5a1-e644-4697-ae02-6cabf52caa58';