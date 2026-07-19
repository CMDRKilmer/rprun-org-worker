# XIT ORG 客户端实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Refined PrUn 扩展中实现 `XIT ORG` 面板，对接独立 Cloudflare Worker 后端，提供任务发布/接取/合同联动/董事会管理功能。

**Architecture:** 新增 `src/infrastructure/org-api/` 基础设施层（fetch + JWT + 30s 轮询，无业务逻辑）与 `src/features/XIT/ORG/` 特性层（Vue 组件 + UI 编排）。复用 CONTGEN 的 `ContractJson` 类型与 `getTileState('contgen-output')` → `showBuffer('CONTD')` 转交路径。监听 `contractsStore` 上报合同状态变化。后端契约详见 [2026-07-18-org-panel-architecture.md](./2026-07-18-org-panel-architecture.md) §12。

**Tech Stack:** TypeScript + Vue 3 (Composition API) + 浏览器 fetch + localStorage（存 access/refresh token）。无新测试框架（仓库现有约定：`pnpm test` 是 vitest stub 但未安装；本计划沿用现有"tsc 严格编译 + 手动冒烟"惯例，不为 UI 组件引入测试基础设施）。

---

## 架构计划修正（基于代码勘探）

架构文档 §7.4 中 3 个 API 形态假设需要按实际代码修正，本计划已采用修正后的形式：

| 架构文档原文 | 实际 API（本计划采用） | 文件 |
| --- | --- | --- |
| `usersStore.current.value?.username` | `usersStore.all.value?.[0]?.username`（API 单用户推送） | `src/infrastructure/prun-api/data/users.ts` |
| `companyStore.current.value?.code` | `companyStore.value?.code`（`companyStore` 是 `ShallowRef`） | `src/infrastructure/prun-api/data/company.ts` |
| `contractsStore.getById(id).status.value` | `contractsStore.getById(id)?.status`（返回普通对象，`status` 是字符串；需在 `watchEffect` 内调用以获得响应性） | `src/infrastructure/prun-api/data/contracts.ts` |

**ContractStatus 实际枚举值**（架构文档 §7.3 用了小写，本计划改为实际大写）：
`'OPEN' | 'CLOSED' | 'CANCELLED' | 'FULFILLED' | 'PARTIALLY_FULFILLED' | 'REJECTED' | 'DEADLINE_EXCEEDED' | 'BREACHED' | 'TERMINATED'`

**合同状态 → 任务状态映射**（修正后）：
- `OPEN` → 不转移（合同未被接受）
- `CLOSED` → `AWAITING_CONTRACT` → `IN_PROGRESS`
- `PARTIALLY_FULFILLED` → 不转移（已 `IN_PROGRESS`）
- `FULFILLED` → `IN_PROGRESS` → `COMPLETED`
- `CANCELLED` / `TERMINATED` / `BREACHED` / `REJECTED` / `DEADLINE_EXCEEDED` → `CANCELLED`

**Sidebar 冲突说明**：仓库历史中存在 `['组织', 'XIT FACTION']` 但已被后续 migration 重命名为 `琉璃`，且代码树中无 `XIT FACTION` 实际特性。本计划使用全新命令 `ORG` + 标签 `组织`，在 sidebar 中插入到 `XIT CART` 之后（最新位置，不影响历史 migration）。

---

## File Structure

### 新增文件

```
src/infrastructure/org-api/                      # 基础设施层（无 Vue 依赖）
├── types.ts                                      # T1: OrgUser/OrgTask/TaskStatus/TaskNote/TaskContractJson/TaskRole 等
├── session.ts                                    # T2: localStorage 读写 access/refresh token + 当前 user
├── client.ts                                     # T3: fetch wrapper + JWT 自动注入 + 401 自动刷新
├── auth.ts                                       # T4: register/login/logout/me/refresh
├── tasks.ts                                      # T5: list/create/patch/claim/release/cancel/link-contract/sync-status
├── notes.ts                                      # T6: list/create 备注
├── contract-link.ts                              # T7: 监听 contractsStore → POST sync-status
├── polling.ts                                    # T8: 30s 轮询 + 增量更新 + 通知触发 + 定期 /auth/me 同步 role
├── board.ts                                      # T9: /board/invite-codes/users/stats/audit-logs API
├── permissions.ts                                # T10: UI-only helper（isBoard/canCancelAny/canCancelTask 等）

src/features/XIT/ORG/                             # 特性层（Vue 组件）
├── ORG.ts                                        # T14: xit.add 注册
├── ORG.vue                                       # T14: 主面板（Tabs 容器）
├── tile-state.ts                                 # T14: createTileStateHook 包装（tab 等）
├── AuthOverlay.vue                               # T12: 邀请码注册 + 登录浮层
├── RoleBadge.vue                                 # T13: 当前用户角色徽章
├── TaskList.vue                                  # T15: 任务列表（按状态过滤）
├── TaskCard.vue                                  # T15: 任务卡片
├── TaskDetail.vue                                # T16: 任务详情 + 操作按钮 + 备注区
├── PublishTask.vue                               # T17: 复用 CONTGEN 表单生成 contractJson + 有效期
├── LinkContract.vue                              # T18: 上报 contractId + creator 选择
├── NoteEditor.vue                                # T19: 任务级备注编辑
├── EmptyState.vue                                # T15: 空状态
├── utils.ts                                      # T21: sendTaskToContd + 状态颜色 + 格式化
└── board/                                        # T20: 董事会专属子视图（仅 BOARD 可见）
    ├── BoardPanel.vue                            # 管理主页（左侧导航）
    ├── InviteCodes.vue                           # 邀请码生成/列表/吊销
    ├── UserManager.vue                           # 用户列表 + promote/demote
    ├── AuditLogs.vue                             # 审计日志查看
    └── Stats.vue                                 # 组织统计
```

### 修改文件

| 文件 | 修改内容 | 任务 |
| --- | --- | --- |
| `src/store/user-data.types.d.ts` | 新增 `OrgUserData` 接口（`lastViewedTab` + `lastPollAt`） | T11 |
| `src/store/user-data.ts` | 在 `initialUserData` 新增 `org: {}` 字段 | T11 |
| `src/store/user-data-migrations.ts` | 在 migrations 数组**顶部**新增 ORG migration | T11 |
| `src/features/XIT/index.ts` | 在 `./NOTE/NOTE` 之后插入 `import './ORG/ORG';` | T22 |

### 不修改文件

- `src/infrastructure/storage/crypto-secrets.ts`（架构决策：JWT 存 localStorage，详见架构 §7.5/§12.17）
- `src/store/user-data-versioned-migrations.ts`（已废弃，绝不修改）
- `CHANGELOG.md`（contributing.md 禁止在 PR 中修改）

### 文件职责边界

- `infrastructure/org-api/` 只负责 HTTP 通信与类型；无 Vue 依赖；无业务逻辑（业务在 Worker）
- `features/XIT/ORG/` 负责 UI 与编排：调用 org-api、与 CONTGEN/CONTD 集成、读 users/company/contracts store、轮询触发通知
- 不在 features 之间互相 import；`TaskContractJson` 在 `types.ts` 显式定义，与 CONTGEN 内部类型对齐但不直接 import

---

## Task 1: 定义全部类型 (`types.ts`)

**Files:**
- Create: `src/infrastructure/org-api/types.ts`

- [ ] **Step 1: 创建 types.ts 文件**

```ts
// src/infrastructure/org-api/types.ts

// 用户角色（架构 §12.21）
export type UserRole = 'BOARD' | 'COLLABORATOR';

// 任务类型（架构 §4.1）
export type TaskType = 'BUY' | 'SELL' | 'SHIP' | 'LOAN';

// 任务状态（架构 §3 状态机）
export type TaskStatus =
  | 'PUBLISHED'
  | 'AWAITING_CONTRACT'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

// 合同创建方（架构 §3 状态机说明）
export type ContractCreator = 'publisher' | 'claimer';

// 用户（架构 §4.1）
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

// 合同 JSON（与 CONTGEN.vue 第 13-39 行 ContractJson 对齐）
export interface TaskContractItem {
  commodity: string;
  amount: number;
  price?: number;
}

export interface TaskContractJson {
  template: 'BUY' | 'SELL' | 'SHIP'; // LOAN 暂不支持，留待后期
  currency: string;
  name?: string;
  location?: string;
  origin?: string;
  destination?: string;
  price?: number;
  deadline?: number;
  items: TaskContractItem[];
}

// 任务（架构 §4.1）
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

// 任务备注（架构 §4.1）
export interface TaskNote {
  id: string;
  taskId: string;
  authorId: string;
  authorUsername: string;
  content: string;
  createdAt: string;
}

// 邀请码（架构 §12.4 invite_codes 表）
export interface InviteCode {
  id: string;
  code: string;
  createdBy: string;
  createdAt: string;
  usedByUserId?: string;
  usedAt?: string;
  revokedAt?: string;
}

// 审计日志（架构 §12.4 audit_logs 表）
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

// 认证响应（架构 §12.8）
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: OrgUser;
}

// API 错误响应（架构 §12.9 错误格式）
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// 轮询游标
export type PollScope = 'board' | 'published' | 'claimed';

// PrUn 合同状态枚举（与 src/infrastructure/prun-api/data/contracts.types.d.ts 对齐）
export type PrunContractStatus =
  | 'OPEN'
  | 'CLOSED'
  | 'CANCELLED'
  | 'FULFILLED'
  | 'PARTIALLY_FULFILLED'
  | 'REJECTED'
  | 'DEADLINE_EXCEEDED'
  | 'BREACHED'
  | 'TERMINATED';
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `pnpm compile`
Expected: PASS（无错误；新文件被 tsc 识别）

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/types.ts
git commit -m "feat(org): add shared types for ORG API client"
```

---

## Task 2: localStorage 会话管理 (`session.ts`)

**Files:**
- Create: `src/infrastructure/org-api/session.ts`

- [ ] **Step 1: 创建 session.ts**

```ts
// src/infrastructure/org-api/session.ts
import type { AuthSession, OrgUser } from './types';

const ACCESS_TOKEN_KEY = 'rprun-org-access-token';
const REFRESH_TOKEN_KEY = 'rprun-org-refresh-token';
const USER_KEY = 'rprun-org-user';

// 仅在扩展上下文可用时操作 localStorage
// （扩展 background/content 上下文与页面 localStorage 隔离）

export function loadSession(): AuthSession | null {
  try {
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const userJson = localStorage.getItem(USER_KEY);
    if (!accessToken || !refreshToken || !userJson) {
      return null;
    }
    const user = JSON.parse(userJson) as OrgUser;
    return { accessToken, refreshToken, user };
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

// 仅更新 user（用于 /auth/me 拉取最新 role 后）
export function updateUser(user: OrgUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// 仅更新 tokens（用于 /auth/refresh 滚动续期）
export function updateTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/session.ts
git commit -m "feat(org): add localStorage session storage"
```

---

## Task 3: fetch wrapper + 401 自动刷新 (`client.ts`)

**Files:**
- Create: `src/infrastructure/org-api/client.ts`

- [ ] **Step 1: 创建 client.ts**

