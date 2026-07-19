# ORG 后端实现计划（Cloudflare Workers 独立仓库）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立的 Cloudflare Worker 仓库中实现 ORG（组织管理面板）后端 REST API，支持 50 人邀请制组织内的任务发布/接取/合同联动/董事会管理。

**Architecture:** Cloudflare 原生栈（Workers + D1 + KV + Cron Triggers），Hono Web 框架，HS256 JWT + PBKDF2 密码哈希（WebCrypto）。业务逻辑全部在 Worker 内（状态机校验、邀请码原子性、合同状态同步、审计日志），客户端只负责 UI + 调 REST API。

**Tech Stack:** Cloudflare Workers (V8 isolate) + Hono + D1 (SQLite) + KV + Cron Triggers + TypeScript + Vitest + Miniflare

**Architecture spec:** `docs/superpowers/plans/2026-07-18-org-panel-architecture.md`（§12 是后端核心章节，本计划是 §12 的可执行版本）

---

## 0. 前置说明（务必先读）

### 0.1 客户端已就绪

客户端代码已实现并提交在 rprun 扩展仓库的 `src/infrastructure/org-api/` 目录。**后端必须与客户端 API 调用严格对齐**，否则无法工作。本计划的所有 API 形状（路径、参数、响应结构）都直接来自已实现的客户端代码。

### 0.2 客户端契约（后端必须遵守）

**Base URL**：通过扩展环境变量 `VITE_ORG_API_BASE` 配置，默认 `http://localhost:8787`（本地开发）。

**鉴权头**：`Authorization: Bearer <accessToken>`。客户端在 401 时自动用 `refreshToken` 调 `/auth/refresh` 续期，再重试一次。

**错误响应统一格式**（客户端 `client.ts:108-120` 解析此结构）：
```json
{ "error": { "code": "ERROR_CODE", "message": "人类可读消息" } }
```
HTTP 状态码与 `error.code` 配合使用。客户端 `HttpError` 类暴露 `.status` 与 `.code` 两个字段供 UI 显示。

**成功响应**：直接返回数据 JSON（无 `{ data: ... }` 包装）。`204 No Content` 用于无返回体的成功请求（客户端 `client.ts:122-124` 处理）。

### 0.3 关键客户端期望（与架构文档 §12.10.3 的差异）

⚠️ **架构文档 §12.10.3 的 `CONTRACT_STATUS_TO_TASK` 用了小写状态名（closed/fulfilled 等），这是错误的。** 客户端 `types.ts:123-131` 的 `PrunContractStatus` 枚举是**大写**（与 PrUn 游戏 `contracts.types.d.ts` 对齐）：

```ts
type PrunContractStatus =
  | 'OPEN' | 'CLOSED' | 'CANCELLED' | 'FULFILLED'
  | 'PARTIALLY_FULFILLED' | 'REJECTED' | 'DEADLINE_EXCEEDED'
  | 'BREACHED' | 'TERMINATED';
```

后端 `sync-status` 端点必须接收大写状态字符串。映射表（**用大写**）：

| PrUn 合同状态 | 任务状态 |
| --- | --- |
| `CLOSED` | `IN_PROGRESS` |
| `FULFILLED` | `COMPLETED` |
| `CANCELLED` | `CANCELLED` |
| `BREACHED` | `CANCELLED` |
| `TERMINATED` | `CANCELLED` |
| `REJECTED` / `DEADLINE_EXCEEDED` | 不映射（保持任务现状） |
| `OPEN` / `PARTIALLY_FULFILLED` | 不映射（合同未结束） |

### 0.4 客户端调用清单（路径与请求体形状权威来源）

| 客户端函数 | 方法 + 路径 | 请求体 | 响应 |
| --- | --- | --- | --- |
| `auth.register` | POST `/auth/register` | `{ email, password, inviteCode, prunUsername, companyCode }` | `AuthSession` |
| `auth.login` | POST `/auth/login` | `{ email, password }` | `AuthSession` |
| `auth.logout` | POST `/auth/logout` | `{ refreshToken }` | 204 |
| `auth.fetchMe` | GET `/auth/me` | - | `OrgUser` |
| client 401 自动 | POST `/auth/refresh` | `{ refreshToken }` | `AuthSession` |
| `tasks.listTasks` | GET `/tasks?scope=&type=&publisherUsername=&claimerUsername=&location=&since=&limit=&cursor=` | - | `OrgTask[]` |
| `tasks.getTask` | GET `/tasks/:id` | - | `OrgTask` |
| `tasks.createTask` | POST `/tasks` | `{ type, contractJson, expiresAt? }` | `OrgTask` |
| `tasks.patchTask` | PATCH `/tasks/:id` | `{ contractJson?, expiresAt? }` | `OrgTask` |
| `tasks.claimTask` | POST `/tasks/:id/claim` | - | `OrgTask` |
| `tasks.releaseTask` | POST `/tasks/:id/release` | - | `OrgTask` |
| `tasks.cancelTask` | POST `/tasks/:id/cancel` | `{ reason? }` | `OrgTask` |
| `tasks.linkContract` | POST `/tasks/:id/link-contract` | `{ contractId, contractCreator }` | `OrgTask` |
| `tasks.syncContractStatus` | POST `/tasks/:id/sync-status` | `{ contractStatus }` | `OrgTask` |
| `notes.listNotes` | GET `/tasks/:id/notes` | - | `TaskNote[]` |
| `notes.createNote` | POST `/tasks/:id/notes` | `{ content }` | `TaskNote` |
| `board.generateInviteCodes` | POST `/board/invite-codes` | `{ count, createdBy }` | `InviteCode[]` |
| `board.listInviteCodes` | GET `/board/invite-codes` | - | `InviteCode[]` |
| `board.revokeInviteCode` | POST `/board/invite-codes/:id/revoke` | - | `InviteCode` |
| `board.listUsers` | GET `/board/users` | - | `OrgUser[]` |
| `board.promoteUser` | POST `/board/users/:id/promote` | - | `OrgUser` |
| `board.demoteUser` | POST `/board/users/:id/demote` | - | `OrgUser` |
| `board.fetchStats` | GET `/board/stats` | - | `OrgStats` |
| `board.listAuditLogs` | GET `/board/audit-logs?limit=&cursor=&action=&actorId=` | - | `AuditLog[]` |

### 0.5 客户端响应数据形状（必须字段名一一对应）

来自客户端 `types.ts`，**字段名严格大小写**：

```ts
// /auth/register /auth/login /auth/refresh 返回
interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: OrgUser;
}

// /auth/me /board/users /board/users/:id/promote|demote 返回
interface OrgUser {
  id: string;
  email: string;
  prunUsername: string;       // camelCase，不是 prun_username
  companyCode: string;        // camelCase
  displayName: string;        // camelCase
  role: 'BOARD' | 'COLLABORATOR';
  createdAt: string;
  lastLoginAt?: string;
}

// /tasks/* 返回（字段名严格 camelCase）
interface OrgTask {
  id: string;
  type: 'BUY' | 'SELL' | 'SHIP' | 'LOAN';
  contractJson: TaskContractJson;  // camelCase，后端 D1 存 TEXT 需 JSON.parse
  status: 'PUBLISHED' | 'AWAITING_CONTRACT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  publisherId: string;
  publisherUsername: string;
  publisherCompanyCode: string;
  claimerId?: string;
  claimerUsername?: string;
  claimerCompanyCode?: string;
  contractId?: string;
  contractCreator?: 'publisher' | 'claimer';
  expiresAt?: string;
  createdAt: string;
  publishedAt?: string;
  claimedAt?: string;
  inProgressAt?: string;       // camelCase（不是 in_progress_at）
  completedAt?: string;
  cancelledAt?: string;
  updatedAt: string;
}

// contractJson 结构
interface TaskContractJson {
  template: 'BUY' | 'SELL' | 'SHIP';
  currency: string;
  name?: string;
  location?: string;
  origin?: string;
  destination?: string;
  price?: number;
  deadline?: number;
  items: Array<{ commodity: string; amount: number; price?: number }>;
}

// /tasks/:id/notes 返回
interface TaskNote {
  id: string;
  taskId: string;
  authorId: string;
  authorUsername: string;
  content: string;
  createdAt: string;
}

// /board/invite-codes 返回
interface InviteCode {
  id: string;
  code: string;
  createdBy: string;
  createdAt: string;
  usedByUserId?: string;
  usedAt?: string;
  revokedAt?: string;
}

// /board/audit-logs 返回
interface AuditLog {
  id: string;
  actorType: 'user' | 'admin' | 'system';
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// /board/stats 返回
interface OrgStats {
  userCount: number;
  taskCount: number;
  boardCount: number;
  collaboratorCount: number;
  tasksByStatus: Record<string, number>;
}
```

⚠️ **D1 表用 snake_case 列名（`prun_username`），但 API 响应必须返回 camelCase**。在 repository 层做映射（参考 §0.7）。

### 0.6 任务状态机（与客户端 contract-link.ts 严格对齐）

```
PUBLISHED → AWAITING_CONTRACT → IN_PROGRESS → COMPLETED
                ↓                    ↓
            PUBLISHED             CANCELLED
                ↓
            CANCELLED
PUBLISHED → CANCELLED（直接取消）
```

转移规则：
- `claim`：PUBLISHED → AWAITING_CONTRACT（设置 claimer_id/claimer_username/claimer_company_code/claimed_at/contractCreator）
- `release`：AWAITING_CONTRACT → PUBLISHED（清空 claimer 字段）
- `link-contract`：仅在 AWAITING_CONTRACT 状态接受 contractId，**不改变状态**（仅记录 contractId + contractCreator）
- `sync-status`：根据合同状态映射推进（CLOSED→IN_PROGRESS、FULFILLED→COMPLETED、CANCELLED/BREACHED/TERMINATED→CANCELLED）
- `cancel`：PUBLISHED/AWAITING_CONTRACT/IN_PROGRESS → CANCELLED
- `COMPLETED`/`CANCELLED` 是终态

### 0.7 D1 列名 ↔ API 字段名映射规则

**所有 repository 层在返回数据前必须把 snake_case 转 camelCase**。建议统一的 row mapper 函数（完整代码见 Task 8）：

```ts
// src/db/mappers.ts
export function mapUser(row: UserRow): OrgUser {
  return {
    id: row.id,
    email: row.email,
    prunUsername: row.prun_username,
    companyCode: row.company_code,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? undefined,
  };
}

export function mapTask(row: TaskRow): OrgTask {
  return {
    id: row.id,
    type: row.type,
    contractJson: JSON.parse(row.contract_json),
    status: row.status,
    publisherId: row.publisher_id,
    publisherUsername: row.publisher_username,
    publisherCompanyCode: row.publisher_company_code,
    claimerId: row.claimer_id ?? undefined,
    claimerUsername: row.claimer_username ?? undefined,
    claimerCompanyCode: row.claimer_company_code ?? undefined,
    contractId: row.contract_id ?? undefined,
    contractCreator: row.contract_creator ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    inProgressAt: row.in_progress_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

// mapNote / mapInviteCode / mapAuditLog 同理（完整代码见 Task 8）
```

### 0.8 文件结构（独立仓库 `rprun-org-worker/`）

```
rprun-org-worker/
├── src/
│   ├── index.ts                      # Worker 入口：Hono app + Cron handler
│   ├── config.ts                     # Env 类型绑定（D1/KV/Secrets/Vars）
│   ├── routes/
│   │   ├── auth.ts                   # /auth/register /login /me /refresh /logout
│   │   ├── tasks.ts                  # /tasks CRUD + 状态转移
│   │   ├── notes.ts                  # （可选合并到 tasks.ts） /tasks/:id/notes
│   │   ├── board.ts                  # /board/invite-codes /users /stats /audit-logs
│   │   └── health.ts                 # GET /health
│   ├── middleware/
│   │   ├── jwt.ts                    # authMiddleware：JWT 验证 + req.user 注入
│   │   ├── board-only.ts             # boardOnly：校验 role=BOARD
│   │   ├── rate-limit.ts             # D1 表计数限流
│   │   └── error.ts                  # 全局错误处理（包装成 ApiError 格式）
│   ├── services/                     # 业务逻辑（无 Hono 依赖，可单元测试）
│   │   ├── auth-service.ts           # registerWithInvite / login / refresh / logout
│   │   ├── task-service.ts           # 状态转移 + 权限校验 + cancel
│   │   ├── contract-sync-service.ts  # 合同状态映射
│   │   ├── invite-service.ts         # 邀请码生成 + 批量
│   │   └── audit-service.ts          # 审计日志写入 + stats 聚合
│   ├── db/
│   │   ├── mappers.ts                # snake_case → camelCase
│   │   ├── migrations/
│   │   │   └── 001_init.sql          # 完整 schema
│   │   └── repositories/
│   │       ├── users.repo.ts
│   │       ├── invite-codes.repo.ts
│   │       ├── refresh-tokens.repo.ts
│   │       ├── tasks.repo.ts
│   │       ├── notes.repo.ts
│   │       ├── audit-logs.repo.ts
│   │       └── rate-limits.repo.ts
│   ├── utils/
│   │   ├── jwt.ts                    # signJWT / verifyJWT（HS256 + WebCrypto）
│   │   ├── password.ts               # hashPassword / verifyPassword（PBKDF2）
│   │   ├── invite-code.ts            # 10 字符 base32 生成
│   │   ├── id.ts                     # crypto.randomUUID
│   │   ├── base64url.ts              # base64url 编码/解码
│   │   ├── hex.ts                    # hex 编码/解码
│   │   ├── http-error.ts             # HttpError 类
│   │   └── validation.ts             # Zod schema
│   └── types.ts                      # 与客户端 types.ts 人工同步（API 形状）
├── tests/                            # Vitest + Miniflare
│   ├── setup.ts                      # 测试环境 schema 应用 + 表清理
│   ├── jwt.test.ts
│   ├── password.test.ts
│   ├── invite-code.test.ts
│   └── integration.test.ts           # 端到端：注册→登录→发布→接取→link→sync→cancel
├── wrangler.toml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md                         # 部署 + 引导流程
```

