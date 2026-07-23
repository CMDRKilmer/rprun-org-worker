-- ============ 003_cleanup_registered_extension_users.sql ============
--
-- 清理已经注册 ORG 的用户留在 extension_users 里的"非组织用户"脏数据。
-- 这些用户后续在 /board/users 列表里会被错误地显示成 NON_ORG（在线非组织用户）。
--
-- 仅删除那些在 users 表里有同 (prun_username, company_code) 记录的 extension_users 行。
-- 没有同主键的扩展用户保留（即真正未注册的 NON_ORG）。

DELETE FROM extension_users
WHERE EXISTS (
  SELECT 1 FROM users
  WHERE users.prun_username = extension_users.prun_username
    AND users.company_code  = extension_users.company_code
);