```ts
// src/infrastructure/org-api/client.ts
import type { ApiError, AuthSession } from './types';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  loadSession,
  saveSession,
  updateTokens,
} from './session';

// API base URL（架构 §12.15 VITE_ORG_API_BASE）
const API_BASE = import.meta.env.VITE_ORG_API_BASE || 'http://localhost:8787';

// 全局未登录回调（被 ORG.vue 注册，触发 AuthOverlay 显示）
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorizedCallback(cb: () => void): void {
  onUnauthorized = cb;
}

// 刷新锁：防止并发 401 同时刷新
let refreshPromise: Promise<AuthSession | null> | null = null;

async function refreshSession(): Promise<AuthSession | null> {
  if (refreshPromise) {
    return refreshPromise;
  }
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearSession();
    onUnauthorized?.();
    return null;
  }
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearSession();
        onUnauthorized?.();
        return null;
      }
      const session = (await res.json()) as AuthSession;
      // 后端返回新 access + refresh + user
      saveSession(session);
      return session;
    } catch {
      clearSession();
      onUnauthorized?.();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  // 跳过鉴权（用于 /auth/register /auth/login /auth/refresh）
  skipAuth?: boolean;
  // 跳过 JSON Content-Type（用于 FormData 等，本计划暂未使用）
  rawBody?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!options.rawBody && options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!options.skipAuth) {
    const token = getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? (options.rawBody ? options.body as BodyInit : JSON.stringify(options.body)) : undefined,
    });

  let res = await doFetch();

  // 401 自动刷新一次
  if (res.status === 401 && !options.skipAuth) {
    const newSession = await refreshSession();
    if (newSession) {
      headers['Authorization'] = `Bearer ${newSession.accessToken}`;
      res = await doFetch();
    }
  }

  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = res.statusText;
    try {
      const err = (await res.json()) as ApiError;
      code = err.error?.code ?? code;
      message = err.error?.message ?? message;
    } catch {
      // 响应非 JSON，使用默认
    }
    throw new HttpError(res.status, code, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// 启动时加载已存会话（用于 ORG.vue 判断是否需要显示 AuthOverlay）
export function getStoredSession(): AuthSession | null {
  return loadSession();
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/client.ts
git commit -m "feat(org): add fetch wrapper with JWT auto-refresh"
```

---

## Task 4: 认证 API (`auth.ts`)

**Files:**
- Create: `src/infrastructure/org-api/auth.ts`

- [ ] **Step 1: 创建 auth.ts**

```ts
// src/infrastructure/org-api/auth.ts
import type { AuthSession, OrgUser } from './types';
import { request } from './client';
import { clearSession, saveSession } from './session';

interface RegisterParams {
  email: string;
  password: string;
  inviteCode: string;
  prunUsername: string;
  companyCode: string;
}

export async function register(params: RegisterParams): Promise<AuthSession> {
  const session = await request<AuthSession>('/auth/register', {
    method: 'POST',
    body: params,
    skipAuth: true,
  });
  saveSession(session);
  return session;
}

interface LoginParams {
  email: string;
  password: string;
}

export async function login(params: LoginParams): Promise<AuthSession> {
  const session = await request<AuthSession>('/auth/login', {
    method: 'POST',
    body: params,
    skipAuth: true,
  });
  saveSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem('rprun-org-refresh-token');
  if (refreshToken) {
    try {
      await request('/auth/logout', {
        method: 'POST',
        body: { refreshToken },
      });
    } catch {
      // 即使后端调用失败也清本地（如网络断开）
    }
  }
  clearSession();
}

export async function fetchMe(): Promise<OrgUser> {
  return request<OrgUser>('/auth/me');
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/auth.ts
git commit -m "feat(org): add auth API client"
```

---

## Task 5: 任务 API (`tasks.ts`)

**Files:**
- Create: `src/infrastructure/org-api/tasks.ts`

- [ ] **Step 1: 创建 tasks.ts**

```ts
// src/infrastructure/org-api/tasks.ts
import type { OrgTask, PollScope, TaskContractJson, TaskType } from './types';
import { request } from './client';

export interface ListTasksParams {
  scope: PollScope;
  type?: TaskType;
  publisherUsername?: string;
  claimerUsername?: string;
  location?: string;
  since?: string; // ISO 8601，仅返回 updatedAt > since 的任务
  limit?: number;
  cursor?: string;
}

export async function listTasks(params: ListTasksParams): Promise<OrgTask[]> {
  const search = new URLSearchParams();
  search.set('scope', params.scope);
  if (params.type) search.set('type', params.type);
  if (params.publisherUsername) search.set('publisherUsername', params.publisherUsername);
  if (params.claimerUsername) search.set('claimerUsername', params.claimerUsername);
  if (params.location) search.set('location', params.location);
  if (params.since) search.set('since', params.since);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  return request<OrgTask[]>(`/tasks?${search.toString()}`);
}

export async function getTask(taskId: string): Promise<OrgTask> {
  return request<OrgTask>(`/tasks/${taskId}`);
}

export interface CreateTaskParams {
  type: TaskType;
  contractJson: TaskContractJson;
  expiresAt?: string;
}

export async function createTask(params: CreateTaskParams): Promise<OrgTask> {
  return request<OrgTask>('/tasks', {
    method: 'POST',
    body: params,
  });
}

export interface PatchTaskParams {
  contractJson?: TaskContractJson;
  expiresAt?: string;
}

export async function patchTask(taskId: string, params: PatchTaskParams): Promise<OrgTask> {
  return request<OrgTask>(`/tasks/${taskId}`, {
    method: 'PATCH',
    body: params,
  });
}

export async function claimTask(taskId: string): Promise<OrgTask> {
  return request<OrgTask>(`/tasks/${taskId}/claim`, { method: 'POST' });
}

export async function releaseTask(taskId: string): Promise<OrgTask> {
  return request<OrgTask>(`/tasks/${taskId}/release`, { method: 'POST' });
}

export async function cancelTask(taskId: string, reason?: string): Promise<OrgTask> {
  return request<OrgTask>(`/tasks/${taskId}/cancel`, {
    method: 'POST',
    body: reason !== undefined ? { reason } : undefined,
  });
}

export interface LinkContractParams {
  contractId: string;
  contractCreator: 'publisher' | 'claimer';
}

export async function linkContract(taskId: string, params: LinkContractParams): Promise<OrgTask> {
  return request<OrgTask>(`/tasks/${taskId}/link-contract`, {
    method: 'POST',
    body: params,
  });
}

export async function syncContractStatus(
  taskId: string,
  contractStatus: string,
): Promise<OrgTask> {
  return request<OrgTask>(`/tasks/${taskId}/sync-status`, {
    method: 'POST',
    body: { contractStatus },
  });
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/tasks.ts
git commit -m "feat(org): add tasks API client"
```

---

## Task 6: 备注 API (`notes.ts`)

**Files:**
- Create: `src/infrastructure/org-api/notes.ts`

- [ ] **Step 1: 创建 notes.ts**

```ts
// src/infrastructure/org-api/notes.ts
import type { TaskNote } from './types';
import { request } from './client';

export async function listNotes(taskId: string): Promise<TaskNote[]> {
  return request<TaskNote[]>(`/tasks/${taskId}/notes`);
}

export async function createNote(taskId: string, content: string): Promise<TaskNote> {
  return request<TaskNote>(`/tasks/${taskId}/notes`, {
    method: 'POST',
    body: { content },
  });
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/notes.ts
git commit -m "feat(org): add notes API client"
```

---

## Task 7: 合同状态监听 (`contract-link.ts`)

**Files:**
- Create: `src/infrastructure/org-api/contract-link.ts`

- [ ] **Step 1: 创建 contract-link.ts**

```ts
// src/infrastructure/org-api/contract-link.ts
import { contractsStore } from '@src/infrastructure/prun-api/data/contracts';
import type { OrgTask, PrunContractStatus } from './types';
import { syncContractStatus } from './tasks';

// 已上报过的状态记录，避免重复上报（同一状态多次触发只发一次）
const reportedStatuses = new Map<string, Set<string>>();

// 合同状态 → 是否触发任务状态转移（架构 §7.3 修正后）
// CLOSED → IN_PROGRESS, FULFILLED → COMPLETED, CANCELLED/TERMINATED/BREACHED/REJECTED/DEADLINE_EXCEEDED → CANCELLED
const TRANSITION_STATUSES: ReadonlySet<PrunContractStatus> = new Set([
  'CLOSED',
  'FULFILLED',
  'CANCELLED',
  'TERMINATED',
  'BREACHED',
  'REJECTED',
  'DEADLINE_EXCEEDED',
]);

// 监听任务关联合同的状态变化，自动上报 Worker
// 调用方在 watchEffect 内调用以获得响应性
export function watchContractStatus(task: OrgTask): void {
  if (!task.contractId) {
    return;
  }
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    return;
  }
  const contract = contractsStore.getById(task.contractId);
  if (!contract) {
    return;
  }
  const status = contract.status as PrunContractStatus;
  if (!TRANSITION_STATUSES.has(status)) {
    return;
  }
  const reported = reportedStatuses.get(task.id) ?? new Set<string>();
  if (reported.has(status)) {
    return;
  }
  reported.add(status);
  reportedStatuses.set(task.id, reported);
  // fire-and-forget；Worker 内会再做幂等校验
  void syncContractStatus(task.id, status).catch(err => {
    console.warn(`[ORG] syncContractStatus failed for task ${task.id}:`, err);
    // 失败时移除记录，允许下次重试
    reported.delete(status);
  });
}

// 任务详情页关闭时清理记录（避免内存泄漏）
export function clearReportedStatus(taskId: string): void {
  reportedStatuses.delete(taskId);
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/contract-link.ts
git commit -m "feat(org): add contract status watcher linking to Worker"
```

---

## Task 8: 30s 轮询 + 通知 (`polling.ts`)

**Files:**
- Create: `src/infrastructure/org-api/polling.ts`

- [ ] **Step 1: 创建 polling.ts**

```ts
// src/infrastructure/org-api/polling.ts
import type { OrgTask, OrgUser, TaskStatus } from './types';
import { listTasks } from './tasks';
import { fetchMe } from './auth';
import { updateUser } from './session';

const POLL_INTERVAL_MS = 30_000;
const ROLE_REFRESH_INTERVAL_MS = 60_000; // 每分钟刷新一次 role

export interface PollCallbacks {
  // 任务状态变化时触发（用于面板内 Badge + PrUn NOTS 通知）
  onTaskStatusChanged: (task: OrgTask, oldStatus: TaskStatus, newStatus: TaskStatus) => void;
  // 新任务出现时触发
  onNewTask: (task: OrgTask) => void;
  // role 变化时触发（用于刷新 UI 权限）
  onRoleChanged: (oldRole: string, newRole: string) => void;
  // 拉取错误时触发（用于显示错误提示）
  onError: (err: unknown) => void;
}

// 本地缓存：taskId → lastSeenStatus，用于检测变化
const taskStatusCache = new Map<string, TaskStatus>();
let lastPollAt: string | null = null;
let lastRoleRefreshAt = 0;
let currentUser: OrgUser | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function setCurrentUser(user: OrgUser | null): void {
  currentUser = user;
}

async function pollOnce(callbacks: PollCallbacks): Promise<void> {
  if (!currentUser) {
    return;
  }
  // 拉取任务板增量
  try {
    const tasks = await listTasks({
      scope: 'board',
      since: lastPollAt ?? undefined,
      limit: 100,
    });
    for (const task of tasks) {
      const oldStatus = taskStatusCache.get(task.id);
      if (oldStatus === undefined) {
        taskStatusCache.set(task.id, task.status);
        if (lastPollAt !== null) {
          // 非首次拉取的新任务
          callbacks.onNewTask(task);
        }
      } else if (oldStatus !== task.status) {
        taskStatusCache.set(task.id, task.status);
        callbacks.onTaskStatusChanged(task, oldStatus, task.status);
      }
    }
    if (tasks.length > 0) {
      lastPollAt = tasks[tasks.length - 1].updatedAt;
    }
  } catch (err) {
    callbacks.onError(err);
  }

  // 定期刷新 role（架构 §12.21.4）
  const now = Date.now();
  if (now - lastRoleRefreshAt > ROLE_REFRESH_INTERVAL_MS) {
    lastRoleRefreshAt = now;
    try {
      const me = await fetchMe();
      if (currentUser.role !== me.role) {
        const oldRole = currentUser.role;
        currentUser = me;
        updateUser(me);
        callbacks.onRoleChanged(oldRole, me.role);
      }
    } catch {
      // role 刷新失败不阻塞主轮询
    }
  }
}

export function startPolling(callbacks: PollCallbacks): void {
  if (pollTimer) {
    return;
  }
  // 立即拉取一次
  if (!running) {
    running = true;
    void pollOnce(callbacks).finally(() => {
      running = false;
    });
  }
  pollTimer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void pollOnce(callbacks).finally(() => {
      running = false;
    });
  }, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  taskStatusCache.clear();
  lastPollAt = null;
  lastRoleRefreshAt = 0;
}

// 重置缓存（登出/切换用户时调用）
export function resetPollingState(): void {
  stopPolling();
  currentUser = null;
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/polling.ts
git commit -m "feat(org): add 30s polling with status change notifications"
```