---

## Task 1: 项目骨架 + wrangler.toml + tsconfig

**Files:**
- Create: `rprun-org-worker/package.json`
- Create: `rprun-org-worker/wrangler.toml`
- Create: `rprun-org-worker/tsconfig.json`
- Create: `rprun-org-worker/.gitignore`
- Create: `rprun-org-worker/README.md`

- [ ] **Step 1: 创建项目目录**

```bash
mkdir -p rprun-org-worker
cd rprun-org-worker
git init
```

> 后端仓库与 rprun 扩展仓库完全分离。可以选择放在 `rprun-org-worker/` 作为 rprun 仓库的子目录（同 monorepo 不同包），或完全独立仓库。**推荐独立仓库**：单独 GitHub repo，单独部署，types 通过人工同步。

- [ ] **Step 2: 写 `package.json`**

```json
{
  "name": "rprun-org-worker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "wrangler d1 execute rprun-org-db --file=src/db/migrations/001_init.sql",
    "db:migrate:local": "wrangler d1 execute rprun-org-db --local --file=src/db/migrations/001_init.sql"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240909.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 3: 写 `wrangler.toml`**

```toml
name = "rprun-org-api"
main = "src/index.ts"
compatibility_date = "2026-07-01"
compatibility_flags = ["nodejs_compat"]

# D1 数据库绑定
[[d1_databases]]
binding = "DB"
database_name = "rprun-org-db"
database_id = "<用 wrangler d1 create 生成后填入>"

# KV 命名空间绑定（预留给未来会话黑名单等低频写场景；当前限流用 D1 表）
[[kv_namespaces]]
binding = "KV"
id = "<用 wrangler kv:namespace create 生成后填入>"

# Cron Triggers：每 5 分钟清理过期任务 + rate_limit_buckets
[triggers]
crons = ["*/5 * * * *"]

# 非敏感环境变量
[vars]
ENV = "production"
JWT_ACCESS_TTL = "900"
JWT_REFRESH_TTL = "604800"
RATE_LIMIT_REGISTER_PER_HOUR = "5"
RATE_LIMIT_LOGIN_PER_HOUR = "20"
POLL_INTERVAL_ADVICE = "30"

# 敏感 secrets 用 wrangler secret put 设置：
# wrangler secret put JWT_SECRET            # 32+ 字节随机
# wrangler secret put REFRESH_TOKEN_SECRET  # 32+ 字节随机
```

- [ ] **Step 4: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 5: 写 `.gitignore`**

```
node_modules/
dist/
.wrangler/
.dev.vars
*.log
.env
.env.local
```

- [ ] **Step 6: 写 `README.md`**（最简骨架，Task 22 会重写为完整部署指南）

```markdown
# rprun-org-worker

ORG 后端 API（Cloudflare Workers + D1 + KV + Cron Triggers）。
为 Refined PrUn 浏览器扩展的 XIT ORG 面板服务。

## 开发

\`\`\`bash
pnpm install
pnpm db:migrate:local   # 初始化本地 D1
pnpm dev                # 启动本地 wrangler dev（默认 127.0.0.1:8787）
\`\`\`

## 测试

\`\`\`bash
pnpm test
\`\`\`
```

- [ ] **Step 7: 初始化 git + 首次提交**

```bash
git add .
git commit -m "chore: scaffold rprun-org-worker project"
```

---

## Task 2: 共享类型 + Env 配置

**Files:**
- Create: `rprun-org-worker/src/types.ts`
- Create: `rprun-org-worker/src/config.ts`

- [ ] **Step 1: 写 `src/types.ts`**（与客户端 `types.ts` 字段名完全一致）

```ts
// src/types.ts
// 与 rprun 扩展 src/infrastructure/org-api/types.ts 人工同步。
// 修改任一处都必须同步另一处。

export type UserRole = 'BOARD' | 'COLLABORATOR';
export type TaskType = 'BUY' | 'SELL' | 'SHIP' | 'LOAN';
export type TaskStatus = 'PUBLISHED' | 'AWAITING_CONTRACT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type ContractCreator = 'publisher' | 'claimer';

export interface OrgUser {
  id: string;
  email: string;
  prunUsername: string;
  companyCode: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string;
}

export interface TaskContractItem {
  commodity: string;
  amount: number;
  price?: number;
}

export interface TaskContractJson {
  template: 'BUY' | 'SELL' | 'SHIP';
  currency: string;
  name?: string;
  location?: string;
  origin?: string;
  destination?: string;
  price?: number;
  deadline?: number;
  items: TaskContractItem[];
}

export interface OrgTask {
  id: string;
  type: TaskType;
  contractJson: TaskContractJson;
  status: TaskStatus;
  publisherId: string;
  publisherUsername: string;
  publisherCompanyCode: string;
  claimerId?: string;
  claimerUsername?: string;
  claimerCompanyCode?: string;
  contractId?: string;
  contractCreator?: ContractCreator;
  expiresAt?: string;
  createdAt: string;
  publishedAt?: string;
  claimedAt?: string;
  inProgressAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  updatedAt: string;
}

export interface TaskNote {
  id: string;
  taskId: string;
  authorId: string;
  authorUsername: string;
  content: string;
  createdAt: string;
}

export interface InviteCode {
  id: string;
  code: string;
  createdBy: string;
  createdAt: string;
  usedByUserId?: string;
  usedAt?: string;
  revokedAt?: string;
}

export interface AuditLog {
  id: string;
  actorType: 'user' | 'admin' | 'system';
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: OrgUser;
}

export interface ApiError {
  error: { code: string; message: string };
}

export type PollScope = 'board' | 'published' | 'claimed';

// PrUn 合同状态（大写，与客户端 types.ts 对齐）
export type PrunContractStatus =
  | 'OPEN' | 'CLOSED' | 'CANCELLED' | 'FULFILLED'
  | 'PARTIALLY_FULFILLED' | 'REJECTED' | 'DEADLINE_EXCEEDED'
  | 'BREACHED' | 'TERMINATED';

// JWT payload
export interface JwtPayload {
  sub: string;
  prun_username: string;
  company_code: string;
  role: UserRole;
  iat: number;
  exp: number;
}

// Hono Context variables（authMiddleware 注入）
export interface ContextVars {
  user: {
    sub: string;
    prun_username: string;
    company_code: string;
    role: UserRole;
  };
  // 便捷字段：等价于 user.sub，路由层直接 c.var.userId 取用
  userId: string;
  prunUsername: string;
  companyCode: string;
  role: UserRole;
}
```

- [ ] **Step 2: 写 `src/config.ts`**

```ts
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
```

- [ ] **Step 3: 验证编译**

```bash
pnpm install
pnpm compile
```

Expected: PASS（无错误，可能有 unused warning，可忽略）

- [ ] **Step 4: 提交**

```bash
git add src/types.ts src/config.ts
git commit -m "feat: add shared types and Env config"
```

---

## Task 3: 工具函数（base64url + id + http-error）

**Files:**
- Create: `rprun-org-worker/src/utils/base64url.ts`
- Create: `rprun-org-worker/src/utils/id.ts`
- Create: `rprun-org-worker/src/utils/http-error.ts`

- [ ] **Step 1: 写 `src/utils/base64url.ts`**

```ts
// src/utils/base64url.ts
// WebCrypto 处理 ArrayBuffer，需要 base64url 编解码用于 JWT

export function base64urlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlEncodeStr(s: string): string {
  return base64urlEncode(new TextEncoder().encode(s));
}

export function base64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const base64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function base64urlDecodeStr(s: string): string {
  return new TextDecoder().decode(base64urlDecode(s));
}
```

- [ ] **Step 2: 写 `src/utils/id.ts`**

```ts
// src/utils/id.ts
// crypto.randomUUID 在 Workers 中可用，返回 v4 UUID
export function generateId(): string {
  return crypto.randomUUID();
}
```

- [ ] **Step 3: 写 `src/utils/http-error.ts`**

```ts
// src/utils/http-error.ts
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }

  toApiError() {
    return { error: { code: this.code, message: this.message } };
  }
}

// 常用错误快捷构造（参数顺序统一为 code, message, status）
export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not Found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

// 通用 API 错误构造（路由层用 throw apiError(...) 抛错；errorHandler 统一捕获）
// 参数顺序：code, message, status（与 HttpError 构造器相反，便于路由层阅读）
export const apiError = (code: string, message: string, status: number): HttpError =>
  new HttpError(status, code, message);
```

- [ ] **Step 4: 验证编译 + 提交**

```bash
pnpm compile
git add src/utils/
git commit -m "feat: add base64url/id/http-error utils"
```

---

## Task 4: JWT 工具（HS256 + WebCrypto）

**Files:**
- Create: `rprun-org-worker/src/utils/jwt.ts`
- Create: `rprun-org-worker/tests/jwt.test.ts`
- Create: `rprun-org-worker/vitest.config.ts`

- [ ] **Step 1: 写 `src/utils/jwt.ts`**

```ts
// src/utils/jwt.ts
import { base64urlEncode, base64urlEncodeStr, base64urlDecode, base64urlDecodeStr } from './base64url';
import type { JwtPayload } from '../types';

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signJWT(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const headerB64 = base64urlEncodeStr(JSON.stringify(header));
  const payloadB64 = base64urlEncodeStr(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return `${data}.${base64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JwtPayload | null> {
  const [headerB64, payloadB64, sigB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) return null;
  const key = await hmacKey(secret);
  const sigBytes = base64urlDecode(sigB64);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    encoder.encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecodeStr(payloadB64));
  } catch {
    return null;
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}
```

- [ ] **Step 2: 写 `tests/jwt.test.ts`**

```ts
// tests/jwt.test.ts
import { describe, it, expect } from 'vitest';
import { signJWT, verifyJWT } from '../src/utils/jwt';

describe('jwt', () => {
  it('signs and verifies a valid token', async () => {
    const token = await signJWT(
      { sub: 'u1', prun_username: 'alice', company_code: 'ALICE', role: 'COLLABORATOR' },
      'secret',
      60,
    );
    const payload = await verifyJWT(token, 'secret');
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('u1');
    expect(payload?.role).toBe('COLLABORATOR');
  });

  it('rejects token with wrong secret', async () => {
    const token = await signJWT(
      { sub: 'u1', prun_username: 'alice', company_code: 'ALICE', role: 'BOARD' },
      'secret',
      60,
    );
    const payload = await verifyJWT(token, 'wrong');
    expect(payload).toBeNull();
  });

  it('rejects expired token', async () => {
    const token = await signJWT(
      { sub: 'u1', prun_username: 'alice', company_code: 'ALICE', role: 'BOARD' },
      'secret',
      -10, // 已过期
    );
    const payload = await verifyJWT(token, 'secret');
    expect(payload).toBeNull();
  });

  it('rejects malformed token', async () => {
    const payload = await verifyJWT('not.a.jwt', 'secret');
    expect(payload).toBeNull();
  });
});
```

- [ ] **Step 3: 配置 `vitest.config.ts`**（用 workers pool 跑测试，确保 WebCrypto / D1 / KV 可用）

```ts
// vitest.config.ts
// 一次配置覆盖所有测试（jwt 单测 + 集成测试），Task 21 不再重复创建
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
        },
      },
    },
    // 集成测试的 setup 文件由 Task 21 创建；Task 4 阶段如文件不存在 vitest 会忽略
    setupFiles: ['./tests/setup.ts'],
  },
});
```

> ⚠️ **Task 4 阶段**：`./tests/setup.ts` 此时尚未创建。Vitest 在 `setupFiles` 找不到文件时会报错。如果先单独跑 Task 4 的 jwt 测试，可临时把 `setupFiles` 注释掉；Task 21 完成后该配置即生效。

- [ ] **Step 4: 运行测试**

```bash
pnpm test
```

Expected: 4 个 jwt 测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/utils/jwt.ts tests/jwt.test.ts vitest.config.ts
git commit -m "feat: add JWT sign/verify utils with WebCrypto"
```

---

## Task 5: 密码哈希（PBKDF2 + WebCrypto）

**Files:**
- Create: `rprun-org-worker/src/utils/password.ts`
- Create: `rprun-org-worker/src/utils/hex.ts`
- Create: `rprun-org-worker/tests/password.test.ts`

- [ ] **Step 1: 写 `src/utils/hex.ts`**

```ts
// src/utils/hex.ts
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
```

- [ ] **Step 2: 写 `src/utils/password.ts`**

```ts
// src/utils/password.ts
import { toHex, fromHex } from './hex';

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    HASH_BITS,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(new Uint8Array(hash))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterStr, saltHex, hashHex] = stored.split('$');
  if (algo !== 'pbkdf2') return false;
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: parseInt(iterStr, 10), hash: 'SHA-256' },
    key,
    HASH_BITS,
  );
  return toHex(new Uint8Array(hash)) === hashHex;
}
```

- [ ] **Step 3: 写测试 `tests/password.test.ts`**

```ts
// tests/password.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password';

describe('password', () => {
  it('hashes and verifies correct password', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('hunter2', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('hunter2');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces different hashes for same password (random salt)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});
```

- [ ] **Step 4: 运行测试 + 提交**

```bash
pnpm test
git add src/utils/password.ts src/utils/hex.ts tests/password.test.ts
git commit -m "feat: add PBKDF2 password hashing"
```

---

## Task 6: 邀请码生成

