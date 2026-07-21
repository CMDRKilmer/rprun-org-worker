// src/db/repositories/users.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapUser, type UserRow } from '../mappers';
import type { OrgUser, UserRole } from '../../types';

export async function findUserById(db: D1Database, id: string): Promise<OrgUser | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
}

export async function listAllUsers(db: D1Database): Promise<OrgUser[]> {
  const result = await db.prepare('SELECT * FROM users ORDER BY created_at ASC').all<UserRow>();
  return (result.results ?? []).map(mapUser);
}

export async function updateUserRole(
  db: D1Database,
  userId: string,
  role: UserRole,
): Promise<void> {
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run();
}

export async function touchUserLogin(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?")
    .bind(userId)
    .run();
}

export async function countUsersByRole(
  db: D1Database,
): Promise<{ boardCount: number; collaboratorCount: number; total: number }> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN role = 'BOARD' THEN 1 ELSE 0 END) AS boardCount,
         SUM(CASE WHEN role = 'COLLABORATOR' THEN 1 ELSE 0 END) AS collaboratorCount
       FROM users`,
    )
    .first<{ total: number; boardCount: number; collaboratorCount: number }>();
  return {
    total: row?.total ?? 0,
    boardCount: row?.boardCount ?? 0,
    collaboratorCount: row?.collaboratorCount ?? 0,
  };
}
