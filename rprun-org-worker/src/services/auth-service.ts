// src/services/auth-service.ts
import type { Env } from '../config';
import type { AuthSession, OrgUser } from '../types';
import { hashPassword, verifyPassword } from '../utils/password';
import { signJWT } from '../utils/jwt';
import { generateId } from '../utils/id';
import { getAccessTtl, getRefreshTtl } from '../config';
import { HttpError, badRequest, conflict, unauthorized } from '../utils/http-error';
import {
  findUserByEmail,
  findUserById,
  touchUserLogin,
} from '../db/repositories/users.repo';
import {
  findRefreshTokenByHash,
  issueRefreshToken,
  revokeRefreshToken,
} from '../db/repositories/refresh-tokens.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';
import { mapUser } from '../db/mappers';

async function hashRefreshToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function issueSession(env: Env, userId: string, user: OrgUser): Promise<AuthSession> {
  const accessToken = await signJWT(
    {
      sub: userId,
      prun_username: user.prunUsername,
      company_code: user.companyCode,
      role: user.role,
    },
    env.JWT_SECRET,
    getAccessTtl(env),
  );
  const { token: refreshToken } = await issueRefreshToken(
    env.DB,
    userId,
    getRefreshTtl(env),
    hashRefreshToken,
  );
  return { accessToken, refreshToken, user };
}

export interface RegisterParams {
  email: string;
  password: string;
  inviteCode: string;
  prunUsername: string;
  companyCode: string;
}

export async function registerWithInvite(env: Env, params: RegisterParams): Promise<AuthSession> {
  const { email, password, inviteCode, prunUsername, companyCode } = params;
  const passwordHash = await hashPassword(password);
  const userId = generateId();

  // D1 batch：单个事务保证原子性
  const statements = [
    // 1. 原子占用邀请码
    env.DB.prepare(
      `UPDATE invite_codes
       SET used_by_user_id = ?, used_at = datetime('now')
       WHERE code = ? AND used_by_user_id IS NULL AND revoked_at IS NULL`,
    ).bind(userId, inviteCode),

    // 2. 创建用户（INSERT 用子查询从 invite_codes 取 id；email/username UNIQUE 冲突会触发 batch 失败）
    env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, prun_username, company_code, invite_code_id)
       VALUES (?, ?, ?, ?, ?, (SELECT id FROM invite_codes WHERE code = ?))`,
    ).bind(userId, email, passwordHash, prunUsername, companyCode, inviteCode),

    // 3. 审计日志
    env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id)
       VALUES (?, 'user', ?, 'user.register', 'user', ?)`,
    ).bind(generateId(), userId, userId),
  ];

  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (err) {
    // UNIQUE 冲突（email 或 prun_username+company_code 已存在）或 NOT NULL 约束失败
    const msg = String(err);
    if (msg.includes('users.email')) {
      throw conflict('EMAIL_EXISTS', 'Email already registered');
    }
    if (msg.includes('prun_username')) {
      throw conflict('USER_EXISTS', 'PrUn username + company code already registered');
    }
    // NOT NULL 约束失败：invite_codes 子查询返回 NULL（即邀请码不存在）
    // 转为 INVITE_INVALID 400，对客户端更友好
    if (msg.includes('NOT NULL') || msg.includes('constraint')) {
      throw badRequest('INVITE_INVALID', 'Invite code invalid, used, or revoked');
    }
    throw new HttpError(500, 'INTERNAL_ERROR', 'Registration failed');
  }

  // 邀请码无效或已被抢用（UPDATE 影响 0 行）
  if (results[0].meta.changes !== 1) {
    throw badRequest('INVITE_INVALID', 'Invite code invalid, used, or revoked');
  }

  const user = await findUserById(env.DB, userId);
  if (!user) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'User not found after register');
  }
  return issueSession(env, userId, user);
}

export interface LoginParams {
  email: string;
  password: string;
}

export async function login(env: Env, params: LoginParams): Promise<AuthSession> {
  const row = await findUserByEmail(env.DB, params.email);
  if (!row) {
    throw unauthorized('Invalid email or password');
  }
  const ok = await verifyPassword(params.password, row.password_hash);
  if (!ok) {
    throw unauthorized('Invalid email or password');
  }
  await touchUserLogin(env.DB, row.id);
  const user = mapUser(row);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: row.id,
    action: 'user.login',
    targetType: 'user',
    targetId: row.id,
  });
  return issueSession(env, row.id, user);
}

export async function refreshSession(env: Env, refreshToken: string): Promise<AuthSession> {
  const tokenHash = await hashRefreshToken(refreshToken);
  const record = await findRefreshTokenByHash(env.DB, tokenHash);
  if (!record) {
    throw unauthorized('Invalid refresh token');
  }
  if (record.revokedAt) {
    throw unauthorized('Refresh token revoked');
  }
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    throw unauthorized('Refresh token expired');
  }

  // 滚动刷新：吊销旧 token，颁发新 token
  await revokeRefreshToken(env.DB, record.id);
  const user = await findUserById(env.DB, record.userId);
  if (!user) {
    throw unauthorized('User not found');
  }
  return issueSession(env, record.userId, user);
}

export async function logout(env: Env, refreshToken: string, userId: string): Promise<void> {
  const tokenHash = await hashRefreshToken(refreshToken);
  const record = await findRefreshTokenByHash(env.DB, tokenHash);
  if (record && record.userId === userId) {
    await revokeRefreshToken(env.DB, record.id);
    await writeAuditLog(env.DB, {
      actorType: 'user',
      actorId: userId,
      action: 'user.logout',
      targetType: 'user',
      targetId: userId,
    });
  }
  // 即使 token 不存在也返回成功（幂等）
}

export async function getMe(env: Env, userId: string): Promise<OrgUser> {
  const user = await findUserById(env.DB, userId);
  if (!user) {
    throw unauthorized('User not found');
  }
  return user;
}