**Files:**
- Create: `rprun-org-worker/src/utils/invite-code.ts`
- Create: `rprun-org-worker/tests/invite-code.test.ts`

- [ ] **Step 1: 写 `src/utils/invite-code.ts`**

```ts
// src/utils/invite-code.ts
// 10 字符 base32（[A-Z2-9]，去除易混淆的 0/O/1/I/L）
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

export function generateInviteCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateInviteCode());
  }
  return [...codes];
}
```

- [ ] **Step 2: 写测试 `tests/invite-code.test.ts`**

```ts
// tests/invite-code.test.ts
import { describe, it, expect } from 'vitest';
import { generateInviteCode, generateInviteCodes } from '../src/utils/invite-code';

describe('invite-code', () => {
  it('generates 10-char code from valid alphabet', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(10);
    expect(code).toMatch(/^[A-Z2-9]+$/);
    // 不含易混淆字符
    expect(code).not.toMatch(/[01OIL]/);
  });

  it('generates unique codes', () => {
    const codes = generateInviteCodes(20);
    expect(new Set(codes).size).toBe(20);
  });
});
```

- [ ] **Step 3: 运行测试 + 提交**

```bash
pnpm test
git add src/utils/invite-code.ts tests/invite-code.test.ts
git commit -m "feat: add invite code generator"
```

---

## Task 7: D1 Schema + Migrations

**Files:**
- Create: `rprun-org-worker/src/db/migrations/001_init.sql`

- [ ] **Step 1: 写 `src/db/migrations/001_init.sql`**（完整 schema，与架构 §12.4 一致）

```sql
-- ============ 001_init.sql ============

-- users 表
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  prun_username   TEXT NOT NULL,
  company_code    TEXT NOT NULL,
  display_name    TEXT NOT NULL DEFAULT prun_username,
  role            TEXT NOT NULL DEFAULT 'COLLABORATOR'
                  CHECK (role IN ('BOARD','COLLABORATOR')),
  invite_code_id  TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT,
  UNIQUE (prun_username, company_code)
);
CREATE INDEX idx_users_username_company ON users (prun_username, company_code);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role ON users (role);

-- invite_codes 表
CREATE TABLE IF NOT EXISTS invite_codes (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  used_by_user_id TEXT UNIQUE,
  used_at         TEXT,
  revoked_at      TEXT
);
CREATE INDEX idx_invite_codes_code ON invite_codes (code);

-- refresh_tokens 表
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at      TEXT
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- tasks 表
CREATE TABLE IF NOT EXISTS tasks (
  id                     TEXT PRIMARY KEY,
  type                   TEXT NOT NULL CHECK (type IN ('BUY','SELL','SHIP','LOAN')),
  contract_json          TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'PUBLISHED'
                         CHECK (status IN ('PUBLISHED','AWAITING_CONTRACT','IN_PROGRESS','COMPLETED','CANCELLED')),
  publisher_id           TEXT NOT NULL REFERENCES users(id),
  publisher_username     TEXT NOT NULL,
  publisher_company_code TEXT NOT NULL,
  claimer_id             TEXT REFERENCES users(id),
  claimer_username       TEXT,
  claimer_company_code   TEXT,
  contract_id            TEXT UNIQUE,
  contract_creator       TEXT CHECK (contract_creator IN ('publisher','claimer')),
  expires_at             TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  published_at           TEXT,
  claimed_at             TEXT,
  in_progress_at         TEXT,
  completed_at           TEXT,
  cancelled_at           TEXT,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_publisher_status ON tasks (publisher_id, status);
CREATE INDEX idx_tasks_claimer_status ON tasks (claimer_id, status);
CREATE INDEX idx_tasks_type_status ON tasks (type, status);
CREATE INDEX idx_tasks_contract_id ON tasks (contract_id);
CREATE INDEX idx_tasks_updated_at ON tasks (updated_at);

-- task_notes 表
CREATE TABLE IF NOT EXISTS task_notes (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id       TEXT NOT NULL REFERENCES users(id),
  author_username TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_notes_task_created ON task_notes (task_id, created_at);

-- audit_logs 表
CREATE TABLE IF NOT EXISTS audit_logs (
  id              TEXT PRIMARY KEY,
  actor_type      TEXT NOT NULL,
  actor_id        TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_type, actor_id);

-- rate_limit_buckets 表（替代 KV 限流）
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_rate_limit_expires ON rate_limit_buckets (expires_at);

-- updated_at 触发器
CREATE TRIGGER IF NOT EXISTS trg_tasks_touch_updated_at
  AFTER UPDATE ON tasks
  FOR EACH ROW
  BEGIN
    UPDATE tasks SET updated_at = datetime('now') WHERE id = OLD.id;
  END;
```

- [ ] **Step 2: 应用本地迁移**

```bash
pnpm db:migrate:local
```

Expected: 输出 `✅ Executed ... statements`，无错误。

- [ ] **Step 3: 提交**

```bash
git add src/db/migrations/001_init.sql
git commit -m "feat: add D1 schema migrations"
```

---

## Task 8: Row Mappers（snake_case ↔ camelCase）

**Files:**
- Create: `rprun-org-worker/src/db/mappers.ts`

- [ ] **Step 1: 写 `src/db/mappers.ts`**

```ts
// src/db/mappers.ts
import type {
  OrgUser, OrgTask, TaskNote, InviteCode, AuditLog,
} from '../types';

// D1 行类型（snake_case，与 schema 对齐）
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  prun_username: string;
  company_code: string;
  display_name: string;
  role: 'BOARD' | 'COLLABORATOR';
  invite_code_id: string;
  created_at: string;
  last_login_at: string | null;
}

export interface TaskRow {
  id: string;
  type: 'BUY' | 'SELL' | 'SHIP' | 'LOAN';
  contract_json: string;
  status: 'PUBLISHED' | 'AWAITING_CONTRACT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  publisher_id: string;
  publisher_username: string;
  publisher_company_code: string;
  claimer_id: string | null;
  claimer_username: string | null;
  claimer_company_code: string | null;
  contract_id: string | null;
  contract_creator: 'publisher' | 'claimer' | null;
  expires_at: string | null;
  created_at: string;
  published_at: string | null;
  claimed_at: string | null;
  in_progress_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  task_id: string;
  author_id: string;
  author_username: string;
  content: string;
  created_at: string;
}

export interface InviteCodeRow {
  id: string;
  code: string;
  created_by: string;
  created_at: string;
  used_by_user_id: string | null;
  used_at: string | null;
  revoked_at: string | null;
}

export interface AuditLogRow {
  id: string;
  actor_type: 'user' | 'admin' | 'system';
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: string | null;
  created_at: string;
}

export function mapUser(row: UserRow): OrgUser {
  return {
    id: row.id,
    email: row.email,
    prunUsername: row.prun_username,
    companyCode: row.company_code,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? undefined,
  };
}

export function mapTask(row: TaskRow): OrgTask {
  return {
    id: row.id,
    type: row.type,
    contractJson: JSON.parse(row.contract_json),
    status: row.status,
    publisherId: row.publisher_id,
    publisherUsername: row.publisher_username,
    publisherCompanyCode: row.publisher_company_code,
    claimerId: row.claimer_id ?? undefined,
    claimerUsername: row.claimer_username ?? undefined,
    claimerCompanyCode: row.claimer_company_code ?? undefined,
    contractId: row.contract_id ?? undefined,
    contractCreator: row.contract_creator ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    inProgressAt: row.in_progress_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

export function mapNote(row: NoteRow): TaskNote {
  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    authorUsername: row.author_username,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function mapInviteCode(row: InviteCodeRow): InviteCode {
  return {
    id: row.id,
    code: row.code,
    createdBy: row.created_by,
    createdAt: row.created_at,
    usedByUserId: row.used_by_user_id ?? undefined,
    usedAt: row.used_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
  };
}

export function mapAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id ?? undefined,
    action: row.action,
    targetType: row.target_type ?? undefined,
    targetId: row.target_id ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 2: 验证编译 + 提交**

```bash
pnpm compile
git add src/db/mappers.ts
git commit -m "feat: add D1 row mappers"
```

---

## Task 9: Repositories（数据访问层）

**Files:**
- Create: `rprun-org-worker/src/db/repositories/users.repo.ts`
- Create: `rprun-org-worker/src/db/repositories/invite-codes.repo.ts`
- Create: `rprun-org-worker/src/db/repositories/refresh-tokens.repo.ts`
- Create: `rprun-org-worker/src/db/repositories/tasks.repo.ts`
- Create: `rprun-org-worker/src/db/repositories/notes.repo.ts`
- Create: `rprun-org-worker/src/db/repositories/audit-logs.repo.ts`
- Create: `rprun-org-worker/src/db/repositories/rate-limits.repo.ts`

- [ ] **Step 1: 写 `users.repo.ts`**

```ts
// src/db/repositories/users.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapUser, type UserRow } from '../mappers';
import type { OrgUser, UserRole } from '../../types';

export async function findUserById(db: D1Database, id: string): Promise<OrgUser | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
}

export async function listAllUsers(db: D1Database): Promise<OrgUser[]> {
  const result = await db.prepare('SELECT * FROM users ORDER BY created_at ASC').all<UserRow>();
  return (result.results ?? []).map(mapUser);
}

export async function updateUserRole(
  db: D1Database,
  userId: string,
  role: UserRole,
): Promise<void> {
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run();
}

export async function touchUserLogin(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?")
    .bind(userId)
    .run();
}

export async function countUsersByRole(
  db: D1Database,
): Promise<{ boardCount: number; collaboratorCount: number; total: number }> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN role = 'BOARD' THEN 1 ELSE 0 END) AS boardCount,
         SUM(CASE WHEN role = 'COLLABORATOR' THEN 1 ELSE 0 END) AS collaboratorCount
       FROM users`,
    )
    .first<{ total: number; boardCount: number; collaboratorCount: number }>();
  return {
    total: row?.total ?? 0,
    boardCount: row?.boardCount ?? 0,
    collaboratorCount: row?.collaboratorCount ?? 0,
  };
}
```

- [ ] **Step 2: 写 `invite-codes.repo.ts`**

```ts
// src/db/repositories/invite-codes.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapInviteCode, type InviteCodeRow } from '../mappers';
import type { InviteCode } from '../../types';
import { generateId } from '../../utils/id';
import { generateInviteCode } from '../../utils/invite-code';

export async function createInviteCodes(
  db: D1Database,
  count: number,
  createdBy: string,
): Promise<InviteCode[]> {
  const created: InviteCode[] = [];
  for (let i = 0; i < count; i++) {
    const id = generateId();
    const code = generateInviteCode();
    await db
      .prepare('INSERT INTO invite_codes (id, code, created_by) VALUES (?, ?, ?)')
      .bind(id, code, createdBy)
      .run();
    const row = await db
      .prepare('SELECT * FROM invite_codes WHERE id = ?')
      .bind(id)
      .first<InviteCodeRow>();
    if (row) {
      created.push(mapInviteCode(row));
    }
  }
  return created;
}

export async function listInviteCodes(db: D1Database): Promise<InviteCode[]> {
  const result = await db
    .prepare('SELECT * FROM invite_codes ORDER BY created_at DESC')
    .all<InviteCodeRow>();
  return (result.results ?? []).map(mapInviteCode);
}

export async function findInviteCodeById(db: D1Database, id: string): Promise<InviteCode | null> {
  const row = await db
    .prepare('SELECT * FROM invite_codes WHERE id = ?')
    .bind(id)
    .first<InviteCodeRow>();
  return row ? mapInviteCode(row) : null;
}

export async function revokeInviteCode(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE invite_codes SET revoked_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
}
```

- [ ] **Step 3: 写 `refresh-tokens.repo.ts`**

```ts
// src/db/repositories/refresh-tokens.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { generateId } from '../../utils/id';

// 仅存 hash，不存明文；返回明文给客户端
export async function issueRefreshToken(
  db: D1Database,
  userId: string,
  ttlSeconds: number,
  hashFn: (token: string) => Promise<string>,
): Promise<{ token: string; expiresAt: string }> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const tokenHash = await hashFn(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await db
    .prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    )
    .bind(generateId(), userId, tokenHash, expiresAt)
    .run();
  return { token, expiresAt };
}

export async function findRefreshTokenByHash(
  db: D1Database,
  hash: string,
): Promise<{ id: string; userId: string; expiresAt: string; revokedAt: string | null } | null> {
  const row = await db
    .prepare('SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?')
    .bind(hash)
    .first<{ id: string; user_id: string; expires_at: string; revoked_at: string | null }>();
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export async function revokeRefreshToken(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
}
```

- [ ] **Step 4: 写 `tasks.repo.ts`**

