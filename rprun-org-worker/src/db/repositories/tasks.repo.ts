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

// 部分接取：原任务 amount 缩到 (原 - claim) 后保持 PUBLISHED，给接取者创建反向子任务。
// 子任务 amount = claim，状态 AWAITING_CONTRACT，parent_task_id = 原任务 id。
// type 反转：父 BUY → 子 SELL（接取者要把货卖给发布者）；
//           父 SELL → 子 BUY（接取者要从发布者处买入）。
// SHIP/LOAN 不开放 partial claim（service 层拒绝）。
// 注意：原任务的 contract_json 不动（amount 仍是发布者定的原始值）。
//   子任务用全新的 contractJson（items.amount = claim）。
//   反向合同模板按子任务的 contractCreator 走（claimer 创建 → 'publisher'，
//   publisher 创建 → 'claimer'）。
export interface PartialClaimInput {
  parentTaskId: string;
  parentContractJson: TaskContractJson;
  parentType: 'BUY' | 'SELL';
  claimAmount: number;
  claimerId: string;
  claimerUsername: string;
  claimerCompanyCode: string;
  // 反向合同的 contractCreator：父 BUY 时由发布者创建反向合同（接取者卖货给发布者），
  // 父 SELL 时由接取者创建反向合同（接取者从发布者处买）。
  reverseContractCreator: 'publisher' | 'claimer';
}

export interface PartialClaimResult {
  parentUpdated: OrgTask;
  childCreated: OrgTask;
}

