// src/services/invite-service.ts
import type { Env } from '../config';
import type { InviteCode, OrgUser } from '../types';
import { badRequest, notFound } from '../utils/http-error';
import {
  createInviteCodes,
  findInviteCodeById,
  listInviteCodes,
  revokeInviteCode,
} from '../db/repositories/invite-codes.repo';
import {
  updateUserRole,
  findUserById,
  listAllUsers,
} from '../db/repositories/users.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';

export async function generateCodes(
  env: Env,
  count: number,
  createdBy: string,
  actorUserId: string,
): Promise<InviteCode[]> {
  const codes = await createInviteCodes(env.DB, count, createdBy);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: actorUserId,
    action: 'invite_code.generate',
    targetType: 'invite_code',
    metadata: { count, created_by: createdBy },
  });
  return codes;
}

export async function listCodes(env: Env): Promise<InviteCode[]> {
  return listInviteCodes(env.DB);
}

export async function revokeCode(
  env: Env,
  codeId: string,
  actorUserId: string,
): Promise<InviteCode> {
  const code = await findInviteCodeById(env.DB, codeId);
  if (!code) throw notFound('Invite code not found');
  if (code.usedByUserId) {
    throw badRequest('CODE_ALREADY_USED', 'Cannot revoke a used invite code');
  }
  if (code.revokedAt) {
    return code; // 幂等
  }
  await revokeInviteCode(env.DB, codeId);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: actorUserId,
    action: 'invite_code.revoke',
    targetType: 'invite_code',
    targetId: codeId,
  });
  const updated = await findInviteCodeById(env.DB, codeId);
  if (!updated) throw new Error('Invite code vanished after revoke');
  return updated;
}

export async function promoteUser(
  env: Env,
  targetUserId: string,
  actorUserId: string,
): Promise<OrgUser> {
  const user = await findUserById(env.DB, targetUserId);
  if (!user) throw notFound('User not found');
  if (user.role === 'BOARD') return user; // 幂等
  await updateUserRole(env.DB, targetUserId, 'BOARD');
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: actorUserId,
    action: 'user.promote',
    targetType: 'user',
    targetId: targetUserId,
  });
  const updated = await findUserById(env.DB, targetUserId);
  if (!updated) throw new Error('User vanished after promote');
  return updated;
}

export async function demoteUser(
  env: Env,
  targetUserId: string,
  actorUserId: string,
): Promise<OrgUser> {
  if (targetUserId === actorUserId) {
    throw badRequest('CANNOT_DEMOTE_SELF', 'Cannot demote yourself');
  }
  const user = await findUserById(env.DB, targetUserId);
  if (!user) throw notFound('User not found');
  if (user.role === 'COLLABORATOR') return user; // 幂等
  // 防止把最后一个 BOARD 降级（避免组织无人可管理）
  const boardCount = await env.DB
    .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'BOARD'")
    .first<{ cnt: number }>();
  if ((boardCount?.cnt ?? 0) <= 1) {
    throw badRequest('LAST_BOARD', 'Cannot demote the last BOARD user');
  }
  await updateUserRole(env.DB, targetUserId, 'COLLABORATOR');
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: actorUserId,
    action: 'user.demote',
    targetType: 'user',
    targetId: targetUserId,
  });
  const updated = await findUserById(env.DB, targetUserId);
  if (!updated) throw new Error('User vanished after demote');
  return updated;
}

export async function listUsers(env: Env): Promise<OrgUser[]> {
  return listAllUsers(env.DB);
}