```ts
// src/db/repositories/tasks.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapTask, type TaskRow } from '../mappers';
import type { OrgTask, TaskContractJson, TaskType, PollScope } from '../../types';
import { generateId } from '../../utils/id';

export interface ListTasksFilter {
  scope: PollScope;
  userId: string;
  type?: TaskType;
  publisherUsername?: string;
  claimerUsername?: string;
  location?: string;
  since?: string;
  limit?: number;
  cursor?: string;
}

export interface ListTasksResult {
  items: OrgTask[];
  nextCursor: string | null;
}

// cursor = base64(JSON.stringify({ ts: ISO, id: taskId }))
// 配合 ORDER BY updated_at DESC, id DESC 做 keyset 分页
function decodeCursor(cursor: string): { ts: string; id: string } | null {
  try {
    const json = atob(cursor);
    const parsed = JSON.parse(json);
    if (typeof parsed.ts === 'string' && typeof parsed.id === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(ts: string, id: string): string {
  return btoa(JSON.stringify({ ts, id }));
}

export async function listTasks(
  db: D1Database,
  filter: ListTasksFilter,
): Promise<ListTasksResult> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (filter.scope === 'board') {
    where.push("status = 'PUBLISHED'");
    if (filter.type) {
      where.push('type = ?');
      binds.push(filter.type);
    }
    if (filter.publisherUsername) {
      where.push('publisher_username = ?');
      binds.push(filter.publisherUsername);
    }
    if (filter.claimerUsername) {
      where.push('claimer_username = ?');
      binds.push(filter.claimerUsername);
    }
    if (filter.location) {
      where.push('contract_json LIKE ?');
      binds.push(`%"location":"${filter.location}"%`);
    }
  } else if (filter.scope === 'published') {
    where.push('publisher_id = ?');
    binds.push(filter.userId);
    if (filter.type) {
      where.push('type = ?');
      binds.push(filter.type);
    }
    if (filter.claimerUsername) {
      where.push('claimer_username = ?');
      binds.push(filter.claimerUsername);
    }
  } else {
    // claimed：按当前用户过滤
    where.push('claimer_id = ?');
    binds.push(filter.userId);
  }

  if (filter.since) {
    where.push('updated_at > ?');
    binds.push(filter.since);
  }

  // cursor 分页：取 (updated_at, id) 在 cursor 之前的记录
  if (filter.cursor) {
    const c = decodeCursor(filter.cursor);
    if (c) {
      where.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
      binds.push(c.ts, c.ts, c.id);
    }
  }

  const limit = filter.limit ?? 100;
  // 多取 1 条用于判断是否还有下一页
  binds.push(limit + 1);

  const sql = `SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...binds).all<TaskRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.updated_at, last.id) : null;
  return { items: items.map(mapTask), nextCursor };
}

export async function findTaskById(db: D1Database, id: string): Promise<OrgTask | null> {
  const row = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  return row ? mapTask(row) : null;
}

export async function findTaskRowById(db: D1Database, id: string): Promise<TaskRow | null> {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
}

export interface CreateTaskInput {
  type: TaskType;
  contractJson: TaskContractJson;
  publisherId: string;
  publisherUsername: string;
  publisherCompanyCode: string;
  expiresAt?: string;
}

export async function createTask(db: D1Database, input: CreateTaskInput): Promise<OrgTask> {
  const id = generateId();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tasks (
         id, type, contract_json, status,
         publisher_id, publisher_username, publisher_company_code,
         expires_at, created_at, published_at, updated_at
       ) VALUES (?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.type,
      JSON.stringify(input.contractJson),
      input.publisherId,
      input.publisherUsername,
      input.publisherCompanyCode,
      input.expiresAt ?? null,
      now,
      now,
      now,
    )
    .run();
  const task = await findTaskById(db, id);
  if (!task) throw new Error('Task creation failed: row not found after insert');
  return task;
}

export async function updateTaskContractJson(
  db: D1Database,
  taskId: string,
  contractJson: TaskContractJson,
  expiresAt?: string,
): Promise<void> {
  if (expiresAt !== undefined) {
    await db
      .prepare('UPDATE tasks SET contract_json = ?, expires_at = ? WHERE id = ?')
      .bind(JSON.stringify(contractJson), expiresAt, taskId)
      .run();
  } else {
    await db
      .prepare('UPDATE tasks SET contract_json = ? WHERE id = ?')
      .bind(JSON.stringify(contractJson), taskId)
      .run();
  }
}

export async function claimTask(
  db: D1Database,
  taskId: string,
  claimerId: string,
  claimerUsername: string,
  claimerCompanyCode: string,
  contractCreator: 'publisher' | 'claimer',
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks
       SET status = 'AWAITING_CONTRACT',
           claimer_id = ?, claimer_username = ?, claimer_company_code = ?,
           contract_creator = ?, claimed_at = ?
       WHERE id = ?`,
    )
    .bind(claimerId, claimerUsername, claimerCompanyCode, contractCreator, now, taskId)
    .run();
}

export async function releaseTask(db: D1Database, taskId: string): Promise<void> {
  // 释放后任务重新进入 PUBLISHED：重置 published_at 以便客户端"最新发布"排序
  // （trigger trg_tasks_touch_updated_at 已自动更新 updated_at）
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks
       SET status = 'PUBLISHED',
           claimer_id = NULL, claimer_username = NULL, claimer_company_code = NULL,
           contract_creator = NULL, claimed_at = NULL,
           published_at = ?
       WHERE id = ?`,
    )
    .bind(now, taskId)
    .run();
}

export async function linkContract(
  db: D1Database,
  taskId: string,
  contractId: string,
  contractCreator: 'publisher' | 'claimer',
): Promise<void> {
  await db
    .prepare('UPDATE tasks SET contract_id = ?, contract_creator = ? WHERE id = ?')
    .bind(contractId, contractCreator, taskId)
    .run();
}

export async function setTaskStatus(
  db: D1Database,
  taskId: string,
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
): Promise<void> {
  const now = new Date().toISOString();
  const fieldMap = {
    IN_PROGRESS: 'in_progress_at',
    COMPLETED: 'completed_at',
    CANCELLED: 'cancelled_at',
  } as const;
  await db
    .prepare(
      `UPDATE tasks SET status = ?, ${fieldMap[status]} = ? WHERE id = ?`,
    )
    .bind(status, now, taskId)
    .run();
}

export async function countTasksByStatus(
  db: D1Database,
): Promise<Record<string, number>> {
  const result = await db
    .prepare('SELECT status, COUNT(*) AS count FROM tasks GROUP BY status')
    .all<{ status: string; count: number }>();
  const map: Record<string, number> = {};
  for (const row of result.results ?? []) {
    map[row.status] = row.count;
  }
  return map;
}

export async function countAllTasks(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM tasks').first<{ count: number }>();
  return row?.count ?? 0;
}

// Cron Trigger 用：清理过期 PUBLISHED 任务
export async function expirePublishedTasks(db: D1Database, now: string): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE tasks
       SET status = 'CANCELLED', cancelled_at = ?
       WHERE status = 'PUBLISHED' AND expires_at IS NOT NULL AND expires_at < ?`,
    )
    .bind(now, now)
    .run();
  return result.meta.changes ?? 0;
}
```

- [ ] **Step 5: 写 `notes.repo.ts`**

```ts
// src/db/repositories/notes.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapNote, type NoteRow } from '../mappers';
import type { TaskNote } from '../../types';
import { generateId } from '../../utils/id';

export async function listNotesByTask(db: D1Database, taskId: string): Promise<TaskNote[]> {
  const result = await db
    .prepare('SELECT * FROM task_notes WHERE task_id = ? ORDER BY created_at ASC')
    .bind(taskId)
    .all<NoteRow>();
  return (result.results ?? []).map(mapNote);
}

export async function createNote(
  db: D1Database,
  taskId: string,
  authorId: string,
  authorUsername: string,
  content: string,
): Promise<TaskNote> {
  const id = generateId();
  await db
    .prepare(
      'INSERT INTO task_notes (id, task_id, author_id, author_username, content) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, taskId, authorId, authorUsername, content)
    .run();
  const row = await db
    .prepare('SELECT * FROM task_notes WHERE id = ?')
    .bind(id)
    .first<NoteRow>();
  if (!row) throw new Error('Note creation failed');
  return mapNote(row);
}
```

- [ ] **Step 6: 写 `audit-logs.repo.ts`**

```ts
// src/db/repositories/audit-logs.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapAuditLog, type AuditLogRow } from '../mappers';
import type { AuditLog } from '../../types';
import { generateId } from '../../utils/id';

export interface WriteAuditInput {
  actorType: 'user' | 'admin' | 'system';
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(db: D1Database, input: WriteAuditInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      generateId(),
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    )
    .run();
}

export interface ListAuditLogsFilter {
  limit?: number;
  cursor?: string;
  action?: string;
  actorId?: string;
}

export interface ListAuditLogsResult {
  items: AuditLog[];
  nextCursor: string | null;
}

// cursor = base64(JSON.stringify({ ts: ISO, id: logId }))
// 配合 ORDER BY created_at DESC, id DESC 做 keyset 分页
function decodeAuditCursor(cursor: string): { ts: string; id: string } | null {
  try {
    const json = atob(cursor);
    const parsed = JSON.parse(json);
    if (typeof parsed.ts === 'string' && typeof parsed.id === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeAuditCursor(ts: string, id: string): string {
  return btoa(JSON.stringify({ ts, id }));
}

export async function listAuditLogs(
  db: D1Database,
  filter: ListAuditLogsFilter,
): Promise<ListAuditLogsResult> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.action) {
    where.push('action = ?');
    binds.push(filter.action);
  }
  if (filter.actorId) {
    where.push('actor_id = ?');
    binds.push(filter.actorId);
  }
  if (filter.cursor) {
    const c = decodeAuditCursor(filter.cursor);
    if (c) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      binds.push(c.ts, c.ts, c.id);
    }
  }
  const limit = filter.limit ?? 100;
  binds.push(limit + 1);
  const sql = `SELECT * FROM audit_logs ${
    where.length ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY created_at DESC, id DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...binds).all<AuditLogRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeAuditCursor(last.created_at, last.id) : null;
  return { items: items.map(mapAuditLog), nextCursor };
}
```

- [ ] **Step 7: 写 `rate-limits.repo.ts`**

```ts
// src/db/repositories/rate-limits.repo.ts
import type { D1Database } from '@cloudflare/workers-types';

