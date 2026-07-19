// src/routes/auth.ts
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../config';
import type { ContextVars } from '../types';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from '../utils/validation';
import {
  registerWithInvite,
  login,
  refreshSession,
  logout,
  getMe,
} from '../services/auth-service';
import { authMiddleware } from '../middleware/jwt';
import { rateLimit } from '../middleware/rate-limit';
import { apiError } from '../utils/http-error';

const auth = new Hono<{ Bindings: Env; Variables: ContextVars }>();

// POST /auth/register
// 公开端点 + 限流（每 IP 每小时 5 次，架构 §12.9）
auth.post('/register', rateLimit({ window: 3600, max: 5, key: 'register' }), async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const session = await registerWithInvite(c.env, parsed.data);
  return c.json(session, 201 as ContentfulStatusCode);
});

// POST /auth/login
// 公开端点 + 限流（每 IP 每小时 20 次，架构 §12.9）
auth.post('/login', rateLimit({ window: 3600, max: 20, key: 'login' }), async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const session = await login(c.env, parsed.data);
  return c.json(session, 200 as ContentfulStatusCode);
});

// POST /auth/refresh
// 公开端点（用 refreshToken 换 accessToken），限流防爆破
auth.post('/refresh', rateLimit({ window: 3600, max: 60, key: 'refresh' }), async (c) => {
  const body = await c.req.json();
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const session = await refreshSession(c.env, parsed.data.refreshToken);
  return c.json(session, 200 as ContentfulStatusCode);
});

// POST /auth/logout
// 需要登录：service 会校验 refreshToken 归属于当前 userId（防止越权吊销他人 token）
auth.post('/logout', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = logoutSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  await logout(c.env, parsed.data.refreshToken, c.var.userId);
  return c.body(null, 204);
});

// GET /auth/me
// 需要登录
auth.get('/me', authMiddleware, async (c) => {
  const user = await getMe(c.env, c.var.userId);
  return c.json(user, 200 as ContentfulStatusCode);
});

export default auth;
