// src/services/task-service.ts
import type { Env } from '../config';
import type {
  OrgTask, TaskContractJson, TaskStatus, TaskType, ContractCreator,
} from '../types';
import { badRequest, forbidden, notFound, HttpError } from '../utils/http-error';
import { mapTask } from '../db/mappers';
import {
  claimTask as repoClaimTask,
  createTasks as repoCreateTasks,
  deleteTask as repoDeleteTask,
  findTaskRowById,
  linkContract as repoLinkContract,
  partialClaimTask as repoPartialClaimTask,
  releasePartialClaimTask as repoReleasePartialClaimTask,
  releaseTask as repoReleaseTask,
  republishTask as repoRepublishTask,
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

// 多物品任务拆解：
//   发布任务时如果 contractJson.items 包含多个物品，每个物品会被拆成独立的单物品任务。
//   这样 partial claim 逻辑可以正常套用（每个任务只有 1 个 item.amount）。
//   拆解后所有子任务共享 currency / location / template / publisher / expiresAt 等元数据。
//   返回值是拆解后的第一条任务（前端可用它 navigate，但 MarketView 拉列表会看到全部）。
export async function createTask(
  env: Env,
  userId: string,
  prunUsername: string,
  companyCode: string,
  params: CreateTaskParams,
): Promise<OrgTask> {
  const baseInput = {
    type: params.type,
    publisherId: userId,
    publisherUsername: prunUsername,
    publisherCompanyCode: companyCode,
    expiresAt: params.expiresAt,
  };

  // 把 items 拆成多条 CreateTaskInput；非 items 字段保持不变。
  const inputs: CreateTaskInput[] = params.contractJson.items.map(item => ({
    ...baseInput,
    contractJson: {
      ...params.contractJson,
      items: [item],
    },
  }));

  // 单一物品的常见情况：用单条 INSERT 路径避免 batch 开销——但 batch 也只是
  // 一次网络往返，性能差异不大。统一走批量接口保持逻辑简单。
  const tasks = await repoCreateTasks(env.DB, inputs);

  // 每条任务都写一条 audit log，便于排查"这次发布对应几条挂单"。
  for (const task of tasks) {
    await writeAuditLog(env.DB, {
      actorType: 'user',
      actorId: userId,
      action: 'task.create',
      targetType: 'task',
      targetId: task.id,
      metadata: {
        type: task.type,
        status: task.status,
        split_from_multi_item: tasks.length > 1,
        split_total: tasks.length,
      },
    });
  }
  // 返回第一条，前端可用来 navigate / 展示 toast
  return tasks[0];
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
  // 允许 PUBLISHED 或 CANCELLED 编辑：CANCELLED 状态下允许 publisher 编辑后重新发布。
  // 其他状态（AWAITING_CONTRACT / IN_PROGRESS / COMPLETED）禁止修改合同。
  if (row.status !== 'PUBLISHED' && row.status !== 'CANCELLED') {
    throw badRequest('INVALID_TRANSITION', 'Can only edit PUBLISHED or CANCELLED tasks');
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

export interface ClaimTaskResult {
  task: OrgTask;
  // 部分接取时，原任务保留 PUBLISHED 同时返回一个反向子任务（AWAITING_CONTRACT）。
  // 完整接取时 childTask 为 undefined。
  childTask?: OrgTask;
}

export async function claimTask(
  env: Env,
  taskId: string,
  userId: string,
  prunUsername: string,
  companyCode: string,
  // 可选：裁剪接取量。
  // - 不传或 null：完整接取（旧行为），原任务 → AWAITING_CONTRACT
  // - 传 N 且 N < 任一 item.amount：partial claim，原任务保留 PUBLISHED
  //   （amount 缩到剩余），并创建一个反向子任务 AWAITING_CONTRACT 给当前接取者
  // - 传 N 且 N 等于所有 item.amount：等价于"完整接取最后一份"
  claimAmount?: number | null,
): Promise<ClaimTaskResult> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.status !== 'PUBLISHED') {
    throw badRequest('INVALID_TRANSITION', `Cannot claim task in ${row.status} state`);
  }
  if (row.publisher_id === userId) {
    throw badRequest('CANNOT_CLAIM_OWN', 'Cannot claim your own task');
  }

  // 解析 contractJson：row.contract_json 在 schema 是 TEXT，但 mappers 在读取时已经
  // 做过 JSON.parse，所以这里 row.contract_json 是字符串（mappers 取的是 row），
  // 重新解析一次。
  let parentContract: TaskContractJson;
  try {
    parentContract = typeof row.contract_json === 'string'
      ? (JSON.parse(row.contract_json) as TaskContractJson)
      : (row.contract_json as TaskContractJson);
  } catch {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Task contract_json is corrupted');
  }

  // 校验裁剪量（如提供）
  let normalizedAmount: number | undefined;
  if (claimAmount !== undefined && claimAmount !== null) {
    if (!Number.isInteger(claimAmount) || claimAmount <= 0) {
      throw badRequest('INVALID_CLAIM_AMOUNT', 'claim amount must be a positive integer');
    }
    if (row.type !== 'BUY' && row.type !== 'SELL') {
      throw badRequest(
        'PARTIAL_CLAIM_NOT_SUPPORTED',
        `partial claim not supported for task type ${row.type}`,
      );
    }
    const minItemAmount = Math.min(...parentContract.items.map(i => i.amount));
    if (claimAmount > minItemAmount) {
      throw badRequest(
        'INVALID_CLAIM_AMOUNT',
        `claim amount ${claimAmount} exceeds task item amount ${minItemAmount}`,
      );
    }
    normalizedAmount = claimAmount;
  }

  // 部分接取路径：原任务缩 amount 后保持 PUBLISHED，给接取者创建反向子任务。
  if (normalizedAmount !== undefined && normalizedAmount < minItemAmount(parentContract)) {
    // 反向合同创建方：
    //   父 BUY：发布者想买入 → 接取者卖给他 → 子任务 publisher（= 接取者）签反向合同
    //     即 contract_creator = 'publisher'
    //   父 SELL：发布者想卖出 → 接取者从他买 → 子任务 publisher（= 接取者）
    //     等待原发布者签反向合同 → contract_creator = 'claimer'
    const reverseContractCreator: ContractCreator =
      row.type === 'BUY' ? 'publisher' : 'claimer';

    const result = await repoPartialClaimTask(env.DB, {
      parentTaskId: taskId,
      parentContractJson: parentContract,
      parentType: row.type as 'BUY' | 'SELL', // 上方已校验 type ∈ BUY | SELL
      claimAmount: normalizedAmount,
      claimerId: userId,
      claimerUsername: prunUsername,
      claimerCompanyCode: companyCode,
      reverseContractCreator,
    });

    await writeAuditLog(env.DB, {
      actorType: 'user',
      actorId: userId,
      action: 'task.partial_claim',
      targetType: 'task',
      targetId: taskId,
      metadata: {
        claim_amount: normalizedAmount,
        child_task_id: result.childCreated.id,
        reverse_contract_creator: reverseContractCreator,
      },
    });
    return { task: result.parentUpdated, childTask: result.childCreated };
  }

  // 完整接取路径（含 normalizedAmount 等于 item.amount 的边界）：
  // 原任务 → AWAITING_CONTRACT（与旧行为一致）。
  const contractCreator: ContractCreator = row.type === 'SHIP' ? 'publisher' : 'claimer';
  await repoClaimTask(env.DB, taskId, userId, prunUsername, companyCode, contractCreator);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.claim',
    targetType: 'task',
    targetId: taskId,
    metadata: {
      contract_creator: contractCreator,
      claim_amount: normalizedAmount,
    },
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after claim');
  return { task: mapTask(updated) };
}

function minItemAmount(contract: TaskContractJson): number {
  return Math.min(...contract.items.map(i => i.amount));
}

// release 返回结构：
//   - 完整接取任务 release → 返回原任务（AWAITING_CONTRACT → PUBLISHED）
//   - 部分接取子任务 release → 返回父任务（amount 已加回原值）
//     前端可用 parent_task_id 关联到原任务
export interface ReleaseTaskResult {
  task: OrgTask;
  // 当释放的是部分接取子任务时，标记反向合同时留下的子任务已被删除
  parentTaskId?: string;
  // 当释放的是部分接取子任务时，告诉前端子任务 amount 已经加回原任务
  restoredAmount?: number;
}

export async function releaseTask(
  env: Env,
  taskId: string,
  userId: string,
): Promise<ReleaseTaskResult> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');

  // 部分接取的子任务路径：parent_task_id 非空，由 publisher（= 接取者）释放。
  // 子任务的 claimer_id 为 NULL（没有"接取者"概念），所以原 claimer_id 检查不适用。
  if (row.parent_task_id) {
    if (row.publisher_id !== userId) {
      throw forbidden('Only the publisher (claimer of parent) can release the partial claim');
    }
    // 子任务状态必须为 AWAITING_CONTRACT（partial claim 总是创建这个状态）；
    // 关联合同后变成 IN_PROGRESS / COMPLETED，则不允许 release。
    if (row.status !== 'AWAITING_CONTRACT') {
      throw badRequest(
        'INVALID_TRANSITION',
        `Cannot release partial-claim child in ${row.status} state`,
      );
    }
    // 算出 child 的 amount（用于审计 + 响应）
    let childContract: TaskContractJson;
    try {
      childContract = typeof row.contract_json === 'string'
        ? (JSON.parse(row.contract_json) as TaskContractJson)
        : (row.contract_json as TaskContractJson);
    } catch {
      throw new HttpError(500, 'INTERNAL_ERROR', 'Child task contract_json is corrupted');
    }
    const childAmount = childContract.items[0]?.amount ?? 0;

    const result = await repoReleasePartialClaimTask(env.DB, taskId);
    await writeAuditLog(env.DB, {
      actorType: 'user',
      actorId: userId,
      action: 'task.release_partial_claim',
      targetType: 'task',
      targetId: taskId,
      metadata: {
        parent_task_id: row.parent_task_id,
        restored_amount: childAmount,
      },
    });
    return {
      task: result.parentUpdated,
      parentTaskId: row.parent_task_id,
      restoredAmount: childAmount,
    };
  }

  // 完整接取任务路径：AWAITING_CONTRACT → PUBLISHED，旧行为
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
  return { task: mapTask(updated) };
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
  // partial claim 自动创建的反向子任务不允许取消：
  // 取消子任务会绕过 releasePartialClaimTask 中"加回父任务 amount"的逻辑，
  // 导致父任务 amount 永久丢失。子任务只能用 release 还原回父任务。
  // BOARD 也不允许代删子任务（与 deleteTaskForPublisher 同样的 owner-only 语义）。
  if (row.parent_task_id) {
    throw badRequest(
      'CANNOT_CANCEL_CHILD_TASK',
      'Child task of partial claim cannot be cancelled; use release instead',
    );
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

// 重新发布：CANCELLED → PUBLISHED。仅 publisher 自己可以重新发布。
// 重新发布后任务回到"待接取"状态；claim / contract 等旧信息一并清空。
// contractJson / expiresAt 保留：若想修改内容，先 patch 再 republish；或 republish 后再 patch。
export async function republishTask(env: Env, taskId: string, userId: string): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.publisher_id !== userId) {
    throw forbidden('Only the publisher can republish');
  }
  if (row.status !== 'CANCELLED') {
    throw badRequest('INVALID_TRANSITION', `Cannot republish from ${row.status}`);
  }
  await repoRepublishTask(env.DB, taskId);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.republish',
    targetType: 'task',
    targetId: taskId,
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after republish');
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
  // partial claim 自动创建的反向子任务不允许删除。
  // 子任务的生命周期只有两种结局：
  //   1. 释放（releasePartialClaimTask）：删除子任务 + 加回父任务 amount
  //   2. 走完合同（IN_PROGRESS / COMPLETED / CANCELLED 由父任务状态联动）
  // 删除子任务会绕过"加回 amount"的逻辑，导致父任务 amount 永久丢失，
  // 因此服务端必须拒绝直接 delete。
  if (row.parent_task_id) {
    throw badRequest(
      'CANNOT_DELETE_CHILD_TASK',
      'Child task of partial claim cannot be deleted; use release instead',
    );
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