// 返回当前桶计数（自增后）
export async function incrementBucket(
  db: D1Database,
  bucketKey: string,
  windowSeconds: number,
): Promise<number> {
  const expiresAt = new Date(Date.now() + windowSeconds * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, count, expires_at)
       VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1`,
    )
    .bind(bucketKey, expiresAt)
    .run();
  const row = await db
    .prepare('SELECT count FROM rate_limit_buckets WHERE bucket_key = ?')
    .bind(bucketKey)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function cleanupExpiredBuckets(db: D1Database, now: string): Promise<number> {
  const result = await db
    .prepare('DELETE FROM rate_limit_buckets WHERE expires_at < ?')
    .bind(now)
    .run();
  return result.meta.changes ?? 0;
}
```

- [ ] **Step 8: 验证编译 + 提交**

```bash
pnpm compile
git add src/db/repositories/
git commit -m "feat: add D1 repositories for all entities"
```

---

## Task 10: 中间件（jwt + board-only + rate-limit + error）

**Files:**
- Create: `rprun-org-worker/src/middleware/jwt.ts`
- Create: `rprun-org-worker/src/middleware/board-only.ts`
- Create: `rprun-org-worker/src/middleware/rate-limit.ts`
- Create: `rprun-org-worker/src/middleware/error.ts`

- [ ] **Step 1: 写 `src/middleware/jwt.ts`**

```ts
// src/middleware/jwt.ts
import { createMiddleware } from 'hono/factory';
import { verifyJWT } from '../utils/jwt';
import { unauthorized } from '../utils/http-error';
import type { Env, ContextVars } from '../config';

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: ContextVars }>(
  async (c, next) => {
    const auth = c.req.header('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      throw unauthorized('Missing token');
    }
    const payload = await verifyJWT(auth.slice(7), c.env.JWT_SECRET);
    if (!payload) {
      throw unauthorized('Invalid token');
    }
    // 同时注入 user 对象与扁平便捷字段，路由层用 c.var.userId / c.var.prunUsername 等
    c.set('user', {
      sub: payload.sub,
      prun_username: payload.prun_username,
      company_code: payload.company_code,
      role: payload.role,
    });
    c.set('userId', payload.sub);
    c.set('prunUsername', payload.prun_username);
    c.set('companyCode', payload.company_code);
    c.set('role', payload.role);
    await next();
  },
);
```

- [ ] **Step 2: 写 `src/middleware/board-only.ts`**

```ts
// src/middleware/board-only.ts
import { createMiddleware } from 'hono/factory';
import { forbidden } from '../utils/http-error';
import type { Env, ContextVars } from '../config';

export const boardOnly = createMiddleware<{ Bindings: Env; Variables: ContextVars }>(
  async (c, next) => {
    const user = c.get('user');
    if (!user || user.role !== 'BOARD') {
      throw forbidden('Board members only');
    }
    await next();
  },
);
```

- [ ] **Step 3: 写 `src/middleware/rate-limit.ts`**

```ts
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
```

- [ ] **Step 4: 写 `src/middleware/error.ts`**

```ts
// src/middleware/error.ts
import type { ErrorHandler } from 'hono';
import type { Env } from '../config';
import { HttpError } from '../utils/http-error';

export const errorHandler: ErrorHandler<{ Bindings: Env }> = (err, c) => {
  if (err instanceof HttpError) {
    return c.json(err.toApiError(), err.status);
  }
  console.error('[unhandled error]', err);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    500,
  );
};
```

- [ ] **Step 5: 验证编译 + 提交**

```bash
pnpm compile
git add src/middleware/
git commit -m "feat: add jwt/board-only/rate-limit/error middleware"
```

---

## Task 11: Zod 校验 schema

**Files:**
- Create: `rprun-org-worker/src/utils/validation.ts`

- [ ] **Step 1: 写 `src/utils/validation.ts`**

```ts
// src/utils/validation.ts
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  inviteCode: z.string().regex(/^[A-Z2-9]{10}$/),
  prunUsername: z.string().min(1).max(64),
  companyCode: z.string().min(1).max(16),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const contractItemSchema = z.object({
  commodity: z.string().min(1).max(32),
  amount: z.number().int().positive(),
  price: z.number().nonnegative().optional(),
});

export const contractJsonSchema = z.object({
  template: z.enum(['BUY', 'SELL', 'SHIP']),
  currency: z.string().min(1).max(8),
  name: z.string().max(128).optional(),
  location: z.string().max(64).optional(),
  origin: z.string().max(64).optional(),
  destination: z.string().max(64).optional(),
  price: z.number().nonnegative().optional(),
  deadline: z.number().int().positive().optional(),
  items: z.array(contractItemSchema).min(1),
});

export const createTaskSchema = z.object({
  type: z.enum(['BUY', 'SELL', 'SHIP', 'LOAN']),
  contractJson: contractJsonSchema,
  expiresAt: z.string().datetime().optional(),
});

export const patchTaskSchema = z.object({
  contractJson: contractJsonSchema.optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const cancelTaskSchema = z.object({
  reason: z.string().max(512).optional(),
});

export const linkContractSchema = z.object({
  contractId: z.string().min(1).max(64),
  contractCreator: z.enum(['publisher', 'claimer']),
});

export const syncStatusSchema = z.object({
  contractStatus: z.enum([
    'OPEN', 'CLOSED', 'CANCELLED', 'FULFILLED',
    'PARTIALLY_FULFILLED', 'REJECTED', 'DEADLINE_EXCEEDED',
    'BREACHED', 'TERMINATED',
  ]),
});

export const createNoteSchema = z.object({
  content: z.string().min(1).max(4096),
});

export const generateInviteCodesSchema = z.object({
  count: z.number().int().min(1).max(50),
  createdBy: z.string().min(1).max(64),
});

// GET /tasks?scope=&type=&publisherUsername=&claimerUsername=&location=&since=&limit=&cursor=
export const listTasksQuerySchema = z.object({
  scope: z.enum(['board', 'published', 'claimed']),
  type: z.enum(['BUY', 'SELL', 'SHIP', 'LOAN']).optional(),
  publisherUsername: z.string().min(1).max(64).optional(),
  claimerUsername: z.string().min(1).max(64).optional(),
  location: z.string().min(1).max(64).optional(),
  since: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().min(1).max(64).optional(),
});

// GET /board/audit-logs?limit=&cursor=&action=&actorId=
export const listAuditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(64).optional(),
  actorId: z.string().min(1).max(64).optional(),
});
```

- [ ] **Step 2: 验证编译 + 提交**

```bash
pnpm compile
git add src/utils/validation.ts
git commit -m "feat: add Zod request validation schemas"
```

---

## Task 12: Auth Service（注册/登录/刷新/登出）

**Files:**
- Create: `rprun-org-worker/src/services/auth-service.ts`

- [ ] **Step 1: 写 `src/services/auth-service.ts`**

```ts
// src/services/auth-service.ts
import type { Env } from '../config';
import type { AuthSession, OrgUser } from '../types';
import { hashPassword, verifyPassword } from '../utils/password';
import { signJWT } from '../utils/jwt';
import { generateId } from '../utils/id';
import { getAccessTtl, getRefreshTtl } from '../config';
import { HttpError, badRequest, conflict, unauthorized } from '../utils/http-error';
import {
  findUserByEmail,
  findUserById,
  touchUserLogin,
} from '../db/repositories/users.repo';
import {
  findRefreshTokenByHash,
  issueRefreshToken,
  revokeRefreshToken,
} from '../db/repositories/refresh-tokens.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';
import { mapUser } from '../db/mappers';

async function hashRefreshToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function issueSession(env: Env, userId: string, user: OrgUser): Promise<AuthSession> {
  const accessToken = await signJWT(
    {
      sub: userId,
      prun_username: user.prunUsername,
      company_code: user.companyCode,
      role: user.role,
    },
    env.JWT_SECRET,
    getAccessTtl(env),
  );
  const { token: refreshToken } = await issueRefreshToken(
    env.DB,
    userId,
    getRefreshTtl(env),
    hashRefreshToken,
  );
  return { accessToken, refreshToken, user };
}

export interface RegisterParams {
  email: string;
  password: string;
  inviteCode: string;
  prunUsername: string;
  companyCode: string;
}

export async function registerWithInvite(env: Env, params: RegisterParams): Promise<AuthSession> {
  const { email, password, inviteCode, prunUsername, companyCode } = params;
  const passwordHash = await hashPassword(password);
  const userId = generateId();

  // D1 batch：单个事务保证原子性
  const statements = [
    // 1. 原子占用邀请码
    env.DB.prepare(
      `UPDATE invite_codes
       SET used_by_user_id = ?, used_at = datetime('now')
       WHERE code = ? AND used_by_user_id IS NULL AND revoked_at IS NULL`,
    ).bind(userId, inviteCode),

    // 2. 创建用户（INSERT 用子查询从 invite_codes 取 id；email/username UNIQUE 冲突会触发 batch 失败）
    env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, prun_username, company_code, invite_code_id)
       VALUES (?, ?, ?, ?, ?, (SELECT id FROM invite_codes WHERE code = ?))`,
    ).bind(userId, email, passwordHash, prunUsername, companyCode, inviteCode),

    // 3. 审计日志
    env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id)
       VALUES (?, 'user', ?, 'user.register', 'user', ?)`,
    ).bind(generateId(), userId, userId),
  ];

  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (err) {
    // UNIQUE 冲突（email 或 prun_username+company_code 已存在）
    const msg = String(err);
    if (msg.includes('users.email')) {
      throw conflict('EMAIL_EXISTS', 'Email already registered');
    }
    if (msg.includes('prun_username')) {
      throw conflict('USER_EXISTS', 'PrUn username + company code already registered');
    }
    throw new HttpError(500, 'INTERNAL_ERROR', 'Registration failed');
  }

  // 邀请码无效或已被抢用
  if (results[0].meta.changes !== 1) {
    throw badRequest('INVITE_INVALID', 'Invite code invalid, used, or revoked');
  }

  const user = await findUserById(env.DB, userId);
  if (!user) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'User not found after register');
  }
  return issueSession(env, userId, user);
}

export interface LoginParams {
  email: string;
  password: string;
}

export async function login(env: Env, params: LoginParams): Promise<AuthSession> {
  const row = await findUserByEmail(env.DB, params.email);
  if (!row) {
    throw unauthorized('Invalid email or password');
  }
  const ok = await verifyPassword(params.password, row.password_hash);
  if (!ok) {
    throw unauthorized('Invalid email or password');
  }
  await touchUserLogin(env.DB, row.id);
  const user = mapUser(row);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: row.id,
    action: 'user.login',
    targetType: 'user',
    targetId: row.id,
  });
  return issueSession(env, row.id, user);
}

export async function refreshSession(env: Env, refreshToken: string): Promise<AuthSession> {
  const tokenHash = await hashRefreshToken(refreshToken);
  const record = await findRefreshTokenByHash(env.DB, tokenHash);
  if (!record) {
    throw unauthorized('Invalid refresh token');
  }
  if (record.revokedAt) {
    throw unauthorized('Refresh token revoked');
  }
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    throw unauthorized('Refresh token expired');
  }

  // 滚动刷新：吊销旧 token，颁发新 token
  await revokeRefreshToken(env.DB, record.id);
  const user = await findUserById(env.DB, record.userId);
  if (!user) {
    throw unauthorized('User not found');
  }
  return issueSession(env, record.userId, user);
}

export async function logout(env: Env, refreshToken: string, userId: string): Promise<void> {
  const tokenHash = await hashRefreshToken(refreshToken);
  const record = await findRefreshTokenByHash(env.DB, tokenHash);
  if (record && record.userId === userId) {
    await revokeRefreshToken(env.DB, record.id);
    await writeAuditLog(env.DB, {
      actorType: 'user',
      actorId: userId,
      action: 'user.logout',
      targetType: 'user',
      targetId: userId,
    });
  }
  // 即使 token 不存在也返回成功（幂等）
}

export async function getMe(env: Env, userId: string): Promise<OrgUser> {
  const user = await findUserById(env.DB, userId);
  if (!user) {
    throw unauthorized('User not found');
  }
  return user;
}
```

- [ ] **Step 2: 验证编译 + 提交**

```bash
pnpm compile
git add src/services/auth-service.ts
git commit -m "feat: add auth service (register/login/refresh/logout)"
```

---

## Task 13: Task Service（状态机 + 权限 + cancel）

**Files:**
- Create: `rprun-org-worker/src/services/task-service.ts`

- [ ] **Step 1: 写 `src/services/task-service.ts`**

```ts
// src/services/task-service.ts
import type { Env } from '../config';
import type {
  OrgTask, TaskContractJson, TaskStatus, TaskType, ContractCreator,
} from '../types';
import { badRequest, forbidden, notFound, HttpError } from '../utils/http-error';
import { mapTask } from '../db/mappers';
import {
  claimTask as repoClaimTask,
  createTask as repoCreateTask,
  findTaskRowById,
  linkContract as repoLinkContract,
  releaseTask as repoReleaseTask,
  setTaskStatus,
  updateTaskContractJson,
  type CreateTaskInput,
} from '../db/repositories/tasks.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PUBLISHED: ['AWAITING_CONTRACT', 'CANCELLED'],
  AWAITING_CONTRACT: ['IN_PROGRESS', 'PUBLISHED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface CreateTaskParams {
  type: TaskType;
  contractJson: TaskContractJson;
  expiresAt?: string;
}

export async function createTask(
  env: Env,
  userId: string,
  prunUsername: string,
  companyCode: string,
  params: CreateTaskParams,
): Promise<OrgTask> {
  const input: CreateTaskInput = {
    type: params.type,
    contractJson: params.contractJson,
    publisherId: userId,
    publisherUsername: prunUsername,
    publisherCompanyCode: companyCode,
    expiresAt: params.expiresAt,
  };
  const task = await repoCreateTask(env.DB, input);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.create',
    targetType: 'task',
    targetId: task.id,
    metadata: { type: task.type, status: task.status },
  });
  return task;
}

export async function patchTask(
  env: Env,
  taskId: string,
  userId: string,
  updates: { contractJson?: TaskContractJson; expiresAt?: string | null },
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.publisher_id !== userId) {
    throw forbidden('Only the publisher can edit');
  }
  if (row.status !== 'PUBLISHED') {
    throw badRequest('INVALID_TRANSITION', 'Can only edit PUBLISHED tasks');
  }
  // expiresAt 处理三态：
  //   - undefined：不更新
  //   - null：显式清空（置 NULL）
  //   - string：更新为 ISO 时间
  // contractJson 与 expiresAt 可独立或同时更新；同时更新时一并传入。
  if (updates.contractJson) {
    await updateTaskContractJson(
      env.DB,
      taskId,
      updates.contractJson,
      updates.expiresAt === undefined ? undefined : updates.expiresAt,
    );
  } else if (updates.expiresAt !== undefined) {
    await env.DB
      .prepare('UPDATE tasks SET expires_at = ? WHERE id = ?')
      .bind(updates.expiresAt, taskId)
      .run();
  }
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.patch',
    targetType: 'task',
    targetId: taskId,
    metadata: {
      has_contract_json: !!updates.contractJson,
      expiresAt: updates.expiresAt === undefined ? undefined : updates.expiresAt === null ? 'null' : 'set',
    },
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after update');
  return mapTask(updated);
}

// 列表查询：从 tasks.repo 转发到 service 层，便于未来加业务过滤或权限裁剪
// 注意：'published' 与 'claimed' scope 会强制按当前 userId 过滤
export async function listTasksForUser(
  env: Env,
  userId: string,
  filter: {
    scope: 'board' | 'published' | 'claimed';
    type?: string;
    publisherUsername?: string;
    claimerUsername?: string;
    location?: string;
    since?: string;
    limit?: number;
    cursor?: string;
  },
): Promise<{ items: OrgTask[]; nextCursor: string | null }> {
  const { listTasks } = await import('../db/repositories/tasks.repo');
  // 'published' / 'claimed' scope 隐含按当前用户过滤；'board' scope 不带 userId 限制
  return listTasks(env.DB, {
    scope: filter.scope,
    userId,
    type: filter.type as never,
    publisherUsername: filter.publisherUsername,
    claimerUsername: filter.claimerUsername,
    location: filter.location,
    since: filter.since,
    limit: filter.limit,
    cursor: filter.cursor,
  });
}

export async function claimTask(
  env: Env,
  taskId: string,
  userId: string,
  prunUsername: string,
  companyCode: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.status !== 'PUBLISHED') {
    throw badRequest('INVALID_TRANSITION', `Cannot claim task in ${row.status} state`);
  }
  if (row.publisher_id === userId) {
    throw badRequest('CANNOT_CLAIM_OWN', 'Cannot claim your own task');
  }
  // 默认接取者创建合同（除非任务类型为 SHIP，则由发布者创建）
  const contractCreator: ContractCreator = row.type === 'SHIP' ? 'publisher' : 'claimer';
  await repoClaimTask(env.DB, taskId, userId, prunUsername, companyCode, contractCreator);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.claim',
    targetType: 'task',
    targetId: taskId,
    metadata: { contract_creator: contractCreator },
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after claim');
  return mapTask(updated);
}

export async function releaseTask(
  env: Env,
  taskId: string,
  userId: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.claimer_id !== userId) {
    throw forbidden('Only the claimer can release');
  }
  if (!canTransition(row.status, 'PUBLISHED')) {
    throw badRequest('INVALID_TRANSITION', `Cannot release from ${row.status}`);
  }
  await repoReleaseTask(env.DB, taskId);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.release',
    targetType: 'task',
    targetId: taskId,
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after release');
  return mapTask(updated);
}

export async function cancelTask(
  env: Env,
  taskId: string,
  userId: string,
  userRole: 'BOARD' | 'COLLABORATOR',
  reason?: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');

  const isPublisher = row.publisher_id === userId;
  const isBoard = userRole === 'BOARD';
  if (!isPublisher && !isBoard) {
    throw forbidden('NOT_AUTHORIZED_TO_CANCEL');
  }
  if (isBoard && !isPublisher && !reason) {
    throw badRequest('REASON_REQUIRED_FOR_BOARD_CANCEL', 'Reason required for board cancel');
  }
  if (!canTransition(row.status, 'CANCELLED')) {
    throw badRequest('INVALID_TRANSITION', `Cannot cancel from ${row.status}`);
  }
  await setTaskStatus(env.DB, taskId, 'CANCELLED');
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: isBoard && !isPublisher ? 'task.cancel_by_board' : 'task.cancel',
    targetType: 'task',
    targetId: taskId,
    metadata: { reason, by_board: isBoard && !isPublisher },
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after cancel');
  return mapTask(updated);
}

export async function linkContract(
  env: Env,
  taskId: string,
  userId: string,
  contractId: string,
  contractCreator: ContractCreator,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.publisher_id !== userId && row.claimer_id !== userId) {
    throw forbidden('NOT_TASK_PARTY');
  }
  if (row.status !== 'AWAITING_CONTRACT') {
    throw badRequest('INVALID_TRANSITION', `Cannot link contract in ${row.status} state`);
  }
  if (row.contract_id) {
    throw badRequest('CONTRACT_ALREADY_LINKED', 'Contract already linked');
  }
  await repoLinkContract(env.DB, taskId, contractId, contractCreator);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.link_contract',
    targetType: 'task',
    targetId: taskId,
    metadata: { contract_id: contractId, contract_creator: contractCreator },
  });
  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after link');
  return mapTask(updated);
}

// 隔离校验：所有读取任务详情的请求都先校验参与方身份
// PUBLISHED 任务对所有人可见；其他状态仅参与方可见
export async function getTaskForUser(
  env: Env,
  taskId: string,
  userId: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (
    row.status !== 'PUBLISHED' &&
    row.publisher_id !== userId &&
    row.claimer_id !== userId
  ) {
    throw forbidden('NOT_TASK_PARTY');
  }
  return mapTask(row);
}
```

