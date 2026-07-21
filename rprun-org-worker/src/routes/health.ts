// src/routes/health.ts
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../config';

const health = new Hono<{ Bindings: Env }>();

// GET /health
// 公开端点，用于 Cloudflare 探活 + 部署后自检
health.get('/', async (c) => {
  // 简单 D1 ping
  let dbOk = false;
  try {
    await c.env.DB.prepare('SELECT 1').first();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return c.json({
    status: dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    db: dbOk ? 'up' : 'down',
  }, 200 as ContentfulStatusCode);
});

export default health;
