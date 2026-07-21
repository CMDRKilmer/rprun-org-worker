-- scripts/bootstrap-board.sql
-- 引导/重置第一个 BOARD 用户。幂等:每次跑前先清理依赖链
-- (refresh_tokens / tasks / audit_logs 引用 users)，避免 FK 失败。
--
-- 用法:修改下方 email / password_hash / prunUsername / companyCode 后执行:
--   pnpm exec wrangler d1 execute rprun-org-db --remote --file=scripts/bootstrap-board.sql

-- 1. 删依赖: refresh_tokens / audit_logs / tasks 引用 users
DELETE FROM refresh_tokens WHERE user_id IN (
  SELECT id FROM users WHERE prun_username = 'KAMISAMA223' AND company_code = 'LHGP'
);
DELETE FROM audit_logs WHERE actor_id IN (
  SELECT id FROM users WHERE prun_username = 'KAMISAMA223' AND company_code = 'LHGP'
);
DELETE FROM task_notes WHERE author_id IN (
  SELECT id FROM users WHERE prun_username = 'KAMISAMA223' AND company_code = 'LHGP'
);
UPDATE tasks SET claimer_id = NULL WHERE claimer_id IN (
  SELECT id FROM users WHERE prun_username = 'KAMISAMA223' AND company_code = 'LHGP'
);
DELETE FROM tasks WHERE publisher_id IN (
  SELECT id FROM users WHERE prun_username = 'KAMISAMA223' AND company_code = 'LHGP'
);

-- 2. 删 user (现在没引用了)
DELETE FROM users WHERE prun_username = 'KAMISAMA223' AND company_code = 'LHGP';

-- 3. 删 invite_code
DELETE FROM invite_codes WHERE created_by = 'bootstrap';

-- 4. 插入新的 invite_code
INSERT INTO invite_codes (id, code, created_by)
VALUES (
  lower(hex(randomblob(16))),
  upper(substr(replace(hex(randomblob(8)), '0', 'A'), 1, 10)),
  'bootstrap'
);

-- 5. 插入 BOARD 用户
INSERT INTO users (
  id, email, password_hash, prun_username, company_code,
  display_name, role, invite_code_id
) VALUES (
  lower(hex(randomblob(16))),
  'kilsa@run-org.local',
  'pbkdf2$100000$6dd2934127fd0aa038e6c0775e5515ed$a6b226da327e5dfb0dc7cb9e87a569d1831440141a2ba5fa5636816fb06d5384',
  'KAMISAMA223',
  'LHGP',
  'Admin',
  'BOARD',
  (SELECT id FROM invite_codes WHERE created_by = 'bootstrap' LIMIT 1)
);