- [ ] **Step 2: 验证编译 + 提交**

```bash
pnpm compile
git add src/services/task-service.ts
git commit -m "feat: add task service with state machine and permission checks"
```

---

## Task 14: Contract Sync Service

**Files:**
- Create: `rprun-org-worker/src/services/contract-sync-service.ts`

- [ ] **Step 1: 写 `src/services/contract-sync-service.ts`**

```ts
// src/services/contract-sync-service.ts
import type { Env } from '../config';
import type { OrgTask, PrunContractStatus, TaskStatus } from '../types';
import { badRequest, forbidden, notFound, HttpError } from '../utils/http-error';
import { canTransition } from './task-service';
import { findTaskRowById, setTaskStatus } from '../db/repositories/tasks.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';
import { mapTask } from '../db/mappers';

// 大写状态映射（与客户端 types.ts PrunContractStatus 枚举对齐）
const CONTRACT_STATUS_TO_TASK: Partial<Record<PrunContractStatus, TaskStatus>> = {
  CLOSED: 'IN_PROGRESS',
  FULFILLED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  BREACHED: 'CANCELLED',
  TERMINATED: 'CANCELLED',
  // OPEN / PARTIALLY_FULFILLED / REJECTED / DEADLINE_EXCEEDED 不映射
};

export async function syncTaskFromContract(
  env: Env,
  taskId: string,
  contractStatus: PrunContractStatus,
  userId: string,
): Promise<OrgTask> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.publisher_id !== userId && row.claimer_id !== userId) {
    throw forbidden('NOT_TASK_PARTY');
  }
  if (!row.contract_id) {
    throw badRequest('NO_CONTRACT_LINKED', 'Task has no linked contract');
  }

  const nextStatus = CONTRACT_STATUS_TO_TASK[contractStatus];
  if (!nextStatus) {
    // 合同状态不触发任务状态变化，直接返回当前任务（幂等）
    return mapTask(row);
  }
  if (!canTransition(row.status, nextStatus)) {
    // 状态机不允许此转移（如已完成任务又收到 CLOSED），返回当前任务
    return mapTask(row);
  }

  await setTaskStatus(env.DB, taskId, nextStatus);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'task.sync_status',
    targetType: 'task',
    targetId: taskId,
    metadata: {
      from: row.status,
      to: nextStatus,
      contract_status: contractStatus,
    },
  });

  const updated = await findTaskRowById(env.DB, taskId);
  if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Task not found after sync');
  return mapTask(updated);
}
```

- [ ] **Step 2: 验证编译 + 提交**

```bash
pnpm compile
git add src/services/contract-sync-service.ts
git commit -m "feat: add contract sync service (uppercase status mapping)"
```

---

## Task 15: Invite Service + Audit Service

**Files:**
- Create: `rprun-org-worker/src/services/invite-service.ts`
- Create: `rprun-org-worker/src/services/audit-service.ts`

- [ ] **Step 1: 写 `src/services/invite-service.ts`**

```ts
// src/services/invite-service.ts
import type { Env } from '../config';
import type { InviteCode, OrgUser } from '../types';
import { badRequest, notFound } from '../utils/http-error';
import {
  createInviteCodes,
  findInviteCodeById,
  listInviteCodes,
  revokeInviteCode,
} from '../db/repositories/invite-codes.repo';
import {
  updateUserRole,
  findUserById,
  listAllUsers,
} from '../db/repositories/users.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';

export async function generateCodes(
  env: Env,
  count: number,
  createdBy: string,
  actorUserId: string,
): Promise<InviteCode[]> {
  const codes = await createInviteCodes(env.DB, count, createdBy);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: actorUserId,
    action: 'invite_code.generate',
    targetType: 'invite_code',
    metadata: { count, created_by: createdBy },
  });
  return codes;
}

export async function listCodes(env: Env): Promise<InviteCode[]> {
  return listInviteCodes(env.DB);
}

export async function revokeCode(
  env: Env,
  codeId: string,
  actorUserId: string,
): Promise<InviteCode> {
  const code = await findInviteCodeById(env.DB, codeId);
  if (!code) throw notFound('Invite code not found');
  if (code.usedByUserId) {
    throw badRequest('CODE_ALREADY_USED', 'Cannot revoke a used invite code');
  }
  if (code.revokedAt) {
    return code; // 幂等
  }
  await revokeInviteCode(env.DB, codeId);
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: actorUserId,
    action: 'invite_code.revoke',
    targetType: 'invite_code',
    targetId: codeId,
  });
  const updated = await findInviteCodeById(env.DB, codeId);
  if (!updated) throw new Error('Invite code vanished after revoke');
  return updated;
}

export async function promoteUser(
  env: Env,
  targetUserId: string,
  actorUserId: string,
): Promise<OrgUser> {
  const user = await findUserById(env.DB, targetUserId);
  if (!user) throw notFound('User not found');
  if (user.role === 'BOARD') return user; // 幂等
  await updateUserRole(env.DB, targetUserId, 'BOARD');
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: actorUserId,
    action: 'user.promote',
    targetType: 'user',
    targetId: targetUserId,
  });
  const updated = await findUserById(env.DB, targetUserId);
  if (!updated) throw new Error('User vanished after promote');
  return updated;
}

export async function demoteUser(
  env: Env,
  targetUserId: string,
  actorUserId: string,
): Promise<OrgUser> {
  if (targetUserId === actorUserId) {
    throw badRequest('CANNOT_DEMOTE_SELF', 'Cannot demote yourself');
  }
  const user = await findUserById(env.DB, targetUserId);
  if (!user) throw notFound('User not found');
  if (user.role === 'COLLABORATOR') return user; // 幂等
  // 防止把最后一个 BOARD 降级（避免组织无人可管理）
  const boardCount = await env.DB
    .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'BOARD'")
    .first<{ cnt: number }>();
  if ((boardCount?.cnt ?? 0) <= 1) {
    throw badRequest('LAST_BOARD', 'Cannot demote the last BOARD user');
  }
  await updateUserRole(env.DB, targetUserId, 'COLLABORATOR');
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: actorUserId,
    action: 'user.demote',
    targetType: 'user',
    targetId: targetUserId,
  });
  const updated = await findUserById(env.DB, targetUserId);
  if (!updated) throw new Error('User vanished after demote');
  return updated;
}

export async function listUsers(env: Env): Promise<OrgUser[]> {
  return listAllUsers(env.DB);
}
```

- [ ] **Step 2: 写 `src/services/audit-service.ts`**（薄封装，统计 + 日志查询）

```ts
// src/services/audit-service.ts
import type { Env } from '../config';
import type { AuditLog } from '../types';
import {
  listAuditLogs,
  type ListAuditLogsFilter,
  type ListAuditLogsResult,
} from '../db/repositories/audit-logs.repo';
import { countAllTasks, countTasksByStatus } from '../db/repositories/tasks.repo';
import { countUsersByRole } from '../db/repositories/users.repo';

export async function queryAuditLogs(
  env: Env,
  filter: ListAuditLogsFilter,
): Promise<ListAuditLogsResult> {
  return listAuditLogs(env.DB, filter);
}

export interface OrgStats {
  userCount: number;
  taskCount: number;
  boardCount: number;
  collaboratorCount: number;
  tasksByStatus: Record<string, number>;
}

export async function getStats(env: Env): Promise<OrgStats> {
  const [userCounts, taskCount, tasksByStatus] = await Promise.all([
    countUsersByRole(env.DB),
    countAllTasks(env.DB),
    countTasksByStatus(env.DB),
  ]);
  return {
    userCount: userCounts.total,
    taskCount,
    boardCount: userCounts.boardCount,
    collaboratorCount: userCounts.collaboratorCount,
    tasksByStatus,
  };
}
```

- [ ] **Step 3: 验证编译 + 提交**

```bash
pnpm compile
git add src/services/invite-service.ts src/services/audit-service.ts
git commit -m "feat: add invite/audit services"
```

---

## Task 16: Auth Routes

**Files:**
- Create: `rprun-org-worker/src/routes/auth.ts`

- [ ] **Step 1: 写 `src/routes/auth.ts`**

```ts
// src/routes/auth.ts
import { Hono } from 'hono';
import type { Env } from '../config';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from '../utils/validation';
import {
  registerWithInvite,
  login,
  refreshSession,
  logout,
  getMe,
} from '../services/auth-service';
import { authMiddleware } from '../middleware/jwt';
import { rateLimit } from '../middleware/rate-limit';
import { apiError } from '../utils/http-error';

const auth = new Hono<{ Bindings: Env }>();

// POST /auth/register
// 公开端点 + 限流（每 IP 每小时 5 次，架构 §12.9）
auth.post('/register', rateLimit({ window: 3600, max: 5, key: 'register' }), async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const session = await registerWithInvite(c.env, parsed.data);
  return c.json(session, 201);
});

// POST /auth/login
// 公开端点 + 限流（每 IP 每小时 20 次，架构 §12.9）
auth.post('/login', rateLimit({ window: 3600, max: 20, key: 'login' }), async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const session = await login(c.env, parsed.data);
  return c.json(session, 200);
});

// POST /auth/refresh
// 公开端点（用 refreshToken 换 accessToken），限流防爆破
auth.post('/refresh', rateLimit({ window: 3600, max: 60, key: 'refresh' }), async (c) => {
  const body = await c.req.json();
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const session = await refreshSession(c.env, parsed.data.refreshToken);
  return c.json(session, 200);
});

// POST /auth/logout
// 需要登录：service 会校验 refreshToken 归属于当前 userId（防止越权吊销他人 token）
auth.post('/logout', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = logoutSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  await logout(c.env, parsed.data.refreshToken, c.var.userId);
  return c.body(null, 204);
});

// GET /auth/me
// 需要登录
auth.get('/me', authMiddleware, async (c) => {
  const user = await getMe(c.env, c.var.userId);
  return c.json(user, 200);
});

export default auth;
```

⚠️ **关于 `authMiddleware` 注入的 `c.var.userId`**：见 Task 10 中间件，JWT 验证通过后将 `userId` 写入 `c.set('userId', sub)`。Hono 通过 `c.var.userId` 访问。

- [ ] **Step 2: 验证编译 + 提交**

```bash
pnpm compile
git add src/routes/auth.ts
git commit -m "feat: add auth routes (register/login/refresh/logout/me)"
```

---

## Task 17: Tasks Routes

**Files:**
- Create: `rprun-org-worker/src/routes/tasks.ts`

- [ ] **Step 1: 写 `src/routes/tasks.ts`**

