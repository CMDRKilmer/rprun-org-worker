// src/middleware/board-only.ts
import { createMiddleware } from 'hono/factory';
import { forbidden } from '../utils/http-error';
import type { Env } from '../config';
import type { ContextVars } from '../types';

export const boardOnly = createMiddleware<{ Bindings: Env; Variables: ContextVars }>(
  async (c, next) => {
    const user = c.get('user');
    if (!user || user.role !== 'BOARD') {
      throw forbidden('Board members only');
    }
    await next();
  },
);
