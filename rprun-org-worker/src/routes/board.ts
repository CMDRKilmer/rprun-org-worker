// src/routes/board.ts
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../config';
import type { ContextVars } from '../types';
import { authMiddleware } from '../middleware/jwt';
import { boardOnly } from '../middleware/board-only';
import { apiError } from '../utils/http-error';
import {
  generateInviteCodesSchema,
  listAuditLogsQuerySchema,
} from '../utils/validation';
import {
  generateCodes,
  listCodes,
  revokeCode,
  listUsers,
  promoteUser,
  demoteUser,
} from '../services/invite-service';
import { queryAuditLogs, getStats } from '../services/audit-service';
import { reportExtensionUser } from '../services/extension-user-service';

const board = new Hono<{ Bindings: Env; Variables: ContextVars }>();

// POST /board/users/report
// 免登录：扩展用户上报接口
// body: { prunUsername, companyCode, displayName }
board.post('/users/report', async (c) => {
  const body = await c.req.json();
  if (!body.prunUsername || !body.companyCode) {
    throw apiError('VALIDATION_ERROR', 'prunUsername and companyCode are required', 400);
  }
  await reportExtensionUser(
    c.env,
    body.prunUsername,
    body.companyCode,
    body.displayName || body.prunUsername,
  );
  return c.json({ success: true }, 201 as ContentfulStatusCode);
});

// 全部 /board/* 路由都需要 BOARD 角色
board.use('*', authMiddleware, boardOnly);

// POST /board/invite-codes
// body: { count, createdBy }
// service 内部已写审计，路由不再重复
board.post('/invite-codes', async (c) => {
  const body = await c.req.json();
  const parsed = generateInviteCodesSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const codes = await generateCodes(
    c.env,
    parsed.data.count,
    parsed.data.createdBy,
    c.var.userId,
  );
  return c.json(codes, 201 as ContentfulStatusCode);
});

// GET /board/invite-codes
board.get('/invite-codes', async (c) => {
  const codes = await listCodes(c.env);
  return c.json(codes, 200 as ContentfulStatusCode);
});

// POST /board/invite-codes/:id/revoke
board.post('/invite-codes/:id/revoke', async (c) => {
  const code = await revokeCode(c.env, c.req.param('id'), c.var.userId);
  return c.json(code, 200 as ContentfulStatusCode);
});

// GET /board/users
board.get('/users', async (c) => {
  const users = await listUsers(c.env);
  return c.json(users, 200 as ContentfulStatusCode);
});

// POST /board/users/:id/promote
// service 幂等：已是 BOARD 直接返回 200
// 注：不禁止"提升自己"——已经是 BOARD，再次提升无害且与 service 行为一致
board.post('/users/:id/promote', async (c) => {
  const user = await promoteUser(c.env, c.req.param('id'), c.var.userId);
  return c.json(user, 200 as ContentfulStatusCode);
});

// POST /board/users/:id/demote
// service 内部检查 CANNOT_DEMOTE_SELF + LAST_BOARD
board.post('/users/:id/demote', async (c) => {
  const user = await demoteUser(c.env, c.req.param('id'), c.var.userId);
  return c.json(user, 200 as ContentfulStatusCode);
});

// GET /board/stats
board.get('/stats', async (c) => {
  const stats = await getStats(c.env);
  return c.json(stats, 200 as ContentfulStatusCode);
});

// GET /board/audit-logs?limit=&cursor=&action=&actorId=
board.get('/audit-logs', async (c) => {
  const query = Object.fromEntries(new URLSearchParams(c.req.query()));
  const parsed = listAuditLogsQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const result = await queryAuditLogs(c.env, parsed.data);
  return c.json(result, 200 as ContentfulStatusCode);
});

export default board;
