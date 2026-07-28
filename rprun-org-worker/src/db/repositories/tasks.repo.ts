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
    // 「我的发布」：只看我是 publisher 的任务。
    //   阶段 2 不再有父子任务，partial claim 子任务已废弃；
    //   老 partial claim 子任务（parent_task_id 非空）保留但不出现在这里。
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
    // claimed：「我的接取」— 我是接取者（claimer_id = me）的任务。
    //   阶段 2 不再有 partial claim 反向子任务；
    //   老 partial claim 子任务保留但不出现在这里。
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

// 阶段 2：单条创建任务。解耦后挂单走 listings 端点，tasks 表只承载"合同关联"实体。
//   老 tasks 端点保留用于兼容老 partial claim 数据（与 listings 并行）。
//   contractJson 限制单 item：validation 层保证。
export async function createTask(
  db: D1Database,
  input: CreateTaskInput,
): Promise<OrgTask> {
  const now = new Date().toISOString();
  const id = generateId();
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
  const row = await findTaskRowById(db, id);
  if (!row) throw new Error(`Task creation failed: id ${id} not found after insert`);
  return mapTask(row);
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

// 阶段 2：partial claim 已废弃，父子任务路径删除。
//   裁剪接取走 listings 端点（见 listing-service.ts）。
//   下方保留 releaseTask / republishTask / deleteTask / setTaskStatus 等基本操作。
//
// 老架构 claimTask repo 已删除——接取走 /listings/:id/claim（见 listing-service.claimListing）。
// releaseTask 仍保留用于 /tasks/:id/release 老路径兜底（无 listing_id 的老 task）。

export async function releaseTask(db: D1Database, taskId: string): Promise<void> {
  // 释放后任务重新进入 PUBLISHED：重置 published_at 以便客户端"最新发布"排序
  // 同时清空 contract_id 与 contract_creator：合同已随发布者重新发布而失效，旧关联不应保留
  // （trigger trg_tasks_touch_updated_at 已自动更新 updated_at）
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks
       SET status = 'PUBLISHED',
           claimer_id = NULL, claimer_username = NULL, claimer_company_code = NULL,
           contract_id = NULL, contract_creator = NULL, claimed_at = NULL,
           published_at = ?
       WHERE id = ?`,
    )
    .bind(now, taskId)
    .run();
}

// 重新发布：CANCELLED → PUBLISHED。仅清空与取消无关的状态字段，
// contractJson / expiresAt 保留以便发布者直接编辑或重新发布。
// 若之后 patchTask 修改了内容，再发布等同于"重新发出"。
export async function republishTask(db: D1Database, taskId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks
       SET status = 'PUBLISHED',
           claimer_id = NULL, claimer_username = NULL, claimer_company_code = NULL,
           contract_id = NULL, contract_creator = NULL, claimed_at = NULL,
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

// 物理删除任务。task_notes 通过 FK ON DELETE CASCADE 自动清理；
// audit_logs 无 FK（target_id 是软引用），保留作为历史审计轨迹。
// 返回 rows affected（1 = 删成功，0 = 行不存在）。
export async function deleteTask(
  db: D1Database,
  taskId: string,
): Promise<number> {
  const result = await db.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
  return result.meta.changes ?? 0;
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
