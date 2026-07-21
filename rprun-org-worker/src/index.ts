// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './config';
import { errorHandler } from './middleware/error';
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import boardRoutes from './routes/board';
import healthRoutes from './routes/health';
import { cleanupExpiredTasks } from './services/task-service';
import { cleanupRateLimitBuckets } from './db/repositories/rate-limits.repo';

// Hono app（fetch handler）
const app = new Hono<{ Bindings: Env }>();

// 全局错误处理（必须在最前）
app.onError(errorHandler);

// CORS：架构 §12.14 仅允许 rprun 扩展 origin + 本地测试 origin
// 浏览器扩展的 origin 形如 moz-extension://<UUID> 或 chrome-extension://<UUID>
// UUID 随安装变化，故按 scheme 前缀放行；同时允许 localhost 用于本地 vitest
const ALLOWED_ORIGIN_PREFIXES = [
  'moz-extension://',
  'chrome-extension://',
  'https://apex.prosperousuniverse.com',
];
const isAllowedOrigin = (origin: string): boolean =>
  ALLOWED_ORIGIN_PREFIXES.some(p => origin.startsWith(p)) ||
  /^http:\/\/localhost(:\d+)?$/.test(origin);

app.use('*', cors({
  origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : null),
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
  credentials: false,
}));

// 路由挂载
app.route('/auth', authRoutes);
app.route('/tasks', taskRoutes);
app.route('/board', boardRoutes);
app.route('/health', healthRoutes);

// 根 404（未匹配路由）
app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));

// Export fetch handler
export default {
  fetch: app.fetch,

  // Cron Trigger handler（每 5 分钟）
  // wrangler.toml 中配置：[triggers] crons = ["*/5 * * * *"]
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.allSettled([
      cleanupExpiredTasks(env),       // 把过期 PUBLISHED 任务标记 CANCELLED
      cleanupRateLimitBuckets(env.DB), // 删除过期的 rate_limit_buckets 行
    ]));
  },
} satisfies ExportedHandler<Env>;
