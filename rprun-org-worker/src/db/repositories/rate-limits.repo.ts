// src/db/repositories/rate-limits.repo.ts
import type { D1Database } from '@cloudflare/workers-types';

// 返回当前桶计数（自增后）
export async function incrementBucket(
  db: D1Database,
  bucketKey: string,
  windowSeconds: number,
): Promise<number> {
  const expiresAt = new Date(Date.now() + windowSeconds * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, count, expires_at)
       VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1`,
    )
    .bind(bucketKey, expiresAt)
    .run();
  const row = await db
    .prepare('SELECT count FROM rate_limit_buckets WHERE bucket_key = ?')
    .bind(bucketKey)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function cleanupExpiredBuckets(db: D1Database, now: string): Promise<number> {
  const result = await db
    .prepare('DELETE FROM rate_limit_buckets WHERE expires_at < ?')
    .bind(now)
    .run();
  return result.meta.changes ?? 0;
}

// Cron 用：删除已过期的桶（保留 1 小时便于审计）
export async function cleanupRateLimitBuckets(db: D1Database): Promise<void> {
  await db.prepare(
    `DELETE FROM rate_limit_buckets WHERE expires_at < datetime('now', '-1 hour')`,
  ).run();
}
