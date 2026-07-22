// src/db/repositories/extension-users.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { generateId } from '../../utils/id';

export interface ExtensionUserRow {
  id: string;
  prun_username: string;
  company_code: string;
  display_name: string;
  reported_at: string;
  last_seen_at: string;
}

export async function upsertExtensionUser(
  db: D1Database,
  prunUsername: string,
  companyCode: string,
  displayName: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO extension_users
       (id, prun_username, company_code, display_name, reported_at, last_seen_at)
       VALUES (
         COALESCE((SELECT id FROM extension_users WHERE prun_username = ? AND company_code = ?), ?),
         ?, ?, ?,
         COALESCE((SELECT reported_at FROM extension_users WHERE prun_username = ? AND company_code = ?), datetime('now')),
         datetime('now')
       )`,
    )
    .bind(prunUsername, companyCode, generateId(), prunUsername, companyCode, displayName, prunUsername, companyCode)
    .run();
}

export async function countExtensionUsers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS cnt FROM extension_users').first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

export async function listExtensionUsers(db: D1Database): Promise<ExtensionUserRow[]> {
  const result = await db.prepare('SELECT * FROM extension_users ORDER BY reported_at ASC').all<ExtensionUserRow>();
  return result.results ?? [];
}
