// src/db/repositories/audit-logs.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapAuditLog, type AuditLogRow } from '../mappers';
import type { AuditLog } from '../../types';
import { generateId } from '../../utils/id';

export interface WriteAuditInput {
  actorType: 'user' | 'admin' | 'system';
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(db: D1Database, input: WriteAuditInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      generateId(),
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    )
    .run();
}

export interface ListAuditLogsFilter {
  limit?: number;
  cursor?: string;
  action?: string;
  actorId?: string;
}

export interface ListAuditLogsResult {
  items: AuditLog[];
  nextCursor: string | null;
}

// cursor = base64(JSON.stringify({ ts: ISO, id: logId }))
// 配合 ORDER BY created_at DESC, id DESC 做 keyset 分页
function decodeAuditCursor(cursor: string): { ts: string; id: string } | null {
  try {
    const json = atob(cursor);
    const parsed = JSON.parse(json);
    if (typeof parsed.ts === 'string' && typeof parsed.id === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeAuditCursor(ts: string, id: string): string {
  return btoa(JSON.stringify({ ts, id }));
}

export async function listAuditLogs(
  db: D1Database,
  filter: ListAuditLogsFilter,
): Promise<ListAuditLogsResult> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.action) {
    where.push('action = ?');
    binds.push(filter.action);
  }
  if (filter.actorId) {
    where.push('actor_id = ?');
    binds.push(filter.actorId);
  }
  if (filter.cursor) {
    const c = decodeAuditCursor(filter.cursor);
    if (c) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      binds.push(c.ts, c.ts, c.id);
    }
  }
  const limit = filter.limit ?? 100;
  binds.push(limit + 1);
  const sql = `SELECT * FROM audit_logs ${
    where.length ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY created_at DESC, id DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...binds).all<AuditLogRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeAuditCursor(last.created_at, last.id) : null;
  return { items: items.map(mapAuditLog), nextCursor };
}
