// src/services/audit-service.ts
import type { Env } from '../config';
import {
  listAuditLogs,
  type ListAuditLogsFilter,
  type ListAuditLogsResult,
} from '../db/repositories/audit-logs.repo';
import { countAllTasks, countTasksByStatus } from '../db/repositories/tasks.repo';
import { countUsersByRole } from '../db/repositories/users.repo';

export async function queryAuditLogs(
  env: Env,
  filter: ListAuditLogsFilter,
): Promise<ListAuditLogsResult> {
  return listAuditLogs(env.DB, filter);
}

export interface OrgStats {
  userCount: number;
  taskCount: number;
  boardCount: number;
  collaboratorCount: number;
  nonOrgUserCount: number;
  tasksByStatus: Record<string, number>;
}

export async function getStats(env: Env): Promise<OrgStats> {
  const [userCounts, taskCount, tasksByStatus] = await Promise.all([
    countUsersByRole(env.DB),
    countAllTasks(env.DB),
    countTasksByStatus(env.DB),
  ]);
  return {
    userCount: userCounts.total,
    taskCount,
    boardCount: userCounts.boardCount,
    collaboratorCount: userCounts.collaboratorCount,
    nonOrgUserCount: userCounts.nonOrgUserCount,
    tasksByStatus,
  };
}
