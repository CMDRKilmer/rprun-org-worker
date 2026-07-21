// src/middleware/jwt.ts
import { createMiddleware } from 'hono/factory';
import { verifyJWT } from '../utils/jwt';
import { unauthorized } from '../utils/http-error';
import type { Env } from '../config';
import type { ContextVars } from '../types';

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: ContextVars }>(
  async (c, next) => {
    const auth = c.req.header('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      throw unauthorized('Missing token');
    }
    const payload = await verifyJWT(auth.slice(7), c.env.JWT_SECRET);
    if (!payload) {
      throw unauthorized('Invalid token');
    }
    // 同时注入 user 对象与扁平便捷字段，路由层用 c.var.userId / c.var.prunUsername 等
    c.set('user', {
      sub: payload.sub,
      prun_username: payload.prun_username,
      company_code: payload.company_code,
      role: payload.role,
    });
    c.set('userId', payload.sub);
    c.set('prunUsername', payload.prun_username);
    c.set('companyCode', payload.company_code);
    c.set('role', payload.role);
    await next();
  },
);