```ts
// src/routes/tasks.ts
import { Hono } from 'hono';
import type { Env } from '../config';
import { authMiddleware } from '../middleware/jwt';
import {
  createTaskSchema,
  patchTaskSchema,
  cancelTaskSchema,
  linkContractSchema,
  syncStatusSchema,
  listTasksQuerySchema,
  createNoteSchema,
} from '../utils/validation';
import { apiError } from '../utils/http-error';
import {
  createTask,
  getTaskForUser,
  listTasksForUser,
  patchTask,
  claimTask,
  releaseTask,
  cancelTask,
  linkContract,
} from '../services/task-service';
import { syncTaskFromContract } from '../services/contract-sync-service';
import { listNotesByTask, createNote } from '../db/repositories/notes.repo';

const tasks = new Hono<{ Bindings: Env }>();

// 全部 /tasks/* 路由都需要登录
tasks.use('*', authMiddleware);

// GET /tasks
tasks.get('/', async (c) => {
  const query = Object.fromEntries(new URLSearchParams(c.req.query()));
  const parsed = listTasksQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const result = await listTasksForUser(c.env, c.var.userId, parsed.data);
  return c.json(result, 200);
});

// GET /tasks/:id
tasks.get('/:id', async (c) => {
  const task = await getTaskForUser(c.env, c.req.param('id'), c.var.userId);
  return c.json(task, 200);
});

// POST /tasks
tasks.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const task = await createTask(
    c.env,
    c.var.userId,
    c.var.prunUsername,
    c.var.companyCode,
    parsed.data,
  );
  return c.json(task, 201);
});

// PATCH /tasks/:id
tasks.patch('/:id', async (c) => {
  const body = await c.req.json();
  const parsed = patchTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const task = await patchTask(c.env, c.req.param('id'), c.var.userId, parsed.data);
  return c.json(task, 200);
});

// POST /tasks/:id/claim
tasks.post('/:id/claim', async (c) => {
  const task = await claimTask(
    c.env,
    c.req.param('id'),
    c.var.userId,
    c.var.prunUsername,
    c.var.companyCode,
  );
  return c.json(task, 200);
});

// POST /tasks/:id/release
tasks.post('/:id/release', async (c) => {
  const task = await releaseTask(c.env, c.req.param('id'), c.var.userId);
  return c.json(task, 200);
});

// POST /tasks/:id/cancel
tasks.post('/:id/cancel', async (c) => {
  // 客户端 cancelTask：body 可选 reason
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  // BOARD 可取消他人任务；COLLABORATOR 仅可取消自己发布的。service 内部做权限判定
  const task = await cancelTask(
    c.env,
    c.req.param('id'),
    c.var.userId,
    c.var.role,
    parsed.data.reason,
  );
  return c.json(task, 200);
});

// POST /tasks/:id/link-contract
tasks.post('/:id/link-contract', async (c) => {
  const body = await c.req.json();
  const parsed = linkContractSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const task = await linkContract(
    c.env,
    c.req.param('id'),
    c.var.userId,
    parsed.data.contractId,
    parsed.data.contractCreator,
  );
  return c.json(task, 200);
});

// POST /tasks/:id/sync-status
tasks.post('/:id/sync-status', async (c) => {
  const body = await c.req.json();
  const parsed = syncStatusSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const task = await syncTaskFromContract(
    c.env,
    c.req.param('id'),
    parsed.data.contractStatus,
    c.var.userId,
  );
  return c.json(task, 200);
});

// GET /tasks/:id/notes
tasks.get('/:id/notes', async (c) => {
  // 校验用户对该任务可见（同上 getTaskForUser）
  await getTaskForUser(c.env, c.req.param('id'), c.var.userId);
  const notes = await listNotesByTask(c.env.DB, c.req.param('id'));
  return c.json(notes, 200);
});

// POST /tasks/:id/notes
tasks.post('/:id/notes', async (c) => {
  const body = await c.req.json();
  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  // 校验可见性 + 拿用户名
  const task = await getTaskForUser(c.env, c.req.param('id'), c.var.userId);
  const note = await createNote(
    c.env.DB,
    c.req.param('id'),
    c.var.userId,
    task.publisherId === c.var.userId
      ? task.publisherUsername
      : task.claimerUsername ?? task.publisherUsername,
    parsed.data.content,
  );
  return c.json(note, 201);
});

export default tasks;
```

- [ ] **Step 2: 验证编译 + 提交**

```bash
pnpm compile
git add src/routes/tasks.ts
git commit -m "feat: add task routes (CRUD + state transitions + notes)"
```

---

## Task 18: Board Routes

**Files:**
- Create: `rprun-org-worker/src/routes/board.ts`

- [ ] **Step 1: 写 `src/routes/board.ts`**

```ts
// src/routes/board.ts
import { Hono } from 'hono';
import type { Env } from '../config';
import { authMiddleware } from '../middleware/jwt';
import { boardOnly } from '../middleware/board-only';
import { apiError } from '../utils/http-error';
import {
  generateInviteCodesSchema,
  listAuditLogsQuerySchema,
} from '../utils/validation';
import {
  generateCodes,
  listCodes,
  revokeCode,
  listUsers,
  promoteUser,
  demoteUser,
} from '../services/invite-service';
import { queryAuditLogs, getStats } from '../services/audit-service';

const board = new Hono<{ Bindings: Env }>();

// 全部 /board/* 路由都需要 BOARD 角色
board.use('*', authMiddleware, boardOnly);

// POST /board/invite-codes
// body: { count, createdBy }
// service 内部已写审计，路由不再重复
board.post('/invite-codes', async (c) => {
  const body = await c.req.json();
  const parsed = generateInviteCodesSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const codes = await generateCodes(
    c.env,
    parsed.data.count,
    parsed.data.createdBy,
    c.var.userId,
  );
  return c.json(codes, 201);
});

// GET /board/invite-codes
board.get('/invite-codes', async (c) => {
  const codes = await listCodes(c.env);
  return c.json(codes, 200);
});

// POST /board/invite-codes/:id/revoke
board.post('/invite-codes/:id/revoke', async (c) => {
  const code = await revokeCode(c.env, c.req.param('id'), c.var.userId);
  return c.json(code, 200);
});

// GET /board/users
board.get('/users', async (c) => {
  const users = await listUsers(c.env);
  return c.json(users, 200);
});

// POST /board/users/:id/promote
// service 幂等：已是 BOARD 直接返回 200
// 注：不禁止"提升自己"——已经是 BOARD，再次提升无害且与 service 行为一致
board.post('/users/:id/promote', async (c) => {
  const user = await promoteUser(c.env, c.req.param('id'), c.var.userId);
  return c.json(user, 200);
});

// POST /board/users/:id/demote
// service 内部检查 CANNOT_DEMOTE_SELF + LAST_BOARD
board.post('/users/:id/demote', async (c) => {
  const user = await demoteUser(c.env, c.req.param('id'), c.var.userId);
  return c.json(user, 200);
});

// GET /board/stats
board.get('/stats', async (c) => {
  const stats = await getStats(c.env);
  return c.json(stats, 200);
});

// GET /board/audit-logs?limit=&cursor=&action=&actorId=
board.get('/audit-logs', async (c) => {
  const query = Object.fromEntries(new URLSearchParams(c.req.query()));
  const parsed = listAuditLogsQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const result = await queryAuditLogs(c.env, parsed.data);
  return c.json(result, 200);
});

export default board;
```

- [ ] **Step 2: 验证编译 + 提交**

```bash
pnpm compile
git add src/routes/board.ts
git commit -m "feat: add board admin routes (invite-codes/users/stats/audit-logs)"
```

---

## Task 19: Health Route + CORS

**Files:**
- Create: `rprun-org-worker/src/routes/health.ts`

- [ ] **Step 1: 写 `src/routes/health.ts`**

```ts
// src/routes/health.ts
import { Hono } from 'hono';
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
  }, 200);
});

export default health;
```

- [ ] **Step 2: 验证编译 + 提交**

```bash
pnpm compile
git add src/routes/health.ts
git commit -m "feat: add health check route"
```

---

## Task 20: Worker 入口 + Cron Trigger

**Files:**
- Create: `rprun-org-worker/src/index.ts`

- [ ] **Step 1: 写 `src/index.ts`（Hono app + CORS + 路由挂载 + Cron handler）**

```ts
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
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.allSettled([
      cleanupExpiredTasks(env),       // 把过期 PUBLISHED 任务标记 CANCELLED
      cleanupRateLimitBuckets(env.DB), // 删除过期的 rate_limit_buckets 行
    ]));
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: 在 `wrangler.toml` 添加 Cron Triggers（更新 Task 1 的 wrangler.toml）**

在 `wrangler.toml` 末尾追加：

```toml
# Cron Triggers：每 5 分钟清理过期任务 + 限流桶
[triggers]
crons = ["*/5 * * * *"]
```

- [ ] **Step 3: 在 `task-service.ts` 添加 `cleanupExpiredTasks`（追加到 Task 13 文件末尾）**

```ts
// 追加到 src/services/task-service.ts
// 注意：writeAuditLog 已在 Task 13 文件顶部 import，直接复用
export async function cleanupExpiredTasks(env: Env): Promise<void> {
  // 把所有 expires_at < now 且 status IN (PUBLISHED, AWAITING_CONTRACT) 的任务转 CANCELLED
  const result = await env.DB.prepare(
    `UPDATE tasks
     SET status = 'CANCELLED',
         cancelled_at = datetime('now'),
         updated_at = datetime('now')
     WHERE expires_at IS NOT NULL
       AND expires_at < datetime('now')
       AND status IN ('PUBLISHED', 'AWAITING_CONTRACT')`
  ).run();
  if (result.meta.changes > 0) {
    await writeAuditLog(env.DB, {
      actorType: 'system',
      actorId: undefined,
      action: 'task.cleanup_expired',
      targetType: 'task',
      targetId: undefined,
      metadata: { count: result.meta.changes },
    });
  }
}
```

- [ ] **Step 4: 在 `rate-limits.repo.ts` 添加 `cleanupRateLimitBuckets`（追加到 Task 9 文件末尾）**

```ts
// 追加到 src/db/repositories/rate-limits.repo.ts
// 注意：rate_limit_buckets 表只有 bucket_key/count/expires_at 字段（见 Task 7 schema）
export async function cleanupRateLimitBuckets(db: D1Database): Promise<void> {
  // 删除已过期的桶（保留 1 小时便于审计）
  await db.prepare(
    `DELETE FROM rate_limit_buckets WHERE expires_at < datetime('now', '-1 hour')`
  ).run();
}
```

- [ ] **Step 5: 验证编译 + 提交**

```bash
pnpm compile
git add src/index.ts src/services/task-service.ts src/db/repositories/rate-limits.repo.ts wrangler.toml
git commit -m "feat: wire worker entry (Hono + CORS + routes + cron)"
```

---

## Task 21: 集成测试

**Files:**
- Create: `rprun-org-worker/tests/setup.ts`
- Create: `rprun-org-worker/tests/integration.test.ts`

- [ ] **Step 1: 写 `tests/setup.ts`（在测试前应用 schema + 提供工具函数）**

```ts
// tests/setup.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 读取 init schema
export const SCHEMA_SQL = readFileSync(
  resolve(__dirname, '../src/db/migrations/001_init.sql'),
  'utf8',
);

// 应用 schema 到测试 D1
// D1 prepare() 只能执行单条语句；用 db.exec() 一次执行整个 schema
// （exec 会按 SQLite 规则正确处理 trigger 内部的 ; ）
export async function applySchema(env: Env): Promise<void> {
  await env.DB.exec(SCHEMA_SQL);
}

