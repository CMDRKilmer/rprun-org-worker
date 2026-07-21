// src/services/task-service.ts
import type { Env } from '../config';
import type {
  OrgTask, TaskContractJson, TaskStatus, TaskType, ContractCreator,
} from '../types';
import { badRequest, forbidden, notFound, HttpError } from '../utils/http-error';
import { mapTask } from '../db/mappers';
import {
  claimTask as repoClaimTask,
  createTask as repoCreateTask,
  deleteTask as repoDeleteTask,
  findTaskRowById,
  linkContract as repoLinkContract,
  releaseTask as repoReleaseTask,
  setTaskStatus,
  updateTaskContractJson,
  type CreateTaskInput,
} from '../db/repositories/tasks.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PUBLISHED: ['AWAITING_CONTRACT', 'CANCELLED'],
  AWAITING_CONTRACT: ['IN_PROGRESS', 'PUBLISHED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface CreateTaskParams {
  type: TaskType;
  contractJson: TaskContractJson;
  expiresAt?: string;
}

export async function createTask(
  env: Env,
  userId: string,
  prunUsername: string,
  companyCode: string,
  params: CreateTaskParams,
): Promise<OrgTask> {
  const input: CreateTaskInput = {
    type: params.type,
    contractJson: params.contractJson,
    publisherId: userId,
    publisherUsername: prunUsername,
    publisherCompanyCode: companyCode,
    expiresAt: params.expiresAt,
  };
  const task = await repoCreateTask(env.DB, input);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.create',
    targetType: 'task',
    targetId: task.id,
    metadata: { type: task.type, status: task.status },
  });
  return task;
}

export async function patchTask(
  env: Env,
  taskId: string,
  userId: string,
  updates: { contractJson?: TaskContractJson; expiresAt?: string | null },
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.publisher_id !== userId) {
    throw forbidden('Only the publisher can edit');
  }
  if (row.status !== 'PUBLISHED') {
    throw badRequest('INVALID_TRANSITION', 'Can only edit PUBLISHED tasks');
  }
  // expiresAt 处理三态：
  //   - undefined：不更新
  //   - null：显式清空（置 NULL）
  //   - string：更新为 ISO 时间
  // contractJson 与 expiresAt 可独立或同时更新；同时更新时一并传入。
  if (updates.contractJson) {
    await updateTaskContractJson(
      env.DB,
      taskId,
      updates.contractJson,
      updates.expiresAt === undefined ? undefined : updates.expiresAt,
    );
  } else if (updates.expiresAt !== undefined) {
    await env.DB
      .prepare('UPDATE tasks SET expires_at = ? WHERE id = ?')
      .bind(updates.expiresAt, taskId)
      .run();
  }
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.patch',
    targetType: 'task',
    targetId: taskId,
    metadata: {
      has_contract_json: !!updates.contractJson,
      expiresAt: updates.expiresAt === undefined ? undefined : updates.expiresAt === null ? 'null' : 'set',
    },
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after update');
  return mapTask(updated);
}

// 列表查询：从 tasks.repo 转发到 service 层，便于未来加业务过滤或权限裁剪
// 注意：'published' 与 'claimed' scope 会强制按当前 userId 过滤
export async function listTasksForUser(
  env: Env,
  userId: string,
  filter: {
    scope: 'board' | 'published' | 'claimed';
    type?: string;
    publisherUsername?: string;
    claimerUsername?: string;
    location?: string;
    since?: string;
    limit?: number;
    cursor?: string;
  },
): Promise<{ items: OrgTask[]; nextCursor: string | null }> {
  const { listTasks } = await import('../db/repositories/tasks.repo');
  // 'published' / 'claimed' scope 隐含按当前用户过滤；'board' scope 不带 userId 限制
  return listTasks(env.DB, {
    scope: filter.scope,
    userId,
    type: filter.type as never,
    publisherUsername: filter.publisherUsername,
    claimerUsername: filter.claimerUsername,
    location: filter.location,
    since: filter.since,
    limit: filter.limit,
    cursor: filter.cursor,
  });
}

export async function claimTask(
  env: Env,
  taskId: string,
  userId: string,
  prunUsername: string,
  companyCode: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.status !== 'PUBLISHED') {
    throw badRequest('INVALID_TRANSITION', `Cannot claim task in ${row.status} state`);
  }
  if (row.publisher_id === userId) {
    throw badRequest('CANNOT_CLAIM_OWN', 'Cannot claim your own task');
  }
  // 默认接取者创建合同（除非任务类型为 SHIP，则由发布者创建）
  const contractCreator: ContractCreator = row.type === 'SHIP' ? 'publisher' : 'claimer';
  await repoClaimTask(env.DB, taskId, userId, prunUsername, companyCode, contractCreator);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.claim',
    targetType: 'task',
    targetId: taskId,
    metadata: { contract_creator: contractCreator },
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after claim');
  return mapTask(updated);
}

