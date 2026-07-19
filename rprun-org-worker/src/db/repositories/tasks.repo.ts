// src/db/repositories/tasks.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapTask, type TaskRow } from '../mappers';
import type { OrgTask, TaskContractJson, TaskType, PollScope } from '../../types';
import { generateId } from '../../utils/id';

export interface ListTasksFilter {
  scope: PollScope;
  userId: string;
  type?: TaskType;
  publisherUsername?: string;
  claimerUsername?: string;
  location?: string;
  since?: string;
  limit?: number;
  cursor?: string;
}

export interface ListTasksResult {
  items: OrgTask[];
  nextCursor: string | null;
}

// cursor = base64(JSON.stringify({ ts: ISO, id: taskId }))
// 配合 ORDER BY updated_at DESC, id DESC 做 keyset 分页
function decodeCursor(cursor: string): { ts: string; id: string } | null {
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

function encodeCursor(ts: string, id: string): string {
  return btoa(JSON.stringify({ ts, id }));
}

export async function listTasks(
  db: D1Database,
  filter: ListTasksFilter,
): Promise<ListTasksResult> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (filter.scope === 'board') {
    where.push("status = 'PUBLISHED'");
    if (filter.type) {
      where.push('type = ?');
      binds.push(filter.type);
    }
    if (filter.publisherUsername) {
      where.push('publisher_username = ?');
      binds.push(filter.publisherUsername);
    }
    if (filter.claimerUsername) {
      where.push('claimer_username = ?');
      binds.push(filter.claimerUsername);
    }
    if (filter.location) {
      where.push('contract_json LIKE ?');
      binds.push(`%"location":"${filter.location}"%`);
    }
  } else if (filter.scope === 'published') {
    where.push('publisher_id = ?');
    binds.push(filter.userId);
    if (filter.type) {
      where.push('type = ?');
      binds.push(filter.type);
    }
    if (filter.claimerUsername) {
      where.push('claimer_username = ?');
      binds.push(filter.claimerUsername);
    }
  } else {
    // claimed：按当前用户过滤
    where.push('claimer_id = ?');
    binds.push(filter.userId);
  }

  if (filter.since) {
    where.push('updated_at > ?');
    binds.push(filter.since);
  }

  // cursor 分页：取 (updated_at, id) 在 cursor 之前的记录
  if (filter.cursor) {
    const c = decodeCursor(filter.cursor);
    if (c) {
      where.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
      binds.push(c.ts, c.ts, c.id);
    }
  }

  const limit = filter.limit ?? 100;
  // 多取 1 条用于判断是否还有下一页
  binds.push(limit + 1);

  const sql = `SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...binds).all<TaskRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.updated_at, last.id) : null;
  return { items: items.map(mapTask), nextCursor };
}

export async function findTaskById(db: D1Database, id: string): Promise<OrgTask | null> {
  const row = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  return row ? mapTask(row) : null;
}

export async function findTaskRowById(db: D1Database, id: string): Promise<TaskRow | null> {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
}

export interface CreateTaskInput {
  type: TaskType;
  contractJson: TaskContractJson;
  publisherId: string;
  publisherUsername: string;
  publisherCompanyCode: string;
  expiresAt?: string;
}

export async function createTask(db: D1Database, input: CreateTaskInput): Promise<OrgTask> {
  const id = generateId();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tasks (
         id, type, contract_json, status,
         publisher_id, publisher_username, publisher_company_code,
         expires_at, created_at, published_at, updated_at
       ) VALUES (?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.type,
      JSON.stringify(input.contractJson),
      input.publisherId,
      input.publisherUsername,
      input.publisherCompanyCode,
      input.expiresAt ?? null,
      now,
      now,
      now,
    )
    .run();
  const task = await findTaskById(db, id);
  if (!task) throw new Error('Task creation failed: row not found after insert');
  return task;
}

export async function updateTaskContractJson(
  db: D1Database,
  taskId: string,
  contractJson: TaskContractJson,
  expiresAt?: string | null,
): Promise<void> {
  if (expiresAt !== undefined) {
    await db
      .prepare('UPDATE tasks SET contract_json = ?, expires_at = ? WHERE id = ?')
      .bind(JSON.stringify(contractJson), expiresAt, taskId)
      .run();
  } else {
    await db
      .prepare('UPDATE tasks SET contract_json = ? WHERE id = ?')
      .bind(JSON.stringify(contractJson), taskId)
      .run();
  }
}

export async function claimTask(
  db: D1Database,
  taskId: string,
  claimerId: string,
  claimerUsername: string,
  claimerCompanyCode: string,
  contractCreator: 'publisher' | 'claimer',
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks
       SET status = 'AWAITING_CONTRACT',
           claimer_id = ?, claimer_username = ?, claimer_company_code = ?,
           contract_creator = ?, claimed_at = ?
       WHERE id = ?`,
    )
    .bind(claimerId, claimerUsername, claimerCompanyCode, contractCreator, now, taskId)
    .run();
}

export async function releaseTask(db: D1Database, taskId: string): Promise<void> {
  // 释放后任务重新进入 PUBLISHED：重置 published_at 以便客户端"最新发布"排序
  // （trigger trg_tasks_touch_updated_at 已自动更新 updated_at）
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks
       SET status = 'PUBLISHED',
           claimer_id = NULL, claimer_username = NULL, claimer_company_code = NULL,
           contract_creator = NULL, claimed_at = NULL,
           published_at = ?
       WHERE id = ?`,
    )
    .bind(now, taskId)
    .run();
}

export async function linkContract(
  db: D1Database,
  taskId: string,
  contractId: string,
  contractCreator: 'publisher' | 'claimer',
): Promise<void> {
  await db
    .prepare('UPDATE tasks SET contract_id = ?, contract_creator = ? WHERE id = ?')
    .bind(contractId, contractCreator, taskId)
    .run();
}

export async function setTaskStatus(
  db: D1Database,
  taskId: string,
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
): Promise<void> {
  const now = new Date().toISOString();
  const fieldMap = {
    IN_PROGRESS: 'in_progress_at',
    COMPLETED: 'completed_at',
    CANCELLED: 'cancelled_at',
  } as const;
  await db
    .prepare(
      `UPDATE tasks SET status = ?, ${fieldMap[status]} = ? WHERE id = ?`,
    )
    .bind(status, now, taskId)
    .run();
}

export async function countTasksByStatus(
  db: D1Database,
): Promise<Record<string, number>> {
  const result = await db
    .prepare('SELECT status, COUNT(*) AS count FROM tasks GROUP BY status')
    .all<{ status: string; count: number }>();
  const map: Record<string, number> = {};
  for (const row of result.results ?? []) {
    map[row.status] = row.count;
  }
  return map;
}

export async function countAllTasks(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM tasks').first<{ count: number }>();
  return row?.count ?? 0;
}

// Cron Trigger 用：清理过期 PUBLISHED 任务
export async function expirePublishedTasks(db: D1Database, now: string): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE tasks
       SET status = 'CANCELLED', cancelled_at = ?
       WHERE status = 'PUBLISHED' AND expires_at IS NOT NULL AND expires_at < ?`,
    )
    .bind(now, now)
    .run();
  return result.meta.changes ?? 0;
}
