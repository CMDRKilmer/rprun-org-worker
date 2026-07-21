// tests/types.d.ts
/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { Env as AppEnv } from '../src/config';

// v0.13+ 中 cloudflare:test 的 env 返回 Cloudflare.Env 全局类型
// （ProvidedEnv 接口已移除）。通过声明合并增强全局 Cloudflare.Env，
// 使测试代码中 `import { env } from 'cloudflare:test'` 拿到的 env 自动包含 Env 的字段。
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}