export async function releaseTask(
  env: Env,
  taskId: string,
  userId: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.claimer_id !== userId) {
    throw forbidden('Only the claimer can release');
  }
  if (!canTransition(row.status, 'PUBLISHED')) {
    throw badRequest('INVALID_TRANSITION', `Cannot release from ${row.status}`);
  }
  await repoReleaseTask(env.DB, taskId);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.release',
    targetType: 'task',
    targetId: taskId,
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after release');
  return mapTask(updated);
}

export async function cancelTask(
  env: Env,
  taskId: string,
  userId: string,
  userRole: 'BOARD' | 'COLLABORATOR',
  reason?: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');

  const isPublisher = row.publisher_id === userId;
  const isBoard = userRole === 'BOARD';
  if (!isPublisher && !isBoard) {
    throw forbidden('NOT_AUTHORIZED_TO_CANCEL');
  }
  if (isBoard && !isPublisher && !reason) {
    throw badRequest('REASON_REQUIRED_FOR_BOARD_CANCEL', 'Reason required for board cancel');
  }
  if (!canTransition(row.status, 'CANCELLED')) {
    throw badRequest('INVALID_TRANSITION', `Cannot cancel from ${row.status}`);
  }
  await setTaskStatus(env.DB, taskId, 'CANCELLED');
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: isBoard && !isPublisher ? 'task.cancel_by_board' : 'task.cancel',
    targetType: 'task',
    targetId: taskId,
    metadata: { reason, by_board: isBoard && !isPublisher },
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after cancel');
  return mapTask(updated);
}

export async function linkContract(
  env: Env,
  taskId: string,
  userId: string,
  contractId: string,
  contractCreator: ContractCreator,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.publisher_id !== userId && row.claimer_id !== userId) {
    throw forbidden('NOT_TASK_PARTY');
  }
  if (row.status !== 'AWAITING_CONTRACT') {
    throw badRequest('INVALID_TRANSITION', `Cannot link contract in ${row.status} state`);
  }
  if (row.contract_id) {
    throw badRequest('CONTRACT_ALREADY_LINKED', 'Contract already linked');
  }
  await repoLinkContract(env.DB, taskId, contractId, contractCreator);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.link_contract',
    targetType: 'task',
    targetId: taskId,
    metadata: { contract_id: contractId, contract_creator: contractCreator },
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after link');
  return mapTask(updated);
}

// 物理删除任务：仅 publisher 自己能删除自己发布的任务。
// BOARD 不允许代删（取消他人任务已提供同等能力，删除是更强操作，需 owner 显式授权）。
// 返回删除前的快照（便于返回给客户端展示"已删除 ... 任务"等）。
export async function deleteTaskForPublisher(
  env: Env,
  taskId: string,
  userId: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.publisher_id !== userId) {
    throw forbidden('NOT_PUBLISHER');
  }
  // 先写审计（删除事件本身），再删主表。即使主表 DELETE 失败，审计记录在，
  // 便于后续运营/排障。
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.delete',
    targetType: 'task',
    targetId: taskId,
    metadata: {
      type: row.type,
      status: row.status,
      had_contract: !!row.contract_id,
      had_claimer: !!row.claimer_id,
    },
  });
  const snapshot = mapTask(row);
  const affected = await repoDeleteTask(env.DB, taskId);
  if (affected !== 1) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Task vanished during delete');
  }
  return snapshot;
}

// 隔离校验：所有读取任务详情的请求都先校验参与方身份
// PUBLISHED 任务对所有人可见；其他状态仅参与方可见
export async function getTaskForUser(
  env: Env,
  taskId: string,
  userId: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (
    row.status !== 'PUBLISHED' &&
    row.publisher_id !== userId &&
    row.claimer_id !== userId
  ) {
    throw forbidden('NOT_TASK_PARTY');
  }
  return mapTask(row);
}

// Cron Trigger 用：把过期 PUBLISHED/AWAITING_CONTRACT 任务标记 CANCELLED
export async function cleanupExpiredTasks(env: Env): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE tasks
     SET status = 'CANCELLED',
         cancelled_at = datetime('now'),
         updated_at = datetime('now')
     WHERE expires_at IS NOT NULL
       AND expires_at < datetime('now')
       AND status IN ('PUBLISHED', 'AWAITING_CONTRACT')`,
  ).run();
  if (result.meta.changes > 0) {
    await writeAuditLog(env.DB, {
      actorType: 'system',
      actorId: undefined,
      action: 'task.cleanup_expired',
      targetType: 'task',
      targetId: undefined,
      metadata: { count: result.meta.changes },
    });
  }
}
