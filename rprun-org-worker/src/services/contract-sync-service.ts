// src/services/contract-sync-service.ts
import type { Env } from '../config';
import type { OrgTask, PrunContractStatus, TaskStatus } from '../types';
import { badRequest, forbidden, notFound, HttpError } from '../utils/http-error';
import { canTransition } from './task-service';
import {
  findTaskRowById,
  findEffectivePublisherId,
  setTaskStatus,
} from '../db/repositories/tasks.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';
import { mapTask } from '../db/mappers';

// 大写状态映射（与客户端 types.ts PrunContractStatus 枚举对齐）
const CONTRACT_STATUS_TO_TASK: Partial<Record<PrunContractStatus, TaskStatus>> = {
  CLOSED: 'IN_PROGRESS',
  FULFILLED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  BREACHED: 'CANCELLED',
  TERMINATED: 'CANCELLED',
  // OPEN / PARTIALLY_FULFILLED / REJECTED / DEADLINE_EXCEEDED 不映射
};

export async function syncTaskFromContract(
  env: Env,
  taskId: string,
  contractStatus: PrunContractStatus,
  userId: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.publisher_id !== userId && row.claimer_id !== userId) {
    throw forbidden('NOT_TASK_PARTY');
  }
  if (!row.contract_id) {
    throw badRequest('NO_CONTRACT_LINKED', 'Task has no linked contract');
  }

  const nextStatus = CONTRACT_STATUS_TO_TASK[contractStatus];
  if (!nextStatus) {
    // 合同状态不触发任务状态变化，直接返回当前任务（幂等）
    return mapTask(row);
  }
  if (!canTransition(row.status, nextStatus)) {
    // 状态机不允许此转移（如已完成任务又收到 CLOSED），返回当前任务
    return mapTask(row);
  }

  await setTaskStatus(env.DB, taskId, nextStatus as 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED');
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.sync_status',
    targetType: 'task',
    targetId: taskId,
    metadata: {
      from: row.status,
      to: nextStatus,
      contract_status: contractStatus,
    },
  });

  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after sync');
  return mapTask(updated);
}
