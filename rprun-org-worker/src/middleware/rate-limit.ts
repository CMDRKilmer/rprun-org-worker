// src/middleware/rate-limit.ts
import { createMiddleware } from 'hono/factory';
import { incrementBucket } from '../db/repositories/rate-limits.repo';
import { HttpError } from '../utils/http-error';
import type { Env } from '../config';

export interface RateLimitOptions {
  // 窗口名（与 IP 拼成 bucket_key）
  key: string;
  // 窗口内允许的最大请求数
  max: number;
  // 窗口长度（秒）；架构 §12.9 限流策略为按小时，故典型值 3600
  window: number;
}

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const bucketKey = `${opts.key}:${ip}:${Math.floor(Date.now() / 1000 / opts.window)}`;
    const count = await incrementBucket(c.env.DB, bucketKey, opts.window);
    if (count > opts.max) {
      throw new HttpError(429, 'RATE_LIMITED', 'Too many requests');
    }
    await next();
  });
}