---

## Task 9: 董事会 API (`board.ts`)

**Files:**
- Create: `src/infrastructure/org-api/board.ts`

- [ ] **Step 1: 创建 board.ts**

```ts
// src/infrastructure/org-api/board.ts
import type { AuditLog, InviteCode, OrgUser } from './types';
import { request } from './client';

export interface GenerateInviteCodesParams {
  count: number;
  createdBy: string;
}

export async function generateInviteCodes(
  params: GenerateInviteCodesParams,
): Promise<InviteCode[]> {
  return request<InviteCode[]>('/board/invite-codes', {
    method: 'POST',
    body: params,
  });
}

export async function listInviteCodes(): Promise<InviteCode[]> {
  return request<InviteCode[]>('/board/invite-codes');
}

export async function revokeInviteCode(id: string): Promise<InviteCode> {
  return request<InviteCode>(`/board/invite-codes/${id}/revoke`, { method: 'POST' });
}

export async function listUsers(): Promise<OrgUser[]> {
  return request<OrgUser[]>('/board/users');
}

export async function promoteUser(userId: string): Promise<OrgUser> {
  return request<OrgUser>(`/board/users/${userId}/promote`, { method: 'POST' });
}

export async function demoteUser(userId: string): Promise<OrgUser> {
  return request<OrgUser>(`/board/users/${userId}/demote`, { method: 'POST' });
}

export interface OrgStats {
  userCount: number;
  taskCount: number;
  boardCount: number;
  collaboratorCount: number;
  tasksByStatus: Record<string, number>;
}

export async function fetchStats(): Promise<OrgStats> {
  return request<OrgStats>('/board/stats');
}

export interface ListAuditLogsParams {
  limit?: number;
  cursor?: string;
  action?: string;
  actorId?: string;
}

export async function listAuditLogs(
  params: ListAuditLogsParams = {},
): Promise<AuditLog[]> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.action) search.set('action', params.action);
  if (params.actorId) search.set('actorId', params.actorId);
  return request<AuditLog[]>(`/board/audit-logs?${search.toString()}`);
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/board.ts
git commit -m "feat(org): add board administration API client"
```

---

## Task 10: 客户端权限 helper (`permissions.ts`)

**Files:**
- Create: `src/infrastructure/org-api/permissions.ts`

- [ ] **Step 1: 创建 permissions.ts**

```ts
// src/infrastructure/org-api/permissions.ts
import type { OrgTask, OrgUser } from './types';

// 注意（架构 §12.21.2）：这些 helper 仅用于 UI 显示控制
// 任何敏感操作的实际权限校验都在 Worker 内（boardOnly 中间件 + cancelTask 内 role 校验）

export function isBoard(user: OrgUser | null | undefined): boolean {
  return user?.role === 'BOARD';
}

export function canCancelAny(user: OrgUser | null | undefined): boolean {
  return isBoard(user);
}

export function canCancelTask(
  user: OrgUser | null | undefined,
  task: OrgTask,
): boolean {
  if (!user) {
    return false;
  }
  // 发布者可取消自己任务；BOARD 可取消任何任务
  return task.publisherId === user.id || isBoard(user);
}

export function canSeeBoardPanel(user: OrgUser | null | undefined): boolean {
  return isBoard(user);
}

// BOARD 可升降级他人，但不能降级自己
export function canPromoteDemote(
  user: OrgUser | null | undefined,
  targetUserId: string,
): boolean {
  return isBoard(user) && user!.id !== targetUserId;
}

// 是否显示"取消他人任务"按钮（仅 BOARD 且非自己任务）
export function shouldShowBoardCancel(
  user: OrgUser | null | undefined,
  task: OrgTask,
): boolean {
  return isBoard(user) && task.publisherId !== user?.id;
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/org-api/permissions.ts
git commit -m "feat(org): add UI-only permission helpers"
```

---

## Task 11: userData migration

**Files:**
- Modify: `src/store/user-data.types.d.ts`
- Modify: `src/store/user-data.ts`
- Modify: `src/store/user-data-migrations.ts`

- [ ] **Step 1: 在 user-data.types.d.ts 末尾添加 OrgUserData 接口**

读取 `/workspace/src/store/user-data.types.d.ts`，在 `declare namespace UserData` 内末尾（最后一个 `}` 之前）添加：

```ts
  interface OrgUserData {
    lastViewedTab?: 'board' | 'published' | 'claimed';
    lastPollAt?: string;
  }
```

- [ ] **Step 2: 在 initialUserData 新增 org 字段**

修改 `/workspace/src/store/user-data.ts`：在 `initialUserData` 对象内（建议放在 `tileState` 之后、`settings` 之前，与现有顺序一致）添加：

```ts
  org: {} as UserData.OrgUserData,
```

- [ ] **Step 3: 在 user-data-migrations.ts 顶部添加 migration**

在 `/workspace/src/store/user-data-migrations.ts` 的 `migrations` 数组**最顶部**（在现有第一个 migration 之前）插入：

```ts
  [
    '19.07.2026 Add ORG user data',
    userData => {
      if (!userData.org) {
        userData.org = {};
      }
      userData.org.lastViewedTab ??= undefined;
      userData.org.lastPollAt ??= undefined;
    },
  ],
```

注意：不向 `settings.sidebar` 添加 `XIT ORG` 条目（用户可在 XIT SET 中手动添加；避免对所有用户强制显示）。

- [ ] **Step 4: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/user-data.types.d.ts src/store/user-data.ts src/store/user-data-migrations.ts
git commit -m "feat(org): add OrgUserData migration"
```

---

## Task 12: AuthOverlay.vue（注册/登录浮层）

**Files:**
- Create: `src/features/XIT/ORG/AuthOverlay.vue`

- [ ] **Step 1: 创建 AuthOverlay.vue**

```vue
<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { AuthSession } from '@src/infrastructure/org-api/types';
import * as authApi from '@src/infrastructure/org-api/auth';
import { HttpError } from '@src/infrastructure/org-api/client';
import { companyStore } from '@src/infrastructure/prun-api/data/company';
import { usersStore } from '@src/infrastructure/prun-api/data/users';

type Mode = 'login' | 'register';

const mode = ref<Mode>('login');
const email = ref('');
const password = ref('');
const inviteCode = ref('');
const errorMessage = ref('');
const loading = ref(false);

const emit = defineEmits<{
  (e: 'authenticated', session: AuthSession): void;
}>();

// 当前 PrUn 身份（从 store 读取，修正后 API 形态）
const prunUsername = computed(() => usersStore.all.value?.[0]?.username ?? '');
const companyCode = computed(() => companyStore.value?.code ?? '');

const canSubmit = computed(() => {
  if (loading.value) {
    return false;
  }
  if (!email.value || !password.value) {
    return false;
  }
  if (mode.value === 'register') {
    if (!inviteCode.value) {
      return false;
    }
    if (!prunUsername.value || !companyCode.value) {
      return false;
    }
  }
  return true;
});