// 清空所有表（每个测试前调用）
export async function truncateAll(env: Env): Promise<void> {
  const tables = ['users', 'invite_codes', 'refresh_tokens', 'tasks', 'task_notes', 'audit_logs', 'rate_limit_buckets'];
  for (const t of tables) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

// 直接插入一个 BOARD 用户（绕过注册流程，用于测试 boardOnly 路由）
// 注意：users.invite_code_id 为 NOT NULL UNIQUE（架构 §12.5），
// 所以必须先插一行 invite_codes 再引用其 id（即使该码不会被使用）
export async function seedBoardUser(env: Env, email = 'board@test.local'): Promise<{ id: string; email: string }> {
  const { hashPassword } = await import('../src/utils/password');
  const { generateInviteCode } = await import('../src/utils/invite-code');
  const passwordHash = await hashPassword('password123');
  const userId = crypto.randomUUID();
  const inviteId = crypto.randomUUID();
  // 生成一个不重复的码（10 位 base32），用于满足 users.invite_code_id 的外键/唯一约束
  const code = generateInviteCode();
  await env.DB.prepare(
    `INSERT INTO invite_codes (id, code, created_by) VALUES (?, ?, ?)`,
  ).bind(inviteId, code, userId).run();
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, prun_username, company_code, display_name, role, invite_code_id)
     VALUES (?, ?, ?, ?, ?, ?, 'BOARD', ?)`,
  ).bind(userId, email, passwordHash, 'board_user', 'BRC', 'Board User', inviteId).run();
  return { id: userId, email };
}
```

- [ ] **Step 2: 写 `tests/integration.test.ts`（端到端 happy path + 权限边界）**

```ts
// tests/integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema, truncateAll, seedBoardUser } from './setup';
import { generateCodes } from '../src/services/invite-service';

describe('ORG backend integration', () => {
  beforeEach(async () => {
    await applySchema(env);
    await truncateAll(env);
  });

  it('full happy path: register → login → publish → claim → link → sync → complete', async () => {
    // 1. 引导一个 BOARD 用户
    const board = await seedBoardUser(env, 'board@org.local');

    // 2. BOARD 生成邀请码
    //    service 签名：generateCodes(env, count, createdBy, actorUserId)
    const codes = await generateCodes(env, 1, board.id, board.id);
    expect(codes).toHaveLength(1);
    const inviteCode = codes[0].code;

    // 3. 用邀请码注册一个 COLLABORATOR
    const registerRes = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'colab@org.local',
        password: 'password123',
        inviteCode,
        prunUsername: 'colab_user',
        companyCode: 'CLB',
      }),
    });
    expect(registerRes.status).toBe(201);
    const session = await registerRes.json();
    expect(session.user.role).toBe('COLLABORATOR');
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    const accessToken = session.accessToken;

    // 4. 发布任务
    const createRes = await SELF.fetch('http://localhost/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        type: 'BUY',
        contractJson: {
          template: 'BUY',
          currency: 'AIC',
          name: 'Test Buy',
          location: 'Antares',
          items: [{ commodity: 'RAT', amount: 100, price: 50 }],
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json();
    expect(task.status).toBe('PUBLISHED');
    const taskId = task.id;

    // 5. 接取任务
    const claimRes = await SELF.fetch(`http://localhost/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(claimRes.status).toBe(200);
    const claimed = await claimRes.json();
    expect(claimed.status).toBe('AWAITING_CONTRACT');
    expect(claimed.claimerId).toBe(session.user.id);

    // 6. link-contract（不改变状态）
    const linkRes = await SELF.fetch(`http://localhost/tasks/${taskId}/link-contract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ contractId: 'c-123', contractCreator: 'claimer' }),
    });
    expect(linkRes.status).toBe(200);
    const linked = await linkRes.json();
    expect(linked.status).toBe('AWAITING_CONTRACT');
    expect(linked.contractId).toBe('c-123');

    // 7. sync-status: CLOSED → IN_PROGRESS
    const sync1Res = await SELF.fetch(`http://localhost/tasks/${taskId}/sync-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ contractStatus: 'CLOSED' }),
    });
    expect(sync1Res.status).toBe(200);
    expect((await sync1Res.json()).status).toBe('IN_PROGRESS');

    // 8. sync-status: FULFILLED → COMPLETED
    const sync2Res = await SELF.fetch(`http://localhost/tasks/${taskId}/sync-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ contractStatus: 'FULFILLED' }),
    });
    expect(sync2Res.status).toBe(200);
    expect((await sync2Res.json()).status).toBe('COMPLETED');
  });

  it('non-board user gets 403 on /board/*', async () => {
    const board = await seedBoardUser(env, 'board@org.local');
    const codes = await generateCodes(env, 1, board.id, board.id);
    const inviteCode = codes[0].code;

    // 注册 COLLABORATOR
    const reg = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'colab@org.local', password: 'password123',
        inviteCode, prunUsername: 'colab', companyCode: 'CLB',
      }),
    });
    const { accessToken } = await reg.json();

    // COLLABORATOR 访问 /board/users → 403
    const res = await SELF.fetch('http://localhost/board/users', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('cannot claim own published task', async () => {
    const board = await seedBoardUser(env, 'board@org.local');
    // 直接用 BOARD 登录拿 token（BOARD 也能发布任务）
    const loginRes = await SELF.fetch('http://localhost/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'board@org.local', password: 'password123' }),
    });
    const { accessToken } = await loginRes.json();

    const createRes = await SELF.fetch('http://localhost/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        type: 'SELL',
        contractJson: { template: 'SELL', currency: 'AIC', items: [{ commodity: 'RAT', amount: 10 }] },
      }),
    });
    const taskId = (await createRes.json()).id;

    // 接自己的任务 → 400
    const claimRes = await SELF.fetch(`http://localhost/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(claimRes.status).toBe(400);
    expect((await claimRes.json()).error.code).toBe('CANNOT_CLAIM_OWN');
  });

  it('board cannot demote self', async () => {
    const board = await seedBoardUser(env, 'board@org.local');
    const loginRes = await SELF.fetch('http://localhost/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'board@org.local', password: 'password123' }),
    });
    const { accessToken } = await loginRes.json();

    const res = await SELF.fetch(`http://localhost/board/users/${board.id}/demote`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CANNOT_DEMOTE_SELF');
  });

  it('refresh token rotation: old token invalid after refresh', async () => {
    const board = await seedBoardUser(env, 'board@org.local');
    const codes = await generateCodes(env, 1, board.id, board.id);
    const reg = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'x@org.local', password: 'password123',
        inviteCode: codes[0].code, prunUsername: 'x', companyCode: 'X',
      }),
    });
    const session = await reg.json();
    const oldRefresh = session.refreshToken;

    // 续期
    const refreshRes = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: oldRefresh }),
    });
    expect(refreshRes.status).toBe(200);
    const newSession = await refreshRes.json();
    expect(newSession.refreshToken).not.toBe(oldRefresh);

    // 旧 token 已失效
    const retry = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: oldRefresh }),
    });
    expect(retry.status).toBe(401);
  });

  it('rate limit: 6th register within 1 hour → 429', async () => {
    // 架构 §12.9：register 限流 5/小时。第 6 次必然触发 429。
    // 即使 body 校验失败也会消耗桶（rateLimit 中间件先于 body 解析）。
    // inviteCode 用 'BADCREDENTIAL'（12 字符，不符合 ^[A-Z2-9]{10}$），
    // 但 body 校验在限流之后，所以不影响 429 触发。
    for (let i = 0; i < 5; i++) {
      await SELF.fetch('http://localhost/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `x${i}@x`, password: 'p', inviteCode: 'BADCREDENTIAL', prunUsername: 'u', companyCode: 'C' }),
      });
    }
    const res = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x5@x', password: 'p', inviteCode: 'BADCREDENTIAL', prunUsername: 'u', companyCode: 'C' }),
    });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
  });

  it('invalid invite code → 400 INVITE_INVALID', async () => {
    // inviteCode 必须先通过 schema ^[A-Z2-9]{10}$ 校验，才能进入 service 层做"是否存在"检查
    // 'DOESNOTEXS' 正好 10 字符且全部在 [A-Z2-9] 范围内（D O E S N O T E X S）
    const res = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'x@x', password: 'password123',
        inviteCode: 'DOESNOTEXS', prunUsername: 'x', companyCode: 'X',
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVITE_INVALID');
  });
});
```

- [ ] **Step 3: `vitest.config.ts` 已在 Task 4 创建并配置好 D1/KV/setupFiles，本步骤跳过**

如需调整（例如增加 coverage 阈值），编辑同一份文件即可。

- [ ] **Step 4: 运行测试**

```bash
pnpm test
```

预期：全部测试通过。如失败，根据错误信息定位（通常是 schema 未应用 / 测试用例之间的状态污染 / `cloudflare:test` 未正确绑定 D1）。

- [ ] **Step 5: 提交**

```bash
git add tests/ vitest.config.ts
git commit -m "test: add integration tests for happy path + permission edges"
```

---

## Task 22: 部署指南 + README

**Files:**
- Modify: `rprun-org-worker/README.md`（Task 1 创建的占位版替换为完整版）

- [ ] **Step 1: 写 `README.md`**

```markdown
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

\`\`\`bash
pnpm install
\`\`\`

### 本地启动

\`\`\`bash
pnpm db:migrate:local   # 应用 D1 schema 到本地 Miniflare
pnpm dev                # 启动 wrangler dev，默认 http://localhost:8787
\`\`\`

### 测试

\`\`\`bash
pnpm test               # 运行 Vitest（含 Miniflare D1 集成测试）
pnpm compile            # tsc --noEmit
\`\`\`

## 部署（首次）

### 步骤 1: 创建 D1 数据库

\`\`\`bash
pnpm wrangler d1 create rprun-org-db
\`\`\`

把输出的 `database_id` 填入 `wrangler.toml`：

\`\`\`toml
[[d1_databases]]
binding = "DB"
database_name = "rprun-org-db"
database_id = "<填这里>"
\`\`\`

### 步骤 2: 创建 KV 命名空间（预留）

\`\`\`bash
pnpm wrangler kv namespace create KV
\`\`\`

把 `id` 填入 `wrangler.toml` 的 `[[kv_namespaces]]`。

### 步骤 3: 设置 secrets

\`\`\`bash
pnpm wrangler secret put JWT_SECRET       # 至少 32 字节随机
\`\`\`

`JWT_SECRET` 必须设置，否则 Worker 启动时所有鉴权请求都会失败。

### 步骤 4: 应用 D1 schema 到生产

\`\`\`bash
pnpm db:migrate
\`\`\`

> 必须先于 Worker 部署：Worker 启动后第一条请求就会查表，schema 未应用会导致 500。

### 步骤 5: 部署 Worker

\`\`\`bash
pnpm deploy
\`\`\`

### 步骤 6: 引导第一个 BOARD 用户

⚠️ **关键步骤**：第一个 BOARD 用户不能用邀请码注册（因为邀请码必须由 BOARD 生成）。直接用 SQL 插入：

\`\`\`bash
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
\`\`\`

> **预计算密码哈希**：在本地 `wrangler dev` 跑起来后，调用 `POST /auth/register` 注册任意账号，然后 `wrangler d1 execute rprun-org-db --local --command="SELECT password_hash FROM users WHERE email='...'"` 拿到哈希值。或者写一个一次性 Worker 脚本调用 `hashPassword('yourpassword')` 输出哈希。

### 步骤 7: 验证部署

\`\`\`bash
curl https://rprun-org-api.<your-subdomain>.workers.dev/health
# 应返回 {"status":"ok","db":"up",...}

curl -X POST https://rprun-org-api.<your-subdomain>.workers.dev/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"admin@your-org.local","password":"yourpassword"}'
# 应返回 accessToken + refreshToken
\`\`\`

### 步骤 8: 让 BOARD 生成邀请码分发

\`\`\`bash
curl -X POST https://rprun-org-api.<your-subdomain>.workers.dev/board/invite-codes \\
  -H "Authorization: Bearer <accessToken>" \\
  -H "Content-Type: application/json" \\
  -d '{"count": 10, "createdBy": "<your user id>"}'
\`\`\`

## 后续部署

\`\`\`bash
git pull
pnpm install
pnpm compile
pnpm test
pnpm deploy
# 如有 schema 变更，追加 002_xxx.sql 并 pnpm wrangler d1 execute rprun-org-db --file=src/db/migrations/002_xxx.sql
\`\`\`

## API 文档

完整 API 形状见 rprun 仓库 `src/infrastructure/org-api/types.ts` 与各 API 函数文件（`auth.ts` / `tasks.ts` / `notes.ts` / `board.ts`）。本后端实现严格对齐这些客户端契约。

错误响应统一格式：

\`\`\`json
{ "error": { "code": "ERROR_CODE", "message": "人类可读消息" } }
\`\`\`

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
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: add deployment guide + bootstrap flow"
```

---

## Task 23: 最终验证 + 自检

- [ ] **Step 1: 全量编译 + 测试**

```bash
pnpm install
pnpm compile
pnpm test
pnpm deploy  # 部署到 Cloudflare
```

- [ ] **Step 2: 部署后冒烟测试**

```bash
# 1. health
curl https://rprun-org-api.<sub>.workers.dev/health

# 2. 错误的邀请码注册 → 400 INVITE_INVALID
#    inviteCode 必须先通过 ^[A-Z2-9]{10}$ schema 校验才会进 service 检查"是否存在"
#    'DOESNOTEXS' 正好 10 字符且全部在 [A-Z2-9] 范围内
curl -X POST https://rprun-org-api.<sub>.workers.dev/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"x@x","password":"password123","inviteCode":"DOESNOTEXS","prunUsername":"u","companyCode":"C"}'

# 3. 未带 token 访问 /tasks → 401 UNAUTHORIZED
curl https://rprun-org-api.<sub>.workers.dev/tasks

# 4. 用步骤 6 引导的 BOARD 账号登录 → 200 AuthSession
curl -X POST https://rprun-org-api.<sub>.workers.dev/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@your-org.local","password":"yourpassword"}'

# 5. 用 accessToken 调 /board/stats → 200 OrgStats
curl https://rprun-org-api.<sub>.workers.dev/board/stats \
  -H "Authorization: Bearer <token>"
```

- [ ] **Step 3: 自检清单**

- [ ] 所有客户端 API 函数（`auth.ts` / `tasks.ts` / `notes.ts` / `board.ts`）都有对应后端路由实现
- [ ] 所有响应字段名为 camelCase（D1 列名 snake_case 已在 mappers.ts 转换）
- [ ] `PrunContractStatus` 用大写（CLOSED/FULFILLED/CANCELLED/BREACHED/TERMINATED），不是小写
- [ ] `contractJson` 字段：D1 存 TEXT，API 返回时 `JSON.parse` 为对象
- [ ] 错误响应统一 `{ error: { code, message } }` 结构
- [ ] 204 端点（logout）返回空 body
- [ ] `OPTIONS` 预检请求由 Hono `cors()` 中间件处理
- [ ] D1 `invite_codes` 的 `used_by_user_id` 在 batch 中原子更新（不会重复使用）
- [ ] refresh token 轮换：旧 token 在新 token 颁发后立即失效
- [ ] 第一个 BOARD 用户通过直接 SQL 插入（不通过邀请码）
- [ ] 最后一个 BOARD 不能被降级
- [ ] 不能接取自己发布的任务
- [ ] `expires_at` 过期任务由 Cron 自动转 CANCELLED
- [ ] `JWT_SECRET` 已通过 `wrangler secret put` 设置
- [ ] wrangler.toml 的 `database_id` 已填入实际值
- [ ] 所有 7 张 D1 表已通过 `db:migrate` 应用到生产
- [ ] 限流表 `rate_limit_buckets` 已被 Cron 清理
- [ ] 集成测试覆盖：happy path + 权限边界 + 限流 + refresh 轮换

- [ ] **Step 4: 推送到 GitHub**

```bash
git remote add origin git@github.com:<your>/rprun-org-worker.git
git push -u origin main
```

- [ ] **Step 5: 在 rprun 扩展仓库设置环境变量**

在 rprun 仓库的 `.env.development` / `.env.production`：

```
VITE_ORG_API_BASE=https://rprun-org-api.<sub>.workers.dev
```

完成。后端可投入使用。

---

## 完成标志

当以下条件全部满足时，本计划执行完毕：

1. ✅ 所有 23 个 Task 已勾选完成
2. ✅ `pnpm compile` 无错误
3. ✅ `pnpm test` 全部通过
4. ✅ Worker 已部署到 Cloudflare
5. ✅ D1 schema 已应用到生产
6. ✅ 第一个 BOARD 用户已引导创建
7. ✅ rprun 扩展前端能成功调用后端 API（注册/登录/发布/接取/link/sync/取消 全流程跑通）
8. ✅ 客户端 `src/infrastructure/org-api/types.ts` 中所有类型与后端响应严格对应

如有任何与客户端契约不符的情况，**优先修改后端以对齐客户端**（客户端已上线 8 个 commits，不轻易改动）。
