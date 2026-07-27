// src/services/match-contract-service.ts
// 自动关联合同的权威匹配服务。
// 设计文档：AUTO_LINK_CONTRACT.md §"方案 B（后端权威匹配）"
//
// 流程：
//   1. 前端把 PrUnApi.Contract 投影成 ContractFingerprint 上报。
//   2. 本服务以 task.contractJson 作为 source of truth 做严格比对。
//   3. 若 matched 且 autoLink=true 且任务处于 AWAITING_CONTRACT 状态，
//      调 linkContract 把合同写入任务；否则只返回比对结果由前端走原端点。

import type { Env } from '../config';
import type { OrgTask, ContractCreator } from '../types';
import { badRequest, forbidden, notFound } from '../utils/http-error';
import {
  findTaskRowById,
  findEffectivePublisherId,
} from '../db/repositories/tasks.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';
import { mapTask } from '../db/mappers';
import { linkContract } from './task-service';
import {
  matchContractFingerprint,
  type ContractFingerprint,
  type MatchResult,
} from '../utils/contract-match';

export interface MatchContractParams {
  contractId: string;
  fingerprint: ContractFingerprint;
  autoLink?: boolean;
}

export interface MatchContractResult {
  matched: boolean;
  reason?: string;
  // 仅当匹配成功且 autoLink=true 时返回更新后的任务。
  task?: OrgTask;
}

// 自动关联合同：仅 publisher / claimer 可触发（与 link-contract 一致）。
// CONTRACT_ALREADY_LINKED 由 linkContract 抛错；前置校验允许重复上报
// （前端可能在用户点确认时再次触发匹配）。
export async function matchContract(
  env: Env,
  taskId: string,
  userId: string,
  params: MatchContractParams,
): Promise<MatchContractResult> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  // 子任务的 publisher_id 是接取者，需通过父任务追溯到"原始发布者"。
  const effectivePublisherId = row.parent_task_id
    ? await findEffectivePublisherId(env.DB, taskId)
    : row.publisher_id;
  if (effectivePublisherId !== userId && row.claimer_id !== userId) {
    throw forbidden('NOT_TASK_PARTY');
  }
  // 允许重复上报（前端轮询时已关联任务不需要再匹配）；但当任务已
  // 在 AWAITING_CONTRACT 之后状态时拒绝自动关联（autoLink=true 路径）。
  if (params.autoLink) {
    if (row.status !== 'AWAITING_CONTRACT') {
      throw badRequest(
        'INVALID_TRANSITION',
        `Cannot auto-link in ${row.status} state`,
      );
    }
    if (row.contract_id) {
      throw badRequest('CONTRACT_ALREADY_LINKED', 'Contract already linked');
    }
  }

  const taskJson = JSON.parse(row.contract_json) as Parameters<
    typeof matchContractFingerprint
  >[0];

  // 发布者发送的合同不反转：优先用 publisher 匹配（no inversion），
  // 失败再尝试 claimer（inversion）。不依赖存储的 contract_creator。
  let result: MatchResult = matchContractFingerprint(
    taskJson,
    'publisher',
    params.fingerprint,
  );
  let effectiveCreator: ContractCreator = 'publisher';

  if (!result.matched) {
    const fallbackResult = matchContractFingerprint(
      taskJson,
      'claimer',
      params.fingerprint,
    );
    if (fallbackResult.matched) {
      result = fallbackResult;
      effectiveCreator = 'claimer';
    }
  }

  if (!result.matched) {
    await writeAuditLog(env.DB, {
      actorType: 'user',
      actorId: userId,
      action: 'task.match_contract',
      targetType: 'task',
      targetId: taskId,
      metadata: {
        contract_id: params.contractId,
        matched: false,
        reason: result.reason,
      },
    });
    return { matched: false, reason: result.reason };
  }

  let task: OrgTask | undefined;
  if (params.autoLink) {
    task = await linkContract(
      env,
      taskId,
      userId,
      params.contractId,
      effectiveCreator,
    );
    await writeAuditLog(env.DB, {
      actorType: 'user',
      actorId: userId,
      action: 'task.match_contract',
      targetType: 'task',
      targetId: taskId,
      metadata: {
        contract_id: params.contractId,
        matched: true,
        auto_linked: true,
      },
    });
    return { matched: true, task };
  }

  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.match_contract',
    targetType: 'task',
    targetId: taskId,
    metadata: {
      contract_id: params.contractId,
      matched: true,
      auto_linked: false,
    },
  });
  // 仅返回 matched=true 让前端调 link-contract；附带 snapshot 便于 UI 提示。
  return { matched: true, task: mapTask(row) };
}
