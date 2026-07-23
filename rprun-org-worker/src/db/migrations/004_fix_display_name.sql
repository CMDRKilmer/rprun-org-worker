-- ============ 004_fix_display_name.sql ============
--
-- 修复因 schema `DEFAULT prun_username` 被 SQLite/D1 解释为字符串字面量
-- 而被错误写入的 display_name = 'prun_username' 的历史用户记录。
--
-- 只把 display_name 仍然是字面 'prun_username' 的行修正为 prun_username；
-- 已经被手工覆盖的（如 Admin/display_name='Admin'）保持不动。

UPDATE users
SET display_name = prun_username
WHERE display_name = 'prun_username';