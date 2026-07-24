-- 数据迁移：把现有多物品任务拆解成单物品任务。
--
-- 设计：
--   1. 对每条多物品任务，为每个 item 创建一条新的单物品任务。
--      新任务保留 publisher / type / currency / location / deadline / expires_at 等元数据。
--   2. 旧任务标 CANCELLED + cancelled_at（仅当当前还是 PUBLISHED）。
--      这样市场上只显示拆解后的单物品任务；旧任务作为审计追溯保留。
--   3. 旧任务的 contract_json 加 _decomposed_into 字段列出新任务 id。
--
-- D1 SQLite 限制：compound SELECT ≤ 4。用嵌套 CTE（a: 0..3, b: 0..1）做笛卡尔积
-- 提供 0..7 的 idx 序列。

-- Step 1: 给旧任务写 _decomposed_into 占位
UPDATE tasks
SET contract_json = json_set(contract_json, '$._decomposed_into', json_array())
WHERE status = 'PUBLISHED'
  AND json_array_length(contract_json, '$.items') > 1;

-- Step 2: 展开并插入新任务
WITH a AS (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3),
     b AS (SELECT 0 AS n UNION ALL SELECT 1)
INSERT INTO tasks (
  id, type, contract_json, status,
  publisher_id, publisher_username, publisher_company_code,
  expires_at, created_at, published_at, updated_at
)
SELECT
  t.id || '-d-' || (a.n * 2 + b.n) AS new_id,
  t.type,
  json_object(
    'template', json_extract(t.contract_json, '$.template'),
    'currency', json_extract(t.contract_json, '$.currency'),
    'name',     json_extract(t.contract_json, '$.name'),
    'location', json_extract(t.contract_json, '$.location'),
    'deadline', json_extract(t.contract_json, '$.deadline'),
    'items',    json_array(json_extract(t.contract_json, '$.items[' || (a.n * 2 + b.n) || ']'))
  ) AS new_contract_json,
  'PUBLISHED',
  t.publisher_id,
  t.publisher_username,
  t.publisher_company_code,
  t.expires_at,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM tasks t, a, b
WHERE t.status = 'PUBLISHED'
  AND json_array_length(t.contract_json, '$.items') > 1
  AND (a.n * 2 + b.n) < json_array_length(t.contract_json, '$.items');

-- Step 3: 把新任务 id 填进旧任务的 _decomposed_into 数组
UPDATE tasks
SET contract_json = json_set(
  contract_json,
  '$._decomposed_into',
  COALESCE(
    (
      SELECT json_group_array(t2.id)
      FROM tasks t2
      WHERE t2.id LIKE (tasks.id || '-d-%')
    ),
    json_array()
  )
)
WHERE status = 'PUBLISHED'
  AND json_array_length(contract_json, '$.items') > 1;

-- Step 4: 旧任务置 CANCELLED
UPDATE tasks
SET
  status = 'CANCELLED',
  cancelled_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
WHERE status = 'PUBLISHED'
  AND json_array_length(contract_json, '$.items') > 1;

-- Step 5: 验证
SELECT
  COUNT(*) AS remaining_multi_item_published,
  (SELECT COUNT(*) FROM tasks WHERE id LIKE '%-d-%' AND status = 'PUBLISHED') AS decomposed_tasks
FROM tasks
WHERE status = 'PUBLISHED'
  AND json_array_length(contract_json, '$.items') > 1;