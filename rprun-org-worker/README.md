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

## 部署踩坑（2026-07-21 第一次部署记录）

按上面流程部署时实测遇到的问题，**先读这些再按 README 步骤走**能省很多时间：

### 1. `pnpm deploy` 报 `ERR_PNPM_NOTHING_TO_DEPLOY`

根 `pnpm-workspace.yaml` 把 `.` 注册成 workspace 包后，根目录的 `pnpm deploy` 不会执行子目录的 deploy 脚本。直接绕过 pnpm：

```bash
pnpm exec wrangler deploy
```

README §后续部署里同样要换成 `pnpm exec wrangler deploy`。

### 2. wrangler d1 execute 不支持 `BEGIN TRANSACTION`

wrangler 3.x/4.x 都用 HTTP API 调用 D1，不支持 SQL 层 `BEGIN TRANSACTION`/`COMMIT`，会报 `To execute a transaction, please use the state.storage.transaction() APIs instead`。**每个 SQL 脚本只能放独立语句**（DELETE + INSERT + INSERT）。

### 3. wrangler.toml 占位符必须改成真实 id 再 deploy

部署前 `database_id` 和 KV `id` 必须是从 `wrangler d1 create` / `wrangler kv namespace create` 输出拿到的真实值。占位符 `<用 wrangler d1 create 生成后填入>` 会导致 `wrangler.toml` 里那一行被 Cloudflare API 当真实值提交，返回 `code: 10042 is not valid`。

### 4. Cloudflare KV namespace id 格式

KV namespace id 是 **32 字符无连字符 hex 字符串**（例如 `4c99848123414879b9612e39f5dcc90f`），**不是**标准 UUID 格式。Dashboard 上显示的就是这个格式。

### 5. 引导第一个 BOARD 用户必须直接 SQL

不能走 `POST /auth/register`：邀请码必须由 BOARD 生成，第一个 BOARD 是鸡生蛋问题。README §步骤 6 的 SQL 模板可用，注意：
- 幂等键用 `prun_username + company_code`（不用 email，email 会变）
- `password_hash` 必须用 Worker 的 PBKDF2 算法（100k iter, SHA-256）算，**不能用 Node `crypto.pbkdf2Sync` 默认参数**，否则 verify 时 hash 不匹配
- **必须先 DELETE 依赖**：D1 默认开启 FOREIGN KEY 检查，`refresh_tokens.user_id`、`tasks.publisher_id / claimer_id`、`task_notes.author_id`、`audit_logs.actor_id` 都引用 `users.id`。直接 `DELETE FROM users` 会报 `SQLITE_CONSTRAINT_FOREIGNKEY` 并回滚。脚本里已经按依赖顺序删除

可以用 `scripts/hash-bootstrap-password.mjs` 算：

```bash
pnpm exec node scripts/hash-bootstrap-password.mjs "<password>"
```

### 6. 扩展前端 CORS / host_permissions

浏览器扩展 content script 注入到 `https://apex.prosperousuniverse.com/`，fetch 时的 origin 是**页面 origin**，不是 `chrome-extension://`。所以：

- 后端 `ALLOWED_ORIGIN_PREFIXES` 必须加 `'https://apex.prosperousuniverse.com'`，否则预检 OPTIONS 失败
- 扩展 `manifest.json` 的 `host_permissions` 必须加 Worker URL，否则 content script 的 fetch 会被 Chrome 拦截

> **不要试图把 fetch 走 `chrome.runtime.sendMessage` → background service worker**。`dist/virtual/*.js` 是在 page context 里加载的（`<script type="module">` 注入到页面），不在 content script context，`chrome.runtime` 是 undefined。要走 background，必须把所有 client.ts 的引用方搬到 content script context（IIFE bundle），改造范围大。当前架构默认直接 fetch + apex CORS 白名单是最简方案。

### 7. 前后端契约：分页接口返回 `{ items, nextCursor }`

`/tasks` 和 `/board/audit-logs` 后端都返回 `{ items: [...], nextCursor: string | null }`，前端 `listTasks` / `listAuditLogs` 必须用 `result.items`，不能直接当数组用 `v-for`。如果忘了 `.items`，Vue 会把对象当数组遍历，第一个 value 是空数组，第二个 value 是 `null`，访问 `.id` 报 `Cannot read properties of null`。

### 8. `pnpm dev` 的本地 D1 schema 跟 wrangler dev 用的不是同一份

`pnpm db:migrate:local`（用 `wrangler d1 execute --local`）写入的 SQLite 文件路径，跟 `pnpm dev`（用 Miniflare）加载的不是同一个。`wrangler dev` 启动时会用 `.wrangler/state/v3/d1/...` 的本地副本，**如果之前没起过 wrangler dev，这边是空表**。本地测试时如果 `auth/register` 报 `no such table: rate_limit_buckets`，先停 wrangler dev，跑 `pnpm db:migrate:local`，再起 wrangler dev。
