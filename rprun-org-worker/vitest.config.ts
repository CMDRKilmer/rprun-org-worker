// vitest.config.ts
// 一次配置覆盖所有测试（jwt 单测 + 集成测试）
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // 提前声明 D1/KV 绑定，jwt 单测不用但配置兼容
          d1Databases: ['DB'],
          kvNamespaces: ['KV'],
          // 测试用 secrets（避免 Worker 启动时 JWT_SECRET 缺失）
          bindings: {
            JWT_SECRET: 'test-jwt-secret-32bytes-or-more-aaaaaaaaa',
            REFRESH_TOKEN_SECRET: 'test-refresh-secret-32bytes-or-more-bbbbbb',
          },
        },
      },
    },
    // 集成测试的 setup 文件由 Task 21 创建
    setupFiles: ['./tests/setup.ts'],
  },
});