export async function partialClaimTask(
  db: D1Database,
  input: PartialClaimInput,
): Promise<PartialClaimResult> {
  // 1. 把原任务的 items.amount 缩到 (原 - claim)。但只在原 amount > claim 时缩；
  //    若恰好等于则 amount 已是 0，全部被接走 → 转 CANCELLED。
  const now = new Date().toISOString();
  const remainingItems = input.parentContractJson.items.map(item => {
    const remaining = item.amount - input.claimAmount;
    return { ...item, amount: remaining };
  });
  const allZero = remainingItems.every(i => i.amount === 0);
  const remainingContractJson: TaskContractJson = {
    ...input.parentContractJson,
    items: remainingItems,
  };
  if (allZero) {
    // 原任务被全部分完，状态转 CANCELLED（接走的部分由子任务承载反向合同）。
    await db
      .prepare(
        `UPDATE tasks
         SET status = 'CANCELLED',
             cancelled_at = ?,
             contract_json = ?
         WHERE id = ?`,
      )
      .bind(now, JSON.stringify(remainingContractJson), input.parentTaskId)
      .run();
  } else {
    // 部分接取：原任务保持 PUBLISHED，amount 缩到 remaining。
    await db
      .prepare(
        `UPDATE tasks
         SET contract_json = ?
         WHERE id = ?`,
      )
      .bind(JSON.stringify(remainingContractJson), input.parentTaskId)
      .run();
  }

  // 2. 给接取者创建反向子任务，状态 AWAITING_CONTRACT，parent_task_id 指回原任务。
  const childId = generateId();
  const reverseType: 'BUY' | 'SELL' =
    input.parentType === 'BUY' ? 'SELL' : 'BUY';
  // 子任务的 contractJson：继承原任务的 metadata（currency/location/...），
  // 反转 template、items.amount 改为 claim（反向合同 amount 必须 = claim）。
  const childContractJson: TaskContractJson = {
    ...input.parentContractJson,
    template: reverseType,
    items: input.parentContractJson.items.map(item => ({
      ...item,
      amount: input.claimAmount,
    })),
  };
  // 子任务模型：
  //   publisher_* = 接取者（他"创建"这条任务作为反向合同载体）
  //   claimer_* = NULL（子任务不是被接取的，没有"接取者"概念）
  //   contract_creator = reverseContractCreator（决定谁去 PrUn 签反向合同）
  //   parent_task_id = 原任务 ID
  // 反向合同约定：
  //   父 BUY：发布者想买入 → 接取者卖给他 → contract_creator = 'publisher'
  //     （子任务 publisher 是接取者，他作为 publisher 创建反向合同）
  //   父 SELL：发布者想卖出 → 接取者从他买 → contract_creator = 'claimer'
  //     （子任务 claimer 是原发布者，他作为 claimer 创建反向合同）
  await db
    .prepare(
      `INSERT INTO tasks (
         id, type, contract_json, status,
         publisher_id, publisher_username, publisher_company_code,
         contract_creator, parent_task_id,
         claimed_at, created_at, published_at, updated_at
       ) VALUES (?, ?, ?, 'AWAITING_CONTRACT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      childId,
      reverseType,
      JSON.stringify(childContractJson),
      input.claimerId,
      input.claimerUsername,
      input.claimerCompanyCode,
      input.reverseContractCreator,
      input.parentTaskId,
      now,
      now,
      now,
      now,
    )
    .run();

  const child = await findTaskById(db, childId);
  const parent = await findTaskRowById(db, input.parentTaskId);
  if (!child || !parent) throw new Error('partialClaimTask: parent or child vanished');
  return { parentUpdated: mapTask(parent), childCreated: child };
}

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

// 释放部分接取的反向子任务：删除子任务 + 把接走的 amount 加回原任务。
//   - 原任务 amount 恢复到 (remaining + childAmount) = 原始值
//   - 原子操作：先读父任务当前 amount，加 childAmount 后 update
//     （用 batch 让 D1 在一次请求里提交，避免金额错误）
//   - 子任务物理删除（task_notes 通过 FK CASCADE 自动清理）
//   - 父任务状态保持 PUBLISHED 不变（partial claim 后原任务本就在 PUBLISHED）
//
// 调用方负责业务校验（子任务确实存在、有 parent_task_id、调用者是 publisher）。
export interface ReleasePartialClaimResult {
  parentUpdated: OrgTask;
  childDeletedId: string;
}

export async function releasePartialClaimTask(
  db: D1Database,
  childTaskId: string,
): Promise<ReleasePartialClaimResult> {
  // 1. 读子任务
  const childRow = await findTaskRowById(db, childTaskId);
  if (!childRow) throw new Error('Child task not found');
  if (!childRow.parent_task_id) {
    throw new Error('Task has no parent; not a partial-claim child');
  }

  // 2. 读父任务当前 contract_json（amount 已被裁剪到 remaining）
  const parentRow = await findTaskRowById(db, childRow.parent_task_id);
  if (!parentRow) throw new Error('Parent task not found');
  let parentContract: TaskContractJson;
  try {
    parentContract = typeof parentRow.contract_json === 'string'
      ? (JSON.parse(parentRow.contract_json) as TaskContractJson)
      : (parentRow.contract_json as TaskContractJson);
  } catch {
    throw new Error('Parent task contract_json is corrupted');
  }
  let childContract: TaskContractJson;
  try {
    childContract = typeof childRow.contract_json === 'string'
      ? (JSON.parse(childRow.contract_json) as TaskContractJson)
      : (childRow.contract_json as TaskContractJson);
  } catch {
    throw new Error('Child task contract_json is corrupted');
  }

  // 3. 加回：父任务的 amount = remaining + childAmount = original
  //   - 假设父子任务的 items 顺序、commodity、price 都一致（partial claim 保证）。
  //   - 每个 item.amount += 对应 child item.amount。
  const restoredItems = parentContract.items.map((item, idx) => ({
    ...item,
    amount: item.amount + (childContract.items[idx]?.amount ?? 0),
  }));
  const restoredParentJson: TaskContractJson = {
    ...parentContract,
    items: restoredItems,
  };

  // 4. 原子更新：父任务 amount 还原 + 删除子任务
  const now = new Date().toISOString();
  // D1 batch 在同一连接里顺序执行；如果任一失败整体回滚（begin/commit 不支持，
  // 用 batch 内部失败也会终止后续 statements）
  const statements = [
    db
      .prepare('UPDATE tasks SET contract_json = ? WHERE id = ?')
      .bind(JSON.stringify(restoredParentJson), childRow.parent_task_id),
    db.prepare('DELETE FROM tasks WHERE id = ?').bind(childTaskId),
  ];
  await db.batch(statements);

  const updatedParent = await findTaskRowById(db, childRow.parent_task_id);
  if (!updatedParent) throw new Error('Parent task vanished after restore');
  return {
    parentUpdated: mapTask(updatedParent),
    childDeletedId: childTaskId,
  };
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
