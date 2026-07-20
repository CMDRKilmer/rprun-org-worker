// tests/types.d.ts
/// <reference types="@cloudflare/vitest-pool-workers" />
import type { Env } from '../src/config';

// 增强 cloudflare:test 的 env/SELF 类型，使测试代码能直接 import { env, SELF }
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
