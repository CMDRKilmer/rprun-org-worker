// src/config.ts
export interface Env {
  // D1 绑定
  DB: D1Database;
  // KV 绑定（预留）
  KV: KVNamespace;
  // Secrets（wrangler secret put）
  JWT_SECRET: string;
  REFRESH_TOKEN_SECRET: string;
  // Vars（wrangler.toml [vars]）
  ENV: string;
  JWT_ACCESS_TTL: string;          // 秒数，默认 900
  JWT_REFRESH_TTL: string;         // 秒数，默认 604800
  RATE_LIMIT_REGISTER_PER_HOUR: string;
  RATE_LIMIT_LOGIN_PER_HOUR: string;
  POLL_INTERVAL_ADVICE: string;
}

export function getAccessTtl(env: Env): number {
  return parseInt(env.JWT_ACCESS_TTL, 10) || 900;
}

export function getRefreshTtl(env: Env): number {
  return parseInt(env.JWT_REFRESH_TTL, 10) || 604800;
}
