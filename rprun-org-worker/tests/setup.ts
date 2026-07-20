// tests/setup.ts
// 用 Vite `?raw` import 读取 SQL（避免在 Workers 运行时用 node:fs）
// 注意：tests/setup.ts 同时被 vitest.config.ts 的 setupFiles 引用，
// 也被 integration.test.ts 显式 import。
import schemaSql from '../src/db/migrations/001_init.sql?raw';
import type { Env } from '../src/config';

export const SCHEMA_SQL = schemaSql;

// D1 的 prepare() 只能执行单条语句；db.exec() 可一次执行整个 schema
// （exec 会按 SQLite 规则正确处理 trigger 内部的 ; ）
// 注意：Miniflare 的 D1 exec 在某些版本会按行切分输入，多行 CREATE TABLE
// 会被截断为 "incomplete input"。把换行折叠为空格、压成单行后，exec 能
// 按 SQLite 规则切分语句（trigger 的 BEGIN/END 也能正确处理）。
export function formatSqlForExec(sql: string): string {
  // 移除单行注释（-- ... 至行尾），折叠为单行，避免 exec 按行误切
  return sql
    .split('\n')
    .map(line => line.replace(/--.*$/, '').trim())
    .filter(line => line.length > 0)
    .join(' ');
}

// 应用 schema 到测试 D1
export async function applySchema(env: Env): Promise<void> {
  await env.DB.exec(formatSqlForExec(SCHEMA_SQL));
}

// 清空所有表（每个测试前调用）
export async function truncateAll(env: Env): Promise<void> {
  const tables = ['users', 'invite_codes', 'refresh_tokens', 'tasks', 'task_notes', 'audit_logs', 'rate_limit_buckets'];
  for (const t of tables) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

// 直接插入一个 BOARD 用户（绕过注册流程，用于测试 boardOnly 路由）
// 注意：users.invite_code_id 为 NOT NULL UNIQUE（架构 §12.5），
// 所以必须先插一行 invite_codes 再引用其 id（即使该码不会被使用）
export async function seedBoardUser(env: Env, email = 'board@test.local'): Promise<{ id: string; email: string }> {
  const { hashPassword } = await import('../src/utils/password');
  const { generateInviteCode } = await import('../src/utils/invite-code');
  const passwordHash = await hashPassword('password123');
  const userId = crypto.randomUUID();
  const inviteId = crypto.randomUUID();
  // 生成一个不重复的码（10 位 base32），用于满足 users.invite_code_id 的外键/唯一约束
  const code = generateInviteCode();
  await env.DB.prepare(
    `INSERT INTO invite_codes (id, code, created_by) VALUES (?, ?, ?)`,
  ).bind(inviteId, code, userId).run();
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, prun_username, company_code, display_name, role, invite_code_id)
     VALUES (?, ?, ?, ?, ?, ?, 'BOARD', ?)`,
  ).bind(userId, email, passwordHash, 'board_user', 'BRC', 'Board User', inviteId).run();
  return { id: userId, email };
}