async function onSubmit() {
  if (!canSubmit.value) {
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    let session: AuthSession;
    if (mode.value === 'register') {
      session = await authApi.register({
        email: email.value,
        password: password.value,
        inviteCode: inviteCode.value,
        prunUsername: prunUsername.value,
        companyCode: companyCode.value,
      });
    } else {
      session = await authApi.login({
        email: email.value,
        password: password.value,
      });
      // 登录后校验当前 PrUn 身份与后端记录一致
      if (
        session.user.prunUsername !== prunUsername.value ||
        session.user.companyCode !== companyCode.value
      ) {
        await authApi.logout();
        throw new HttpError(
          400,
          'PRUN_IDENTITY_MISMATCH',
          '当前 PrUn 身份与注册时不一致，请切换 PrUn 账号或重新登录',
        );
      }
    }
    emit('authenticated', session);
  } catch (err) {
    if (err instanceof HttpError) {
      errorMessage.value = err.message;
    } else {
      errorMessage.value = '网络错误，请稍后重试';
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div :class="$style.overlay">
    <div :class="$style.card">
      <h2 :class="$style.title">组织管理面板</h2>
      <div :class="$style.tabs">
        <button
          :class="[$style.tab, mode === 'login' && $style.active]"
          @click="mode = 'login'">登录</button>
        <button
          :class="[$style.tab, mode === 'register' && $style.active]"
          @click="mode = 'register'">注册（需邀请码）</button>
      </div>

      <form :class="$style.form" @submit.prevent="onSubmit">
        <label :class="$style.field">
          <span>邮箱</span>
          <input v-model="email" type="email" required autocomplete="email" />
        </label>
        <label :class="$style.field">
          <span>密码</span>
          <input v-model="password" type="password" required autocomplete="current-password" />
        </label>
        <template v-if="mode === 'register'">
          <label :class="$style.field">
            <span>邀请码</span>
            <input v-model="inviteCode" required placeholder="10 字符" />
          </label>
          <div :class="$style.identity">
            将绑定 PrUn 身份：
            <strong>{{ prunUsername || '未读取到' }}</strong>
            / {{ companyCode || '未读取到' }}
          </div>
        </template>

        <div v-if="errorMessage" :class="$style.error">{{ errorMessage }}</div>

        <button type="submit" :disabled="!canSubmit" :class="$style.submit">
          {{ loading ? '处理中...' : mode === 'login' ? '登录' : '注册' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style module>
.overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.card {
  width: 100%;
  max-width: 420px;
  background: var(--panel-background);
  border: 1px solid var(--panel-border);
  padding: 24px;
}
.title {
  margin: 0 0 16px;
  font-size: 18px;
}
.tabs {
  display: flex;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--panel-border);
}
.tab {
  flex: 1;
  padding: 8px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}
.tab.active {
  color: var(--text);
  border-bottom: 2px solid var(--accent);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.field input {
  padding: 6px 8px;
  border: 1px solid var(--panel-border);
  background: var(--input-background);
  color: var(--text);
}
.identity {
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px;
  background: var(--panel-background-alt);
}
.error {
  color: var(--text-negative);
  font-size: 12px;
}
.submit {
  margin-top: 8px;
  padding: 8px 16px;
  border: 1px solid var(--panel-border);
  background: var(--accent);
  color: var(--text-on-accent);
  cursor: pointer;
}
.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/XIT/ORG/AuthOverlay.vue
git commit -m "feat(org): add AuthOverlay with register/login"
```

---

## Task 13: RoleBadge.vue

**Files:**
- Create: `src/features/XIT/ORG/RoleBadge.vue`

- [ ] **Step 1: 创建 RoleBadge.vue**

```vue
<script setup lang="ts">
import type { OrgUser } from '@src/infrastructure/org-api/types';
import { computed } from 'vue';

const props = defineProps<{ user: OrgUser | null }>();

const label = computed(() => {
  if (!props.user) {
    return '';
  }
  return props.user.role === 'BOARD' ? '董事会' : '合作者';
});
</script>

<template>
  <span
    v-if="user"
    :class="[$style.badge, user.role === 'BOARD' ? $style.board : $style.collaborator]">
    {{ label }}
  </span>
</template>

<style module>
.badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 2px;
  border: 1px solid var(--panel-border);
}
.board {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}
.collaborator {
  color: var(--text-muted);
}
</style>
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/XIT/ORG/RoleBadge.vue
git commit -m "feat(org): add RoleBadge component"
```

---

## Task 14: ORG.ts 注册 + ORG.vue 主面板 + tile-state.ts

**Files:**
- Create: `src/features/XIT/ORG/ORG.ts`
- Create: `src/features/XIT/ORG/ORG.vue`
- Create: `src/features/XIT/ORG/tile-state.ts`

- [ ] **Step 1: 创建 tile-state.ts**

```ts
// src/features/XIT/ORG/tile-state.ts
import { createTileStateHook } from '@src/store/user-data-tiles';

export const useOrgTileState = createTileStateHook({
  tab: 'board' as 'board' | 'published' | 'claimed',
});
```

- [ ] **Step 2: 创建 ORG.vue**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import type { AuthSession, OrgUser, TaskStatus } from '@src/infrastructure/org-api/types';
import { getStoredSession } from '@src/infrastructure/org-api/client';
import { setOnUnauthorizedCallback } from '@src/infrastructure/org-api/client';
import * as authApi from '@src/infrastructure/org-api/auth';
import {
  resetPollingState,
  setCurrentUser,
  startPolling,
  stopPolling,
  type PollCallbacks,
} from '@src/infrastructure/org-api/polling';
import { canSeeBoardPanel } from '@src/infrastructure/org-api/permissions';
import { useOrgTileState } from './tile-state';
import AuthOverlay from './AuthOverlay.vue';
import RoleBadge from './RoleBadge.vue';
import TaskList from './TaskList.vue';
import PublishTask from './PublishTask.vue';
import BoardPanel from './board/BoardPanel.vue';

const session = ref<AuthSession | null>(getStoredSession());
const currentUser = computed<OrgUser | null>(() => session.value?.user ?? null);
const tab = useOrgTileState('tab');

// 触发 AuthOverlay 显示（401 时）
const showAuth = ref(false);
setOnUnauthorizedCallback(() => {
  session.value = null;
  showAuth.value = true;
  resetPollingState();
});

// 任务状态变化通知（架构 §12.11）
const pollCallbacks: PollCallbacks = {
  onTaskStatusChanged: (task, oldStatus, newStatus) => {
    console.info(`[ORG] Task ${task.id} status: ${oldStatus} → ${newStatus}`);
    // TODO: 接入 PrUn NOTS 通知（架构 §7.3 双通道通知）
    // 暂用 console + 面板内 Badge（TaskList 内通过轮询刷新自动反映）
  },
  onNewTask: task => {
    console.info(`[ORG] New task: ${task.id}`);
  },
  onRoleChanged: (oldRole, newRole) => {
    console.info(`[ORG] Role changed: ${oldRole} → ${newRole}`);
    // role 变化时刷新 /auth/me 同步本地 user
    void authApi.fetchMe().then(user => {
      if (session.value) {
        session.value = { ...session.value, user };
      }
    });
  },
  onError: err => {
    console.warn('[ORG] Polling error:', err);
  },
};

onMounted(() => {
  if (session.value) {
    setCurrentUser(session.value.user);
    startPolling(pollCallbacks);
  } else {
    showAuth.value = true;
  }
});

onBeforeUnmount(() => {
  stopPolling();
});

function onAuthenticated(newSession: AuthSession) {
  session.value = newSession;
  showAuth.value = false;
  setCurrentUser(newSession.user);
  resetPollingState();
  setCurrentUser(newSession.user);
  startPolling(pollCallbacks);
}

async function onLogout() {
  await authApi.logout();
  session.value = null;
  showAuth.value = true;
  resetPollingState();
}

const tabs = computed(() => {
  const list: Array<{ key: 'board' | 'published' | 'claimed' | 'publish' | 'board-admin'; label: string }> = [
    { key: 'board', label: '任务板' },
    { key: 'published', label: '我的发布' },
    { key: 'claimed', label: '我的接取' },
    { key: 'publish', label: '发布任务' },
  ];
  if (canSeeBoardPanel(currentUser.value)) {
    list.push({ key: 'board-admin', label: '管理' });
  }
  return list;
});
</script>

<template>
  <div :class="$style.container">
    <AuthOverlay v-if="showAuth" @authenticated="onAuthenticated" />
    <template v-else-if="session">
      <header :class="$style.header">
        <span :class="$style.user">{{ session.user.displayName }}</span>
        <RoleBadge :user="session.user" />
        <button :class="$style.logout" @click="onLogout">登出</button>
      </header>
      <nav :class="$style.tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          :class="[$style.tab, tab === t.key && $style.active]"
          @click="tab = t.key">
          {{ t.label }}
        </button>
      </nav>
      <main :class="$style.content">
        <TaskList v-if="tab === 'board' || tab === 'published' || tab === 'claimed'" :scope="tab" :current-user="session.user" />
        <PublishTask v-else-if="tab === 'publish'" />
        <BoardPanel v-else-if="tab === 'board-admin'" :current-user="session.user" />
      </main>
    </template>
  </div>
</template>

<style module>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
}
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--panel-border);
}
.user {
  font-weight: 600;
}
.logout {
  margin-left: auto;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--panel-border);
  color: var(--text-muted);
  cursor: pointer;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 0;
  border-bottom: 1px solid var(--panel-border);
}
.tab {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.tab.active {
  color: var(--text);
  border-color: var(--panel-border);
  background: var(--panel-background-alt);
}
.content {
  flex: 1;
  overflow: auto;
  padding-top: 8px;
}
</style>
```

- [ ] **Step 3: 创建 ORG.ts**

```ts
// src/features/XIT/ORG/ORG.ts
import ORG from '@src/features/XIT/ORG/ORG.vue';

xit.add({
  command: 'ORG',
  name: '组织',
  description: '组织任务管理面板：发布/接取/合同联动/董事会管理。',
  component: () => ORG,
  bufferSize: [800, 600],
});
```

- [ ] **Step 4: 验证编译**

Run: `pnpm compile`
Expected: PASS（TaskList/PublishTask/BoardPanel 引用的文件可能还未创建，编译可能报错——若报错，先注释 ORG.vue 中的相关 import 与使用，等 T15/T17/T20 完成后再启用）

如编译失败，临时方案：在 ORG.vue 顶部 import 处用 `// @ts-expect-error 待 T15/T17/T20 创建` 占位，并在 `<main>` 内对未创建组件改用 `<div>待实现</div>` 占位。后续任务完成后恢复。

- [ ] **Step 5: Commit**

```bash
git add src/features/XIT/ORG/ORG.ts src/features/XIT/ORG/ORG.vue src/features/XIT/ORG/tile-state.ts
git commit -m "feat(org): add ORG main panel with tab navigation"
```

---

## Task 15: TaskList.vue + TaskCard.vue + EmptyState.vue

**Files:**
- Create: `src/features/XIT/ORG/TaskList.vue`
- Create: `src/features/XIT/ORG/TaskCard.vue`
- Create: `src/features/XIT/ORG/EmptyState.vue`

- [ ] **Step 1: 创建 EmptyState.vue**

```vue
<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<template>
  <div :class="$style.empty">{{ message }}</div>
</template>

<style module>
.empty {
  padding: 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
```

- [ ] **Step 2: 创建 TaskCard.vue**

```vue
<script setup lang="ts">
import type { OrgTask, OrgUser } from '@src/infrastructure/org-api/types';
import { computed } from 'vue';

const props = defineProps<{ task: OrgTask; currentUser: OrgUser | null }>();

const emit = defineEmits<{ (e: 'click', task: OrgTask): void }>();

// 显示用摘要字段
const itemSummary = computed(() => {
  const items = props.task.contractJson.items ?? [];
  if (items.length === 0) {
    return '无物品';
  }
  if (items.length === 1) {
    return `${items[0].amount}× ${items[0].commodity}`;
  }
  return `${items[0].amount}× ${items[0].commodity} 等 ${items.length} 项`;
});

const locationText = computed(() => {
  const c = props.task.contractJson;
  if (props.task.type === 'SHIP') {
    return `${c.origin ?? '?'} → ${c.destination ?? '?'}`;
  }
  return c.location ?? '无位置';
});

const priceText = computed(() => {
  const c = props.task.contractJson;
  if (c.price !== undefined) {
    return `${c.price} ${c.currency}`;
  }
  const itemsTotal = (c.items ?? []).reduce((sum, i) => sum + (i.price ?? 0) * i.amount, 0);
  return itemsTotal > 0 ? `${itemsTotal} ${c.currency}` : '—';
});

const expiresText = computed(() => {
  if (!props.task.expiresAt) {
    return '';
  }
  return `有效期至 ${new Date(props.task.expiresAt).toLocaleString()}`;
});

const typeLabel = computed(() => {
  switch (props.task.type) {
    case 'BUY': return '采购';
    case 'SELL': return '出售';
    case 'SHIP': return '运输';
    case 'LOAN': return '借贷';
  }
});

const statusColor = computed(() => {
  switch (props.task.status) {
    case 'PUBLISHED': return 'var(--text-muted)';
    case 'AWAITING_CONTRACT': return 'var(--text-warning, #f0ad4e)';
    case 'IN_PROGRESS': return 'var(--accent)';
    case 'COMPLETED': return 'var(--text-positive, #5cb85c)';
    case 'CANCELLED': return 'var(--text-negative, #d9534f)';
  }
});
</script>

<template>
  <div :class="$style.card" @click="emit('click', task)">
    <div :class="$style.header">
      <span :class="$style.type">{{ typeLabel }}</span>
      <span :class="$style.status" :style="{ color: statusColor }">{{ task.status }}</span>
    </div>
    <div :class="$style.title">{{ task.contractJson.name || task.type }}</div>
    <div :class="$style.row">
      <span>物品：{{ itemSummary }}</span>
      <span>价格：{{ priceText }}</span>
    </div>
    <div :class="$style.row">
      <span>位置：{{ locationText }}</span>
      <span>发布者：{{ task.publisherUsername }}</span>
    </div>
    <div v-if="expiresText" :class="$style.expires">{{ expiresText }}</div>
  </div>
</template>

<style module>
.card {
  padding: 12px;
  border: 1px solid var(--panel-border);
  background: var(--panel-background);
  cursor: pointer;
}
.card:hover {
  background: var(--panel-background-alt);
}
.header {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  margin-bottom: 4px;
}
.type {
  color: var(--accent);
  font-weight: 600;
}
.title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
}
.row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 2px;
}
.expires {
  font-size: 11px;
  color: var(--text-warning, #f0ad4e);
  margin-top: 4px;
}
</style>
```

- [ ] **Step 3: 创建 TaskList.vue**

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { OrgTask, OrgUser, PollScope } from '@src/infrastructure/org-api/types';
import * as tasksApi from '@src/infrastructure/org-api/tasks';
import TaskCard from './TaskCard.vue';
import TaskDetail from './TaskDetail.vue';
import EmptyState from './EmptyState.vue';

const props = defineProps<{
  scope: PollScope;
  currentUser: OrgUser;
}>();

const tasks = ref<OrgTask[]>([]);
const loading = ref(false);
const error = ref('');
const selectedTask = ref<OrgTask | null>(null);

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    tasks.value = await tasksApi.listTasks({ scope: props.scope, limit: 100 });
  } catch (err) {
    error.value = String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);
watch(() => props.scope, refresh);

// 简单刷新：外部可通过轮询间接刷新；详情页关闭后重新拉取
function onDetailClosed() {
  selectedTask.value = null;
  void refresh();
}

onBeforeUnmount(() => {
  selectedTask.value = null;
});
</script>

<template>
  <div :class="$style.list">
    <div v-if="loading" :class="$style.info">加载中...</div>
    <div v-else-if="error" :class="$style.error">{{ error }}</div>
    <template v-else-if="tasks.length === 0">
      <EmptyState message="暂无任务" />
    </template>
    <template v-else>
      <TaskCard
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        :current-user="currentUser"
        @click="selectedTask = task" />
    </template>

    <TaskDetail
      v-if="selectedTask"
      :task="selectedTask"
      :current-user="currentUser"
      @close="onDetailClosed" />
  </div>
</template>

<style module>
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
.info {
  padding: 16px;
  color: var(--text-muted);
  text-align: center;
}
.error {
  padding: 16px;
  color: var(--text-negative);
  text-align: center;
}
</style>
```

- [ ] **Step 4: 验证编译**

Run: `pnpm compile`
Expected: PASS（如 TaskDetail 未创建，临时在 TaskList.vue 内用 `// @ts-expect-error 待 T16` 占位或临时删除 TaskDetail import）

- [ ] **Step 5: Commit**

```bash
git add src/features/XIT/ORG/TaskList.vue src/features/XIT/ORG/TaskCard.vue src/features/XIT/ORG/EmptyState.vue
git commit -m "feat(org): add TaskList, TaskCard, EmptyState components"
```

---

## Task 16: TaskDetail.vue

**Files:**
- Create: `src/features/XIT/ORG/TaskDetail.vue`

- [ ] **Step 1: 创建 TaskDetail.vue**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue';
import type { OrgTask, OrgUser, TaskNote } from '@src/infrastructure/org-api/types';
import * as tasksApi from '@src/infrastructure/org-api/tasks';
import * as notesApi from '@src/infrastructure/org-api/notes';
import { HttpError } from '@src/infrastructure/org-api/client';
import {
  canCancelTask,
  canCancelAny,
  shouldShowBoardCancel,
} from '@src/infrastructure/org-api/permissions';
import {
  watchContractStatus,
  clearReportedStatus,
} from '@src/infrastructure/org-api/contract-link';
import { sendTaskToContd } from './utils';
import LinkContract from './LinkContract.vue';
import NoteEditor from './NoteEditor.vue';

const props = defineProps<{ task: OrgTask; currentUser: OrgUser }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'updated', task: OrgTask): void }>();

const localTask = ref<OrgTask>(props.task);
const notes = ref<TaskNote[]>([]);
const loading = ref(false);
const error = ref('');
const showLinkContract = ref(false);
const boardCancelReason = ref('');
const showBoardCancel = ref(false);

watch(
  () => props.task,
  t => {
    localTask.value = t;
  },
);

// 监听合同状态变化（架构 §7.3）
watchEffect(() => {
  watchContractStatus(localTask.value);
});

onBeforeUnmount(() => {
  clearReportedStatus(localTask.value.id);
});

async function loadNotes() {
  try {
    notes.value = await notesApi.listNotes(localTask.value.id);
  } catch (err) {
    console.warn('[ORG] loadNotes failed:', err);
  }
}

void loadNotes();

watch(
  () => localTask.value.id,
  () => {
    void loadNotes();
  },
);

const isPublisher = computed(() => localTask.value.publisherId === props.currentUser.id);
const isClaimer = computed(() => localTask.value.claimerId === props.currentUser.id);
const isParticipant = computed(() => isPublisher.value || isClaimer.value);

const canClaim = computed(
  () => localTask.value.status === 'PUBLISHED' && !isPublisher.value,
);
const canRelease = computed(
  () => localTask.value.status === 'AWAITING_CONTRACT' && isClaimer.value,
);
const canCancel = computed(() => canCancelTask(props.currentUser, localTask.value));
const canCreateContract = computed(
  () =>
    localTask.value.status === 'AWAITING_CONTRACT' &&
    !localTask.value.contractId &&
    isParticipant.value,
);
const showBoardCancelButton = computed(() =>
  shouldShowBoardCancel(props.currentUser, localTask.value),
);

async function updateTask(op: () => Promise<OrgTask>) {
  loading.value = true;
  error.value = '';
  try {
    const updated = await op();
    localTask.value = updated;
    emit('updated', updated);
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function onClaim() {
  await updateTask(() => tasksApi.claimTask(localTask.value.id));
}

async function onRelease() {
  await updateTask(() => tasksApi.releaseTask(localTask.value.id));
}

async function onCancel() {
  if (showBoardCancelButton.value && !boardCancelReason.value) {
    error.value = '董事会取消他人任务必须填写原因';
    return;
  }
  await updateTask(() =>
    tasksApi.cancelTask(
      localTask.value.id,
      showBoardCancelButton.value ? boardCancelReason.value : undefined,
    ),
  );
  showBoardCancel.value = false;
}

function onCreateContract() {
  sendTaskToContd(localTask.value.contractJson, localTask.value.type);
}

function onLinkContractClicked() {
  showLinkContract.value = true;
}

async function onContractLinked(updated: OrgTask) {
  localTask.value = updated;
  showLinkContract.value = false;
  emit('updated', updated);
}

function onNotesChanged() {
  void loadNotes();
}
</script>

<template>
  <div :class="$style.detail">
    <header :class="$style.header">
      <button :class="$style.back" @click="emit('close')">← 返回</button>
      <span :class="$style.status">{{ localTask.status }}</span>
    </header>

    <section :class="$style.section">
      <h3>基本信息</h3>
      <div>类型：{{ localTask.type }}</div>
      <div>名称：{{ localTask.contractJson.name || '—' }}</div>
      <div>货币：{{ localTask.contractJson.currency }}</div>
      <div v-if="localTask.contractJson.location">位置：{{ localTask.contractJson.location }}</div>
      <div v-if="localTask.contractJson.origin || localTask.contractJson.destination">
        路径：{{ localTask.contractJson.origin }} → {{ localTask.contractJson.destination }}
      </div>
      <div v-if="localTask.contractJson.price !== undefined">
        总价：{{ localTask.contractJson.price }} {{ localTask.contractJson.currency }}
      </div>
      <div v-if="localTask.contractJson.deadline !== undefined">
        期限：{{ localTask.contractJson.deadline }} 天
      </div>
      <div>发布者：{{ localTask.publisherUsername }} ({{ localTask.publisherCompanyCode }})</div>
      <div v-if="localTask.claimerUsername">
        接取者：{{ localTask.claimerUsername }} ({{ localTask.claimerCompanyCode }})
      </div>
      <div v-if="localTask.contractId">关联合同：{{ localTask.contractId }}</div>
      <div v-if="localTask.expiresAt">有效期：{{ new Date(localTask.expiresAt).toLocaleString() }}</div>
    </section>

    <section :class="$style.section">
      <h3>物品清单</h3>
      <ul>
        <li v-for="(item, i) in localTask.contractJson.items" :key="i">
          {{ item.amount }}× {{ item.commodity }}
          <span v-if="item.price !== undefined"> @ {{ item.price }} </span>
        </li>
      </ul>
    </section>

    <section v-if="error" :class="$style.error">{{ error }}</section>

    <section :class="$style.actions">
      <button v-if="canClaim" :disabled="loading" @click="onClaim">接取任务</button>
      <button v-if="canRelease" :disabled="loading" @click="onRelease">释放任务</button>
      <button v-if="canCreateContract" @click="onCreateContract">创建合同（CONTGEN → CONTD）</button>
      <button v-if="canCreateContract" @click="onLinkContractClicked">上报合同 ID</button>
      <button v-if="canCancel && !showBoardCancelButton" :disabled="loading" @click="onCancel">
        取消任务
      </button>
      <button
        v-if="showBoardCancelButton && !showBoardCancel"
        :disabled="loading"
        @click="showBoardCancel = true">
        董事会取消此任务
      </button>
      <template v-if="showBoardCancel">
        <input v-model="boardCancelReason" placeholder="取消原因（必填）" />
        <button :disabled="loading" @click="onCancel">确认取消</button>
        <button @click="showBoardCancel = false">放弃</button>
      </template>
    </section>

    <section :class="$style.section">
      <h3>备注</h3>
      <NoteEditor :task-id="localTask.id" :notes="notes" @changed="onNotesChanged" />
    </section>

    <LinkContract
      v-if="showLinkContract"
      :task="localTask"
      :current-user="currentUser"
      @linked="onContractLinked"
      @cancel="showLinkContract = false" />
  </div>
</template>

<style module>
.detail {
  padding: 12px;
  border: 1px solid var(--panel-border);
  background: var(--panel-background);
}
.header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}
.back {
  background: transparent;
  border: 1px solid var(--panel-border);
  color: var(--text-muted);
  padding: 4px 8px;
  cursor: pointer;
}
.status {
  font-size: 12px;
  color: var(--text-muted);
}
.section {
  margin-bottom: 16px;
  font-size: 13px;
}
.section h3 {
  font-size: 13px;
  margin: 0 0 6px;
  color: var(--text);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 0;
  border-top: 1px solid var(--panel-border);
  border-bottom: 1px solid var(--panel-border);
}
.actions button {
  padding: 6px 12px;
  border: 1px solid var(--panel-border);
  background: var(--panel-background-alt);
  color: var(--text);
  cursor: pointer;
}
.actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.actions input {
  flex: 1;
  min-width: 200px;
  padding: 6px 8px;
  border: 1px solid var(--panel-border);
  background: var(--input-background);
  color: var(--text);
}
.error {
  padding: 8px;
  color: var(--text-negative);
  background: var(--panel-background-alt);
  margin-bottom: 12px;
}
</style>
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS（utils/LinkContract/NoteEditor 未创建时可能报错，按 T14 Step 4 的临时占位策略处理）

- [ ] **Step 3: Commit**

```bash
git add src/features/XIT/ORG/TaskDetail.vue
git commit -m "feat(org): add TaskDetail with action matrix and notes"
```

---

## Task 17: PublishTask.vue

**Files:**
- Create: `src/features/XIT/ORG/PublishTask.vue`

- [ ] **Step 1: 创建 PublishTask.vue**

```vue
<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { TaskContractJson, TaskType } from '@src/infrastructure/org-api/types';
import * as tasksApi from '@src/infrastructure/org-api/tasks';
import { HttpError } from '@src/infrastructure/org-api/client';

type ItemType = { ticker: string; amount: number; price?: number };

const type = ref<Extract<TaskType, 'BUY' | 'SELL' | 'SHIP'>>('BUY');
const currency = ref('ICA');
const contractName = ref('');
const location = ref('');
const origin = ref('');
const destination = ref('');
const price = ref<number | undefined>(undefined);
const deadline = ref<number | undefined>(undefined);
const items = ref<ItemType[]>([{ ticker: '', amount: 0 }]);
// 有效期：发布后多少小时自动取消（架构 §12.21 任务有效期）
const expiresAfterHours = ref<number>(72);

const error = ref('');
const loading = ref(false);
const publishedTaskId = ref<string | null>(null);

const isShip = computed(() => type.value === 'SHIP');

const canSubmit = computed(() => {
  if (loading.value) {
    return false;
  }
  if (items.value.length === 0) {
    return false;
  }
  for (const item of items.value) {
    if (!item.ticker || item.amount <= 0) {
      return false;
    }
  }
  if (isShip.value) {
    if (!origin.value || !destination.value || origin.value === destination.value) {
      return false;
    }
    if (price.value === undefined || price.value <= 0) {
      return false;
    }
  } else {
    if (!location.value) {
      return false;
    }
    // 价格校验：每行有 price 或顶层有 price
    const hasTopPrice = price.value !== undefined && price.value > 0;
    const hasRowPrice = items.value.every(i => i.price !== undefined && i.price > 0);
    if (!hasTopPrice && !hasRowPrice) {
      return false;
    }
  }
  return true;
});

function addItem() {
  items.value.push({ ticker: '', amount: 0 });
}

function removeItem(i: number) {
  items.value.splice(i, 1);
}

async function onPublish() {
  if (!canSubmit.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    // 构造 contractJson（与 CONTGEN.vue ContractJson 对齐）
    const contractJson: TaskContractJson = {
      template: type.value,
      currency: currency.value,
      name: contractName.value || undefined,
      location: isShip.value ? undefined : location.value,
      origin: isShip.value ? origin.value : undefined,
      destination: isShip.value ? destination.value : undefined,
      price: price.value,
      deadline: deadline.value,
      items: items.value.map(i => ({
        commodity: i.ticker,
        amount: i.amount,
        price: i.price,
      })),
    };
    const expiresAt = new Date(Date.now() + expiresAfterHours.value * 3600_000).toISOString();
    const task = await tasksApi.createTask({ type: type.value, contractJson, expiresAt });
    publishedTaskId.value = task.id;
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  publishedTaskId.value = null;
  type.value = 'BUY';
  currency.value = 'ICA';
  contractName.value = '';
  location.value = '';
  origin.value = '';
  destination.value = '';
  price.value = undefined;
  deadline.value = undefined;
  items.value = [{ ticker: '', amount: 0 }];
  expiresAfterHours.value = 72;
}
</script>

<template>
  <div :class="$style.container">
    <div v-if="publishedTaskId" :class="$style.success">
      已发布，任务 ID：{{ publishedTaskId }}
      <button @click="resetForm">再发布一个</button>
    </div>

    <form v-else :class="$style.form" @submit.prevent="onPublish">
      <div :class="$style.row">
        <label>
          类型
          <select v-model="type">
            <option value="BUY">采购 BUY</option>
            <option value="SELL">出售 SELL</option>
            <option value="SHIP">运输 SHIP</option>
          </select>
        </label>
        <label>
          货币
          <select v-model="currency">
            <option>ICA</option>
            <option>NCC</option>
            <option>AIC</option>
            <option>CIS</option>
          </select>
        </label>
        <label>
          合同名称
          <input v-model="contractName" placeholder="可选" />
        </label>
      </div>

      <div :class="$style.row">
        <label v-if="!isShip">
          位置
          <input v-model="location" placeholder="如 ZV-307a" />
        </label>
        <template v-else>
          <label>
            起点
            <input v-model="origin" />
          </label>
          <label>
            终点
            <input v-model="destination" />
          </label>
        </template>
      </div>

      <div :class="$style.row">
        <label>
          顶层总价（可选，BUY/SELL 无行价时必填）
          <input v-model.number="price" type="number" min="0" />
        </label>
        <label>
          期限（天，可选）
          <input v-model.number="deadline" type="number" min="1" />
        </label>
        <label>
          有效期（小时）
          <input v-model.number="expiresAfterHours" type="number" min="1" />
        </label>
      </div>

      <div :class="$style.items">
        <div>物品清单</div>
        <div v-for="(item, i) in items" :key="i" :class="$style.itemRow">
          <input v-model="item.ticker" placeholder="物料代码" />
          <input v-model.number="item.amount" type="number" min="1" placeholder="数量" />
          <input v-model.number="item.price" type="number" min="0" placeholder="单价（SHIP 不用）" />
          <button type="button" @click="removeItem(i)">删除</button>
        </div>
        <button type="button" @click="addItem">添加物品</button>
      </div>

      <div v-if="error" :class="$style.error">{{ error }}</div>

      <button type="submit" :disabled="!canSubmit" :class="$style.submit">
        {{ loading ? '发布中...' : '发布任务' }}
      </button>
    </form>
  </div>
</template>

<style module>
.container {
  padding: 12px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.row label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  flex: 1;
  min-width: 120px;
}
.row input, .row select {
  padding: 6px 8px;
  border: 1px solid var(--panel-border);
  background: var(--input-background);
  color: var(--text);
}
.items {
  border: 1px solid var(--panel-border);
  padding: 8px;
}
.itemRow {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.itemRow input {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid var(--panel-border);
  background: var(--input-background);
  color: var(--text);
}
.itemRow button {
  padding: 4px 8px;
}
.error {
  color: var(--text-negative);
  padding: 8px;
  background: var(--panel-background-alt);
}
.submit {
  padding: 8px 16px;
  background: var(--accent);
  color: var(--text-on-accent);
  border: 1px solid var(--accent);
  cursor: pointer;
}
.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.success {
  padding: 16px;
  background: var(--panel-background-alt);
  color: var(--text-positive, #5cb85c);
  text-align: center;
}
</style>
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/XIT/ORG/PublishTask.vue
git commit -m "feat(org): add PublishTask form"
```

---

## Task 18: LinkContract.vue

**Files:**
- Create: `src/features/XIT/ORG/LinkContract.vue`

- [ ] **Step 1: 创建 LinkContract.vue**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ContractCreator, OrgTask, OrgUser } from '@src/infrastructure/org-api/types';
import * as tasksApi from '@src/infrastructure/org-api/tasks';
import { HttpError } from '@src/infrastructure/org-api/client';
import { contractsStore } from '@src/infrastructure/prun-api/data/contracts';

const props = defineProps<{ task: OrgTask; currentUser: OrgUser }>();
const emit = defineEmits<{
  (e: 'linked', task: OrgTask): void;
  (e: 'cancel'): void;
}>();

const contractId = ref('');
const creator = ref<ContractCreator>(
  props.task.publisherId === props.currentUser.id ? 'publisher' : 'claimer',
);
const error = ref('');
const loading = ref(false);

// 候选合同：从 contractsStore 中拉取最近的合同供用户选择
const candidateContracts = computed(() => {
  const all = contractsStore.all.value ?? [];
  // 显示最近 20 个，按 id 倒序
  return [...all].slice(0, 20);
});

const canSubmit = computed(
  () => contractId.value.length > 0 && !loading.value,
);

async function onSubmit() {
  if (!canSubmit.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const updated = await tasksApi.linkContract(props.task.id, {
      contractId: contractId.value,
      contractCreator: creator.value,
    });
    emit('linked', updated);
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div :class="$style.overlay">
    <div :class="$style.card">
      <h3>上报合同 ID</h3>
      <div :class="$style.form">
        <label>
          合同 ID
          <input v-model="contractId" placeholder="如 KS8F2H..." list="candidate-contracts" />
          <datalist id="candidate-contracts">
            <option v-for="c in candidateContracts" :key="c.id" :value="c.id" />
          </datalist>
        </label>
        <label>
          合同创建方
          <select v-model="creator">
            <option value="publisher">发布者创建</option>
            <option value="claimer">接取者创建</option>
          </select>
        </label>
        <div v-if="error" :class="$style.error">{{ error }}</div>
        <div :class="$style.actions">
          <button :disabled="!canSubmit" @click="onSubmit">
            {{ loading ? '提交中...' : '上报' }}
          </button>
          <button @click="emit('cancel')">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style module>
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.card {
  background: var(--panel-background);
  border: 1px solid var(--panel-border);
  padding: 16px;
  width: 360px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}
.form label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  gap: 4px;
}
.form input, .form select {
  padding: 6px 8px;
  border: 1px solid var(--panel-border);
  background: var(--input-background);
  color: var(--text);
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.actions button {
  padding: 6px 12px;
  border: 1px solid var(--panel-border);
  background: var(--panel-background-alt);
  color: var(--text);
  cursor: pointer;
}
.actions button:first-child {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}
.actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: var(--text-negative);
  font-size: 12px;
}
</style>
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/XIT/ORG/LinkContract.vue
git commit -m "feat(org): add LinkContract dialog for contract ID upload"
```

---

## Task 19: NoteEditor.vue

**Files:**
- Create: `src/features/XIT/ORG/NoteEditor.vue`

- [ ] **Step 1: 创建 NoteEditor.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import type { TaskNote } from '@src/infrastructure/org-api/types';
import * as notesApi from '@src/infrastructure/org-api/notes';
import { HttpError } from '@src/infrastructure/org-api/client';

const props = defineProps<{ taskId: string; notes: TaskNote[] }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const newContent = ref('');
const error = ref('');
const loading = ref(false);

async function onAdd() {
  if (!newContent.value.trim() || loading.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await notesApi.createNote(props.taskId, newContent.value.trim());
    newContent.value = '';
    emit('changed');
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div :class="$style.container">
    <ul :class="$style.notes">
      <li v-for="note in notes" :key="note.id" :class="$style.note">
        <div :class="$style.meta">
          <strong>{{ note.authorUsername }}</strong>
          <span>{{ new Date(note.createdAt).toLocaleString() }}</span>
        </div>
        <div :class="$style.content">{{ note.content }}</div>
      </li>
      <li v-if="notes.length === 0" :class="$style.empty">暂无备注</li>
    </ul>

    <div :class="$style.add">
      <textarea
        v-model="newContent"
        placeholder="添加备注（仅任务参与方可见）"
        rows="3" />
      <button :disabled="!newContent.trim() || loading" @click="onAdd">
        {{ loading ? '提交中...' : '添加' }}
      </button>
    </div>
    <div v-if="error" :class="$style.error">{{ error }}</div>
  </div>
</template>

<style module>
.container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.notes {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.note {
  border-left: 2px solid var(--panel-border);
  padding: 4px 8px;
  background: var(--panel-background-alt);
}
.meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}
.content {
  font-size: 12px;
  margin-top: 2px;
  white-space: pre-wrap;
}
.empty {
  color: var(--text-muted);
  font-size: 12px;
  padding: 4px 0;
}
.add {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.add textarea {
  padding: 6px 8px;
  border: 1px solid var(--panel-border);
  background: var(--input-background);
  color: var(--text);
  resize: vertical;
  font-family: inherit;
}
.add button {
  align-self: flex-start;
  padding: 4px 12px;
  border: 1px solid var(--panel-border);
  background: var(--panel-background-alt);
  color: var(--text);
  cursor: pointer;
}
.add button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: var(--text-negative);
  font-size: 12px;
}
</style>
```

- [ ] **Step 2: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/XIT/ORG/NoteEditor.vue
git commit -m "feat(org): add NoteEditor for task-level comments"
```

---

## Task 20: board/BoardPanel.vue + 子视图

**Files:**
- Create: `src/features/XIT/ORG/board/BoardPanel.vue`
- Create: `src/features/XIT/ORG/board/InviteCodes.vue`
- Create: `src/features/XIT/ORG/board/UserManager.vue`
- Create: `src/features/XIT/ORG/board/AuditLogs.vue`
- Create: `src/features/XIT/ORG/board/Stats.vue`

- [ ] **Step 1: 创建 Stats.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { OrgStats } from '@src/infrastructure/org-api/board';
import * as boardApi from '@src/infrastructure/org-api/board';

const stats = ref<OrgStats | null>(null);
const error = ref('');

async function load() {
  try {
    stats.value = await boardApi.fetchStats();
  } catch (err) {
    error.value = String(err);
  }
}
onMounted(load);
</script>

<template>
  <div>
    <div v-if="error" :class="$style.error">{{ error }}</div>
    <div v-else-if="stats">
      <div>用户总数：{{ stats.userCount }}（董事会 {{ stats.boardCount }} / 合作者 {{ stats.collaboratorCount }}）</div>
      <div>任务总数：{{ stats.taskCount }}</div>
      <h4>按状态分布</h4>
      <ul>
        <li v-for="(count, status) in stats.tasksByStatus" :key="status">
          {{ status }}: {{ count }}
        </li>
      </ul>
    </div>
    <div v-else>加载中...</div>
  </div>
</template>

<style module>
.error {
  color: var(--text-negative);
}
</style>
```

- [ ] **Step 2: 创建 InviteCodes.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { InviteCode } from '@src/infrastructure/org-api/types';
import * as boardApi from '@src/infrastructure/org-api/board';
import { HttpError } from '@src/infrastructure/org-api/client';

const codes = ref<InviteCode[]>([]);
const error = ref('');
const newCount = ref(5);
const generating = ref(false);

async function load() {
  try {
    codes.value = await boardApi.listInviteCodes();
  } catch (err) {
    error.value = String(err);
  }
}

async function onGenerate() {
  if (generating.value || newCount.value <= 0) {
    return;
  }
  generating.value = true;
  error.value = '';
  try {
    await boardApi.generateInviteCodes({ count: newCount.value, createdBy: 'board-ui' });
    await load();
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : String(err);
  } finally {
    generating.value = false;
  }
}

async function onRevoke(id: string) {
  if (!confirm('确定吊销此未使用的邀请码？')) {
    return;
  }
  try {
    await boardApi.revokeInviteCode(id);
    await load();
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : String(err);
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h3>邀请码管理</h3>
    <div :class="$style.generate">
      <input v-model.number="newCount" type="number" min="1" max="50" />
      <button :disabled="generating" @click="onGenerate">
        {{ generating ? '生成中...' : '生成邀请码' }}
      </button>
    </div>
    <div v-if="error" :class="$style.error">{{ error }}</div>
    <table :class="$style.table">
      <thead>
        <tr><th>邀请码</th><th>创建者</th><th>状态</th><th>使用人</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="c in codes" :key="c.id">
          <td><code>{{ c.code }}</code></td>
          <td>{{ c.createdBy }}</td>
          <td>
            <span v-if="c.revokedAt">已吊销</span>
            <span v-else-if="c.usedByUserId">已使用</span>
            <span v-else>未使用</span>
          </td>
          <td>{{ c.usedByUserId ?? '—' }}</td>
          <td>
            <button
              v-if="!c.usedByUserId && !c.revokedAt"
              @click="onRevoke(c.id)">吊销</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style module>
.generate {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.generate input {
  width: 80px;
  padding: 4px;
  border: 1px solid var(--panel-border);
  background: var(--input-background);
  color: var(--text);
}
.generate button {
  padding: 4px 12px;
  border: 1px solid var(--panel-border);
  background: var(--accent);
  color: var(--text-on-accent);
  cursor: pointer;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.table th, .table td {
  border: 1px solid var(--panel-border);
  padding: 4px 8px;
  text-align: left;
}
.error {
  color: var(--text-negative);
  padding: 8px;
}
</style>
```

- [ ] **Step 3: 创建 UserManager.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { OrgUser } from '@src/infrastructure/org-api/types';
import * as boardApi from '@src/infrastructure/org-api/board';
import { canPromoteDemote } from '@src/infrastructure/org-api/permissions';
import { HttpError } from '@src/infrastructure/org-api/client';

const props = defineProps<{ currentUser: OrgUser }>();
const users = ref<OrgUser[]>([]);
const error = ref('');

async function load() {
  try {
    users.value = await boardApi.listUsers();
  } catch (err) {
    error.value = String(err);
  }
}

async function onPromote(userId: string) {
  if (!confirm('确定提升为董事会？')) {
    return;
  }
  try {
    await boardApi.promoteUser(userId);
    await load();
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : String(err);
  }
}

async function onDemote(userId: string) {
  if (!confirm('确定降级为合作者？')) {
    return;
  }
  try {
    await boardApi.demoteUser(userId);
    await load();
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : String(err);
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h3>用户管理</h3>
    <div v-if="error" :class="$style.error">{{ error }}</div>
    <table :class="$style.table">
      <thead>
        <tr><th>显示名</th><th>PrUn 用户名</th><th>公司代码</th><th>角色</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id">
          <td>{{ u.displayName }}</td>
          <td>{{ u.prunUsername }}</td>
          <td>{{ u.companyCode }}</td>
          <td>{{ u.role === 'BOARD' ? '董事会' : '合作者' }}</td>
          <td>
            <template v-if="canPromoteDemote(currentUser, u.id)">
              <button v-if="u.role !== 'BOARD'" @click="onPromote(u.id)">提升</button>
              <button v-else @click="onDemote(u.id)">降级</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style module>
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.table th, .table td {
  border: 1px solid var(--panel-border);
  padding: 4px 8px;
  text-align: left;
}
.error {
  color: var(--text-negative);
  padding: 8px;
}
</style>
```

- [ ] **Step 4: 创建 AuditLogs.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AuditLog } from '@src/infrastructure/org-api/types';
import * as boardApi from '@src/infrastructure/org-api/board';

const logs = ref<AuditLog[]>([]);
const error = ref('');

async function load() {
  try {
    logs.value = await boardApi.listAuditLogs({ limit: 100 });
  } catch (err) {
    error.value = String(err);
  }
}
onMounted(load);
</script>

<template>
  <div>
    <h3>审计日志</h3>
    <div v-if="error" :class="$style.error">{{ error }}</div>
    <table :class="$style.table">
      <thead>
        <tr><th>时间</th><th>动作</th><th>操作方</th><th>目标</th><th>元数据</th></tr>
      </thead>
      <tbody>
        <tr v-for="l in logs" :key="l.id">
          <td>{{ new Date(l.createdAt).toLocaleString() }}</td>
          <td><code>{{ l.action }}</code></td>
          <td>{{ l.actorType }}{{ l.actorId ? `: ${l.actorId.slice(0, 8)}` : '' }}</td>
          <td>{{ l.targetType ? `${l.targetType}#${l.targetId?.slice(0, 8)}` : '—' }}</td>
          <td><code>{{ l.metadata ? JSON.stringify(l.metadata) : '' }}</code></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style module>
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.table th, .table td {
  border: 1px solid var(--panel-border);
  padding: 3px 6px;
  text-align: left;
}
.error {
  color: var(--text-negative);
  padding: 8px;
}
</style>
```

- [ ] **Step 5: 创建 BoardPanel.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import type { OrgUser } from '@src/infrastructure/org-api/types';
import InviteCodes from './InviteCodes.vue';
import UserManager from './UserManager.vue';
import AuditLogs from './AuditLogs.vue';
import Stats from './Stats.vue';

defineProps<{ currentUser: OrgUser }>();

type Section = 'stats' | 'invite-codes' | 'users' | 'audit-logs';
const section = ref<Section>('stats');

const sections: Array<{ key: Section; label: string }> = [
  { key: 'stats', label: '统计' },
  { key: 'invite-codes', label: '邀请码' },
  { key: 'users', label: '用户' },
  { key: 'audit-logs', label: '审计' },
];
</script>

<template>
  <div :class="$style.panel">
    <nav :class="$style.nav">
      <button
        v-for="s in sections"
        :key="s.key"
        :class="[$style.navItem, section === s.key && $style.active]"
        @click="section = s.key">
        {{ s.label }}
      </button>
    </nav>
    <div :class="$style.body">
      <Stats v-if="section === 'stats'" />
      <InviteCodes v-else-if="section === 'invite-codes'" />
      <UserManager v-else-if="section === 'users'" :current-user="currentUser" />
      <AuditLogs v-else-if="section === 'audit-logs'" />
    </div>
  </div>
</template>

<style module>
.panel {
  display: flex;
  height: 100%;
}
.nav {
  display: flex;
  flex-direction: column;
  width: 120px;
  padding: 8px 0;
  border-right: 1px solid var(--panel-border);
}
.navItem {
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
}
.navItem.active {
  color: var(--text);
  background: var(--panel-background-alt);
  border-left: 2px solid var(--accent);
}
.body {
  flex: 1;
  padding: 12px;
  overflow: auto;
}
</style>
```

- [ ] **Step 6: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/XIT/ORG/board/
git commit -m "feat(org): add BoardPanel with stats/invite-codes/users/audit sub-views"
```

---

## Task 21: utils.ts（sendTaskToContd + 合同类型反转）

**Files:**
- Create: `src/features/XIT/ORG/utils.ts`

- [ ] **Step 1: 创建 utils.ts**

```ts
// src/features/XIT/ORG/utils.ts
import { getTileState } from '@src/store/user-data-tiles';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import type { TaskContractJson, TaskType } from '@src/infrastructure/org-api/types';

// 复用 CONTGEN.vue 第 200-211 行 sendToContd 的转交路径：
// 写入 'contgen-output' workspace + 调用 showBuffer('CONTD')
// CONTD 面板在下次挂载时读取 workspace.json 自动填充

// 合同类型反转规则（架构 §3 + §7.2）：
// BUY 任务由接取者创建 SELL 合同（接取者卖物料给发布者）
// SELL 任务由接取者创建 BUY 合同（接取者从发布者买物料）
// SHIP 任务保持 SHIP（仅由发布者创建，contractCreator = publisher）
export function invertTemplate(
  template: TaskContractJson['template'],
  creatorIsPublisher: boolean,
): TaskContractJson['template'] {
  if (template === 'SHIP') {
    return 'SHIP';
  }
  // BUY/SELL 仅在接取者视角下反转；发布者视角保持原样
  if (creatorIsPublisher) {
    return template;
  }
  return template === 'BUY' ? 'SELL' : 'BUY';
}

export function sendTaskToContd(
  contractJson: TaskContractJson,
  taskType: TaskType,
  creatorIsPublisher = false,
): void {
  // 应用合同类型反转规则
  const inverted: TaskContractJson = {
    ...contractJson,
    template: invertTemplate(contractJson.template, creatorIsPublisher),
  };
  const workspace = getTileState<{ json: string }>('contgen-output');
  workspace.json = JSON.stringify(inverted, null, 2);
  void showBuffer('CONTD', { force: true });
}

// 状态颜色 helper（与 TaskCard.vue statusColor 一致，供其他视图复用）
export function statusColor(status: string): string {
  switch (status) {
    case 'PUBLISHED':
      return 'var(--text-muted)';
    case 'AWAITING_CONTRACT':
      return 'var(--text-warning, #f0ad4e)';
    case 'IN_PROGRESS':
      return 'var(--accent)';
    case 'COMPLETED':
      return 'var(--text-positive, #5cb85c)';
    case 'CANCELLED':
      return 'var(--text-negative, #d9534f)';
    default:
      return 'var(--text-muted)';
  }
}
```

- [ ] **Step 2: 修复 TaskDetail.vue 的 sendTaskToContd 调用**

修改 `/workspace/src/features/XIT/ORG/TaskDetail.vue` 中 `onCreateContract` 函数，传入 `taskType` 与 `creatorIsPublisher`：

定位 TaskDetail.vue 中的：
```ts
function onCreateContract() {
  sendTaskToContd(localTask.value.contractJson, localTask.value.type);
}
```

替换为：
```ts
function onCreateContract() {
  // contractCreator 决定反转规则：publisher 视角不反转，claimer 视角反转
  const creatorIsPublisher = localTask.value.contractCreator === 'publisher'
    ? isPublisher.value
    : !isPublisher.value;
  sendTaskToContd(
    localTask.value.contractJson,
    localTask.value.type,
    creatorIsPublisher,
  );
}
```

- [ ] **Step 3: 验证编译**

Run: `pnpm compile`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/XIT/ORG/utils.ts src/features/XIT/ORG/TaskDetail.vue
git commit -m "feat(org): add utils with sendTaskToContd and template inversion"
```

---

## Task 22: 注册 XIT ORG 命令

**Files:**
- Modify: `src/features/XIT/index.ts`

- [ ] **Step 1: 在 XIT/index.ts 插入 ORG 注册**

修改 `/workspace/src/features/XIT/index.ts`：在 `import './NOTE/NOTE';`（第 32 行）之后插入一行：

```ts
import './NOTE/NOTE';
import './ORG/ORG';
import './PLAN/PLAN';
```

- [ ] **Step 2: 移除 T14 Step 4 的临时占位**

如果 T14 Step 4 在 ORG.vue 中使用了 `// @ts-expect-error` 或占位 div，此时所有依赖组件（TaskList / PublishTask / BoardPanel）已创建完成，移除占位恢复真实 import 与使用。

- [ ] **Step 3: 验证编译**

Run: `pnpm compile`
Expected: PASS（无任何 @ts-expect-error 残留）

- [ ] **Step 4: 验证 lint**

Run: `pnpm lint`
Expected: PASS（无错误；warning 可接受）

- [ ] **Step 5: 构建扩展**

Run: `pnpm build`
Expected: PASS（生成 dist/）

- [ ] **Step 6: Commit**

```bash
git add src/features/XIT/index.ts src/features/XIT/ORG/ORG.vue
git commit -m "feat(org): register XIT ORG command"
```

---

## Task 23: 端到端手动冒烟测试

**Files:** 无（仅手动验证）

**前置条件**：
- 后端 Worker 已部署并可访问（VITE_ORG_API_BASE 配置正确）
- 已通过 wrangler 引导一个 BOARD 账号
- 已通过该 BOARD 生成至少 1 个邀请码

- [ ] **Step 1: 加载扩展并打开 XIT ORG**

1. 在浏览器加载 `dist/` 目录作为未打包扩展
2. 登录 Prosperous Universe
3. 在 APEX 输入 `XIT ORG` 打开面板
4. 验证：显示 AuthOverlay 浮层（注册/登录表单）

- [ ] **Step 2: 注册流程**

1. 切换到"注册"标签
2. 输入邮箱、密码、邀请码
3. 验证：表单显示"将绑定 PrUn 身份：当前用户名 / 当前公司代码"
4. 提交
5. 验证：进入主面板，显示当前用户名 + RoleBadge（应为"合作者"）
6. 验证：Tabs 显示"任务板 / 我的发布 / 我的接取 / 发布任务"，**不**显示"管理"（COLLABORATOR 无权限）

- [ ] **Step 3: 用 BOARD 账号登录**

1. 登出
2. 用 BOARD 邮箱密码登录
3. 验证：RoleBadge 显示"董事会"
4. 验证：Tabs 多显示"管理"

- [ ] **Step 4: 发布任务**

1. 切换到"发布任务"Tab
2. 类型选 BUY，货币 ICA，位置填 `ZV-307a`，顶层总价填 1000，添加物品 `H2O` 100 单价 10
3. 提交
4. 验证：显示"已发布，任务 ID: ..."
5. 切换到"任务板"Tab，验证刚才发布的任务在列表中

- [ ] **Step 5: 接取任务（用另一账号）**

1. 登出，用另一账号登录（或先用 BOARD 提升 COLLABORATOR，再切换 PrUn 账号重新登录）
2. 切换到"任务板"，点击刚发布的任务
3. 点击"接取任务"
4. 验证：状态变为 AWAITING_CONTRACT，显示"创建合同"与"上报合同 ID"按钮

- [ ] **Step 6: 创建合同并上报**

1. 点击"创建合同（CONTGEN → CONTD）"
2. 验证：CONTD 缓冲区自动打开，contractJson 已填充
3. 在 CONTD 完成合同创建（手动确认，遵守 ToS）
4. 复制合同 ID
5. 回到 XIT ORG，点击"上报合同 ID"，粘贴 ID，选择"接取者创建"，提交
6. 验证：任务详情显示"关联合同：XXX"

- [ ] **Step 7: 合同状态同步**

1. 在 PrUn 内推进合同状态（CLOSED → FULFILLED）
2. 等待 30s 轮询周期
3. 验证：任务状态自动变为 IN_PROGRESS → COMPLETED
4. 验证：浏览器 console 出现 `[ORG] Task XXX status: AWAITING_CONTRACT → IN_PROGRESS` 日志

- [ ] **Step 8: 董事会取消他人任务**

1. 用 BOARD 登录
2. 打开其他用户发布的任务
3. 点击"董事会取消此任务"
4. 验证：弹出 reason 输入框
5. 不填 reason 直接确认 → 验证显示"董事会取消他人任务必须填写原因"
6. 填写 reason 后确认 → 验证任务状态变为 CANCELLED

- [ ] **Step 9: 邀请码管理**

1. 切换到"管理"Tab
2. 切换到"邀请码"子视图
3. 输入数量 3，点击"生成邀请码"
4. 验证：列表新增 3 条未使用邀请码
5. 点击其中一条"吊销"按钮，确认
6. 验证：状态变为"已吊销"

- [ ] **Step 10: 用户角色升降级**

1. 切换到"用户"子视图
2. 找到一个 COLLABORATOR 用户
3. 点击"提升"
4. 验证：角色变为"董事会"
5. 找到自己（BOARD）行 → 验证无操作按钮（canPromoteDemote 排除自己）
6. 找到刚提升的 BOARD 用户，点击"降级"
7. 验证：角色变回"合作者"

- [ ] **Step 11: 审计日志**

1. 切换到"审计"子视图
2. 验证：列表显示之前的操作（task.publish / task.claim / task.cancel_by_board / user.promote / user.demote / invite_code.generate / invite_code.revoke）

- [ ] **Step 12: 最终 Commit**

如果手动测试中发现 bug，修复后单独 commit。无 bug 则跳过此步。

```bash
git log --oneline -20    # 验证完整提交链
```

Expected: 看到 22 个 feat(org): 提交，按 T1-T22 顺序。

---

## Self-Review

**1. Spec coverage**（对照架构文档 §11 客户端高层任务 C1-C23）：

| 架构任务 | 本计划任务 | 状态 |
| --- | --- | --- |
| C1 types.ts | T1 | ✓ |
| C2 session.ts | T2 | ✓ |
| C3 client.ts | T3 | ✓ |
| C4 auth.ts | T4 | ✓ |
| C5 tasks.ts | T5 | ✓ |
| C6 notes.ts | T6 | ✓ |
| C7 contract-link.ts | T7 | ✓ |
| C8 polling.ts | T8 | ✓ |
| C9 board.ts | T9 | ✓ |
| C10 permissions.ts | T10 | ✓ |
| C11 userData migration | T11 | ✓ |
| C12 AuthOverlay.vue | T12 | ✓ |
| C13 RoleBadge.vue | T13 | ✓ |
| C14 ORG.vue 主面板 | T14 | ✓ |
| C15 TaskList.vue + TaskCard.vue | T15 | ✓ |
| C16 TaskDetail.vue | T16 | ✓ |
| C17 PublishTask.vue | T17 | ✓ |
| C18 LinkContract.vue | T18 | ✓ |
| C19 NoteEditor.vue | T19 | ✓ |
| C20 board/BoardPanel.vue + 子视图 | T20 | ✓ |
| C21 utils.ts sendTaskToContd | T21 | ✓ |
| C22 XIT/index.ts 注册 | T22 | ✓ |
| C23 端到端手动测试 | T23 | ✓ |

**2. Placeholder scan**：搜索"TBD/TODO/implement later/similar to Task N"——T8 polling.ts 与 T14 ORG.vue 中有 `TODO: 接入 PrUn NOTS 通知`，这是真实的未实现项（架构 §7.3 双通道通知的 NOTS 部分留待后续），非占位符。所有代码步骤均含完整可执行代码。

**3. Type consistency**：

- `OrgUser` 字段（`id, email, prunUsername, companyCode, displayName, role, createdAt, lastLoginAt`）在 T1 定义，T2/T4/T8/T9/T10/T12/T13/T14/T15/T16/T20 一致使用
- `OrgTask` 字段（`id, type, contractJson, status, publisherId, publisherUsername, publisherCompanyCode, claimerId, claimerUsername, claimerCompanyCode, contractId, contractCreator, expiresAt, createdAt, publishedAt, claimedAt, inProgressAt, completedAt, cancelledAt, updatedAt`）在 T1 定义，T5/T7/T8/T15/T16/T18 一致使用
- `TaskStatus` 枚举值（PUBLISHED / AWAITING_CONTRACT / IN_PROGRESS / COMPLETED / CANCELLED）在 T1 定义，T7（TRANSITION_STATUSES 校验但未硬编码任务状态）/T8/T15/T16/T21 一致
- `PrunContractStatus` 枚举值（OPEN / CLOSED / CANCELLED / FULFILLED / PARTIALLY_FULFILLED / REJECTED / DEADLINE_EXCEEDED / BREACHED / TERMINATED）在 T1 定义，T7 TRANSITION_STATUSES 使用其中 7 个（OPEN/PARTIALLY_FULFILLED 不触发转移）一致
- `TaskContractJson` 字段（template, currency, name, location, origin, destination, price, deadline, items）与 CONTGEN.vue 第 13-39 行 ContractJson 完全对齐
- `AuthSession` 在 T1 定义 `{ accessToken, refreshToken, user }`，T2/T3/T4/T8/T12/T14 一致使用
- `ContractCreator` 类型（`'publisher' | 'claimer'`）在 T1 定义，T5 LinkContractParams / T16 onCreateContract / T18 LinkContract.vue 一致使用
- `PollScope` 类型（`'board' | 'published' | 'claimed'`）在 T1 定义，T5 ListTasksParams / T14 ORG.vue tab 类型 / T15 TaskList scope prop 一致（注意 ORG.vue 还多 `'publish' | 'board-admin'` 两个非轮询 tab，与 PollScope 不冲突）
- `sendTaskToContd` 签名在 T21 定义为 `(contractJson, taskType, creatorIsPublisher?)`，T16 TaskDetail.vue 调用一致

**4. 已知风险与待办**：

- 架构 §7.3 的"PrUn NOTS 通知"在本计划中仅用 console.log 占位，留待后续单独任务实现（需研究 `notifications.ts` `waitNotificationLoaded` + `alertsStore`）
- 本计划未引入 Vitest 测试基础设施（与现有仓库约定一致）；如未来引入，`infrastructure/org-api/permissions.ts` 与 `contract-link.ts` 的纯函数是首选单元测试目标
- T14 Step 4 的临时占位策略仅在编译失败时使用；正常路径下 T14 创建 ORG.vue 会引用未创建的 TaskList/PublishTask/BoardPanel，可在 T14 临时删除 import 等到 T22 恢复，或调整执行顺序为 T1→T15→T17→T20→T14（推荐后者，但本计划按架构文档任务编号顺序保留 T14 在前）

**5. 文件路径核对**：

所有 Create 路径以 `/workspace/src/` 为根；所有 Modify 路径已通过代码勘探确认存在。`/workspace/src/store/user-data.types.d.ts`、`/workspace/src/store/user-data.ts`、`/workspace/src/store/user-data-migrations.ts`、`/workspace/src/features/XIT/index.ts` 均已在勘探中读取。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-18-org-client-impl.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 每个 Task 派发新 subagent，task 间 review，快速迭代
**2. Inline Execution** - 在当前会话用 executing-plans 批量执行，带 checkpoint review

请选择执行方式。
