// src/db/repositories/invite-codes.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapInviteCode, type InviteCodeRow } from '../mappers';
import type { InviteCode } from '../../types';
import { generateId } from '../../utils/id';
import { generateInviteCode } from '../../utils/invite-code';

export async function createInviteCodes(
  db: D1Database,
  count: number,
  createdBy: string,
): Promise<InviteCode[]> {
  const created: InviteCode[] = [];
  for (let i = 0; i < count; i++) {
    const id = generateId();
    const code = generateInviteCode();
    await db
      .prepare('INSERT INTO invite_codes (id, code, created_by) VALUES (?, ?, ?)')
      .bind(id, code, createdBy)
      .run();
    const row = await db
      .prepare('SELECT * FROM invite_codes WHERE id = ?')
      .bind(id)
      .first<InviteCodeRow>();
    if (row) {
      created.push(mapInviteCode(row));
    }
  }
  return created;
}

export async function listInviteCodes(db: D1Database): Promise<InviteCode[]> {
  const result = await db
    .prepare('SELECT * FROM invite_codes ORDER BY created_at DESC')
    .all<InviteCodeRow>();
  return (result.results ?? []).map(mapInviteCode);
}

export async function findInviteCodeById(db: D1Database, id: string): Promise<InviteCode | null> {
  const row = await db
    .prepare('SELECT * FROM invite_codes WHERE id = ?')
    .bind(id)
    .first<InviteCodeRow>();
  return row ? mapInviteCode(row) : null;
}

export async function revokeInviteCode(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE invite_codes SET revoked_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
}
