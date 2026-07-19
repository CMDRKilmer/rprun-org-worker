# rprun-org-worker

ORG（组织管理面板）后端 Cloudflare Worker。独立部署，提供邀请制组织内的任务发布/接取/合同联动/董事会管理 REST API。

> 客户端代码在 rprun 扩展仓库的 `src/infrastructure/org-api/`。本后端必须严格对齐客户端契约。

## 技术栈

- Cloudflare Workers (V8 isolate)
- Hono (Web 框架)
- D1 (SQLite)
- KV (预留，当前未使用)
- Cron Triggers (每 5 分钟清理过期任务 + 限流桶)
- TypeScript + Vitest + Miniflare

## 开发

### 安装依赖

```bash
pnpm install
```

### 本地启动

```bash
pnpm db:migrate:local   # 应用 D1 schema 到本地 Miniflare
pnpm dev                # 启动 wrangler dev，默认 http://localhost:8787
```

### 测试

```bash
pnpm test               # 运行 Vitest（含 Miniflare D1 集成测试）
pnpm compile            # tsc --noEmit
```

## 部署（首次）

### 步骤 1: 创建 D1 数据库

```bash
pnpm wrangler d1 create rprun-org-db
```

把输出的 `database_id` 填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "rprun-org-db"
database_id = "<填这里>"
```

### 步骤 2: 创建 KV 命名空间（预留）

```bash
pnpm wrangler kv namespace create KV
```

把 `id` 填入 `wrangler.toml` 的 `[[kv_namespaces]]`。

### 步骤 3: 设置 secrets

```bash
pnpm wrangler secret put JWT_SECRET       # 至少 32 字节随机
```

`JWT_SECRET` 必须设置，否则 Worker 启动时所有鉴权请求都会失败。

### 步骤 4: 应用 D1 schema 到生产

```bash
pnpm db:migrate
```

> 必须先于 Worker 部署：Worker 启动后第一条请求就会查表，schema 未应用会导致 500。

### 步骤 5: 部署 Worker

```bash
pnpm deploy
```

### 步骤 6: 引导第一个 BOARD 用户

⚠️ **关键步骤**：第一个 BOARD 用户不能用邀请码注册（因为邀请码必须由 BOARD 生成）。直接用 SQL 插入：

```bash
# 1. 在本地算出密码哈希（用 Worker 的 PBKDF2 算法）
#    方式 A：本地 wrangler dev 起来后，调用 /auth/register 注册任意账号，
#            然后 wrangler d1 execute rprun-org-db --local --command="SELECT password_hash FROM users WHERE email='...'"
#    方式 B：写一次性 Worker 脚本调用 hashPassword('yourpassword') 输出哈希

# 2. 写入 BOARD 用户（替换 <hash> 和 <email>/<prunUsername>/<companyCode>）
#    注意：users.invite_code_id 是 NOT NULL UNIQUE，必须先插一行 invite_codes 再引用其 id
pnpm wrangler d1 execute rprun-org-db --remote --command="
INSERT INTO invite_codes (id, code, created_by) VALUES (
  lower(hex(randomblob(16))),
  upper(substr(replace(hex(randomblob(8)), '0', 'A'), 1, 10)),
  'bootstrap'
);
INSERT INTO users (id, email, password_hash, prun_username, company_code, display_name, role, invite_code_id)
VALUES (
  lower(hex(randomblob(16))),
  'admin@your-org.local',
  '<预计算的 PBKDF2 哈希>',
  'admin_user',
  'ADM',
  'Admin',
  'BOARD',
  (SELECT id FROM invite_codes WHERE created_by = 'bootstrap' LIMIT 1)
);
"
```

> **预计算密码哈希**：在本地 `wrangler dev` 跑起来后，调用 `POST /auth/register` 注册任意账号，然后 `wrangler d1 execute rprun-org-db --local --command="SELECT password_hash FROM users WHERE email='...'"` 拿到哈希值。或者写一个一次性 Worker 脚本调用 `hashPassword('yourpassword')` 输出哈希。

### 步骤 7: 验证部署

```bash
curl https://rprun-org-api.<your-subdomain>.workers.dev/health
# 应返回 {"status":"ok","db":"up",...}

curl -X POST https://rprun-org-api.<your-subdomain>.workers.dev/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@your-org.local","password":"yourpassword"}'
# 应返回 accessToken + refreshToken
```

### 步骤 8: 让 BOARD 生成邀请码分发

```bash
curl -X POST https://rprun-org-api.<your-subdomain>.workers.dev/board/invite-codes \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"count": 10, "createdBy": "<your user id>"}'
```

## 后续部署

```bash
git pull
pnpm install
pnpm compile
pnpm test
pnpm deploy
# 如有 schema 变更，追加 002_xxx.sql 并 pnpm wrangler d1 execute rprun-org-db --file=src/db/migrations/002_xxx.sql
```

## API 文档

完整 API 形状见 rprun 仓库 `src/infrastructure/org-api/types.ts` 与各 API 函数文件（`auth.ts` / `tasks.ts` / `notes.ts` / `board.ts`）。本后端实现严格对齐这些客户端契约。

错误响应统一格式：

```json
{ "error": { "code": "ERROR_CODE", "message": "人类可读消息" } }
```

常见错误码：
- `VALIDATION_ERROR` (400) — Zod schema 校验失败
- `INVITE_INVALID` (400) — 邀请码不存在 / 已撤销 / 已使用
- `INVITE_ALREADY_USED` (400) — 邀请码已被使用
- `CANNOT_CLAIM_OWN` (400) — 不能接取自己发布的任务
- `CANNOT_DEMOTE_SELF` (400) — 不能把自己降级
- `LAST_BOARD` (400) — 不能降级最后一个 BOARD（service 层校验）
- `INVALID_TRANSITION` (400) — 任务状态机不允许的转移
- `CONTRACT_ALREADY_LINKED` (400) — 任务已绑定合同
- `NO_CONTRACT_LINKED` (400) — 任务未绑定合同，无法 sync-status
- `CODE_ALREADY_USED` (400) — 不能撤销已使用的邀请码
- `UNAUTHORIZED` (401) — 未登录 / token 无效
- `FORBIDDEN` (403) — 权限不足（如 COLLABORATOR 访问 /board/*）
- `NOT_FOUND` (404)
- `RATE_LIMITED` (429)

> promote / demote 是幂等的：已是目标角色直接返回 200，不返回 ALREADY_* 错误。

## 架构决策

详见 `docs/superpowers/plans/2026-07-18-org-panel-architecture.md` §12。本仓库是其可执行实现。

## 限流

- `POST /auth/register`：每 IP 每小时 5 次（架构 §12.9）
- `POST /auth/login`：每 IP 每小时 20 次
- `POST /auth/refresh`：每 IP 每小时 60 次
- 其他端点：通过 JWT 限流（未实现，留待后期）

限流基于 D1 `rate_limit_buckets` 表（KV 写入限制不适用于高频限流）。Cron 每 5 分钟清理过期桶。
