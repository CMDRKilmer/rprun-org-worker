// src/db/repositories/users.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapUser, type UserRow } from '../mappers';
import type { OrgUser, RegisteredUserRole } from '../../types';

export interface ExtendedOrgUser extends Omit<OrgUser, 'role'> {
  role: RegisteredUserRole | 'NON_ORG';
  // 最后活跃时间：注册用户用 last_login_at，未注册用 extension_users.last_seen_at。
  // 前端用此字段展示「最后活跃」，比 createdAt 更有用。
  lastSeenAt: string;
}

export async function findUserById(db: D1Database, id: string): Promise<OrgUser | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
}

export async function listAllUsers(db: D1Database): Promise<ExtendedOrgUser[]> {
  const orgUsers = await db.prepare('SELECT * FROM users ORDER BY created_at ASC').all<UserRow>();
  const orgUserMap = new Map<string, OrgUser>();
  for (const row of orgUsers.results ?? []) {
    const user = mapUser(row);
    orgUserMap.set(`${row.prun_username}:${row.company_code}`, user);
  }

  const extUsers = await db
    .prepare(`
      SELECT eu.* FROM extension_users eu
      LEFT JOIN users u ON eu.prun_username = u.prun_username AND eu.company_code = u.company_code
      WHERE u.id IS NULL
      ORDER BY eu.reported_at ASC
    `)
    .all<{ id: string; prun_username: string; company_code: string; display_name: string; reported_at: string; last_seen_at: string }>();

  const allUsers: ExtendedOrgUser[] = [];
  for (const orgUser of orgUserMap.values()) {
    allUsers.push({ ...orgUser, lastSeenAt: orgUser.lastLoginAt ?? orgUser.createdAt });
  }
  for (const ext of extUsers.results ?? []) {
    allUsers.push({
      id: ext.id,
      email: '',
      prunUsername: ext.prun_username,
      companyCode: ext.company_code,
      displayName: ext.display_name,
      role: 'NON_ORG',
      createdAt: ext.reported_at,
      lastSeenAt: (ext as { last_seen_at?: string }).last_seen_at ?? ext.reported_at,
    });
  }
  return allUsers.sort((a, b) => {
    const roleOrder: Record<string, number> = { BOARD: 0, COLLABORATOR: 1, NON_ORG: 2 };
    return (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
  });
}

export async function updateUserRole(
  db: D1Database,
  userId: string,
  role: RegisteredUserRole,
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
): Promise<{ boardCount: number; collaboratorCount: number; nonOrgUserCount: number; total: number }> {
  const [userCounts, extCount] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN role = 'BOARD' THEN 1 ELSE 0 END) AS boardCount,
           SUM(CASE WHEN role = 'COLLABORATOR' THEN 1 ELSE 0 END) AS collaboratorCount
         FROM users`,
      )
      .first<{ total: number; boardCount: number; collaboratorCount: number }>(),
    db
      .prepare(`
        SELECT COUNT(*) AS cnt FROM extension_users eu
        LEFT JOIN users u ON eu.prun_username = u.prun_username AND eu.company_code = u.company_code
        WHERE u.id IS NULL
      `)
      .first<{ cnt: number }>(),
  ]);
  const orgTotal = userCounts?.total ?? 0;
  const nonOrgCount = extCount?.cnt ?? 0;
  return {
    total: orgTotal + nonOrgCount,
    boardCount: userCounts?.boardCount ?? 0,
    collaboratorCount: userCounts?.collaboratorCount ?? 0,
    nonOrgUserCount: nonOrgCount,
  };
}
