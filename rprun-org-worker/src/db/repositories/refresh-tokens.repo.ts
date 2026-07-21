// src/db/repositories/refresh-tokens.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { generateId } from '../../utils/id';

// 仅存 hash，不存明文；返回明文给客户端
export async function issueRefreshToken(
  db: D1Database,
  userId: string,
  ttlSeconds: number,
  hashFn: (token: string) => Promise<string>,
): Promise<{ token: string; expiresAt: string }> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const tokenHash = await hashFn(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await db
    .prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    )
    .bind(generateId(), userId, tokenHash, expiresAt)
    .run();
  return { token, expiresAt };
}

export async function findRefreshTokenByHash(
  db: D1Database,
  hash: string,
): Promise<{ id: string; userId: string; expiresAt: string; revokedAt: string | null } | null> {
  const row = await db
    .prepare('SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?')
    .bind(hash)
    .first<{ id: string; user_id: string; expires_at: string; revoked_at: string | null }>();
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export async function revokeRefreshToken(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
}
