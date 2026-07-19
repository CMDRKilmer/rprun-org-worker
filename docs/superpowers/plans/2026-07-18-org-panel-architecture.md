# 组织管理面板 (XIT ORG) 高层架构计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `XIT ORG` 命令面板，让登录用户在群内发布/接取/释放任务，完成后联动 CONTD 创建合约。

**Architecture:** 客户端 XIT 命令 + 独立后端服务。客户端用邀请码 + 邮箱密码注册（绑定 PrUn 用户名 + 公司代码），登录时再校验 PrUn 身份一致性，从后端拉取/推送任务，复用 CONTGEN 的 `ContractJson` 结构表达 BUY/SELL/SHIP 任务，完成后通过 `getTileState('contgen-output')` + `showBuffer('CONTD')` 联动创建合约。

**Tech Stack:** TypeScript, Vue 3, CSS Modules（客户端，遵循 `architecture.md`）；后端待选型。

---

## 1. 需求摘要

| 维度 | 决策 |
| -------- | -------- |
| 入口 | 新建 `XIT ORG` 命令（参照 `xit-registry.ts`） |
| 定位 | 玩家可发布/接取/释放任务的任务面板，群内共享 |
| 任务类型 | BUY / SELL / SHIP（沿用 CONTGEN JSON）；LOAN 占位字段，后期扩展 |
| 同步机制 | 独立后端服务（待规划） |
| 认证 | 邀请码 + 邮箱密码：管理员手动发放一次性邀请码 → 注册时绑定游戏内用户名 + 公司代码 → 登录时校验 PrUn 身份一致性 |
| 群体定义 | 后端账号系统：所有登录用户共享一个全局任务板（"组织"= 所有持邀请码的注册用户） |
| 身份标识 | 同时上报 `username`（PrUn 玩家用户名） + `companyCode`（公司代码），后端记录完整身份 |
| 任务完成 | 联动 CONTD 创建合约（复用 CONTGEN → CONTD 现有路径） |
| 服务端动作 | 所有发布/接取/释放/完成均需用户点击触发（遵守 ToS） |
| 本次产出 | 仅高层架构文档；后续拆分为客户端实现计划与后端实现计划 |

---

## 2. 系统组件

```
┌─────────────────────────────────────────────────────────┐
│  PrUn Game (浏览器页面)                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Refined PrUn Extension                           │  │
│  │  ┌─────────────────┐    ┌──────────────────────┐  │  │
│  │  │  XIT ORG Panel  │    │  AuthOverlay         │  │  │
│  │  │  (Vue + tile)   │    │  (邀请码注册/登录)    │  │  │
│  │  │  UI + 30s 轮询   │    │                      │  │  │
│  │  └────────┬────────┘    └──────────┬───────────┘  │  │
│  │           │                         │              │  │
│  │  ┌────────▼─────────────────────────▼───────────┐  │  │
│  │  │  fetch() → Cloudflare Worker REST API        │  │  │
│  │  │  (infrastructure/org-api/client.ts)          │  │  │
│  │  │  - JWT token 自动注入 + 401 刷新              │  │  │
│  │  │  - 任务 CRUD/状态转移（业务逻辑在 Worker）    │  │  │
│  │  └────────┬──────────────────────────────────────┘  │  │
│  │           │ 读 users/company store 获取 PrUn 身份   │  │
│  └───────────┼─────────────────────────────────────────┘  │
└──────────────┼─────────────────────────────────────────────┘
               │ HTTPS + JWT Bearer
┌──────────────▼─────────────────────────────────────────────┐
│  Cloudflare 边缘网络（免费档，详见 §12）                  │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Worker (Hono + TypeScript)                          │ │
│  │  - 业务逻辑全在此：状态校验/合同同步/邀请码原子性    │ │
│  │  - 路由：/auth/* /tasks/* /notes/* /admin/*          │ │
│  │  - JWT 鉴权中间件                                    │ │
│  └────┬─────────────────────────────────┬───────────────┘ │
│       │                                 │                 │
│  ┌────▼───────────┐              ┌─────▼──────────────┐  │
│  │  D1 (SQLite)   │              │  Cron Triggers     │  │
│  │  users         │              │  每 5 分钟清理过期  │  │
│  │  invite_codes  │              │  PUBLISHED 任务    │  │
│  │  refresh_tokens│              └────────────────────┘  │
│  │  tasks         │                                       │
│  │  task_notes    │                                       │
│  │  audit_logs    │                                       │
│  └────────────────┘                                       │
└────────────────────────────────────────────────────────────┘
```

**关键架构决策**（详见 §12）：
- 后端采用 **Cloudflare 原生栈**（Workers + D1 + KV + Cron Triggers），针对 50 人邀请制群体优化，完全运行在免费档
- **业务逻辑全部在 Worker 内**（状态校验、合同同步、邀请码原子性、有效期清理），客户端只负责 UI + 调 REST API
- 同步策略：30s 客户端轮询 + Worker Cron Trigger 双向保障

---

## 3. 任务状态机

```
DRAFT ──publish──▶ PUBLISHED ──claim──▶ CLAIMED ──complete──▶ COMPLETED
                       ▲                   │
                       │                   └──release──▶ PUBLISHED
                       │
                       └──cancel──▶ CANCELLED
```

| 状态 | 含义 | 触发者 |
| -------- | -------- | -------- |
| DRAFT | 发布者本地草稿，未推送到后端 | 发布者 |
| PUBLISHED | 已发布，群内可见，等待接取 | 发布者点击 publish |
| CLAIMED | 已被某用户接取，进行中 | 接取者点击 claim |
| COMPLETED | 已完成（联动 CONTD 创建合约后由用户标记） | 接取者点击 complete |
| CANCELLED | 发布者取消 | 发布者点击 cancel |

**状态转移规则：**
- `publish` / `cancel`：仅发布者可触发
- `claim` / `release`：任意非发布者可触发 `claim`；仅当前 claimer 可触发 `release`
- `complete`：仅当前 claimer 可触发；触发后扩展先把 `contractJson` 推送到 CONTD，CONTD 完成合约创建后再向后端标记 COMPLETED

---

## 4. 数据模型（高层）

### 4.1 客户端类型（`src/infrastructure/org-api/types.ts`）

```ts
// 邀请码制下的身份：username + companyCode 同时上报后端
export interface OrgUser {
  backendId: string;
  prunUsername: string;       // 从 users store 读取
  companyCode: string;        // 从 company store 读取
  displayName: string;        // 显示名（默认 = prunUsername）
  role: UserRole;             // 角色：BOARD（董事会）| COLLABORATOR（合作者）
  createdAt: number;
}

// 用户角色（详见 §12.21 权限分层）
export type UserRole = 'BOARD' | 'COLLABORATOR';

// 会话：邮箱密码登录后后端返回
export interface OrgSession {
  token: string;              // access token（存 localStorage，详见 §7.5）
  user: OrgUser;
  expiresAt: number;
}

// 任务类型：BUY/SELL/SHIP 复用 CONTGEN；LOAN 占位
export type TaskType = 'BUY' | 'SELL' | 'SHIP' | 'LOAN';

// 复用 CONTGEN 的 ContractJson 结构（见 src/features/XIT/CONTGEN/CONTGEN.vue）
// LOAN 类型的 contractJson 为占位结构，后期扩展
export interface TaskContractJson {
  template: TaskType;
  currency: string;
  name?: string;
  location?: string;
  origin?: string;
  destination?: string;
  price?: number;
  deadline?: number;
  items: Array<{ commodity: string; amount: number; price?: number }>;
}

export type TaskStatus = 'DRAFT' | 'PUBLISHED' | 'CLAIMED' | 'COMPLETED' | 'CANCELLED';

export interface OrgTask {
  id: string;
  type: TaskType;
  contractJson: TaskContractJson;
  publisherUsername: string;       // 发布者 PrUn username
  publisherCompanyCode: string;    // 发布者公司代码
  claimerUsername?: string;        // 接取者 PrUn username（CLAIMED 时填充）
  claimerCompanyCode?: string;     // 接取者公司代码
  status: TaskStatus;
  createdAt: number;
  publishedAt?: number;
  claimedAt?: number;
  completedAt?: number;
}
```

### 4.2 后端数据模型（高层，待后端实现计划细化）

- **InviteCode**: `{ code, createdBy, createdAt, usedByUsername?, usedAt? }` — 一次性
- **User**: `{ id, prunUsername, companyCode, displayName, inviteCodeUsed, createdAt }`
- **Session**: `{ token, userId, expiresAt }`
- **Task**: 同 `OrgTask`

---

## 5. 认证流程

### 5.1 注册流程（邀请码 + 邮箱密码）

```
1. 用户打开 XIT ORG → 未登录 → 显示 AuthOverlay
2. 用户输入邮箱 + 密码 + 邀请码 → 扩展读取 users store.username + company store.code
3. 扩展向后端 POST /auth/register
   Body: { email, password, inviteCode, prunUsername, companyCode }
4. 后端校验邀请码未使用 → 创建 User → 标记邀请码已用 → 返回 Session
5. 扩展把 access/refresh token 存入 localStorage，user 信息存入 localStorage
```

### 5.2 登录流程（邮箱 + 密码 + PrUn 身份一致性校验）

```
1. 已注册用户打开 XIT ORG → 检测到本地有 token → 调用 GET /auth/me
2. 后端校验 token 有效性 + 当前 PrUn username/companyCode 与注册时一致
3. 一致 → 返回 User；扩展进入面板
4. 不一致（用户切换了 PrUn 账号）→ 提示重新登录
5. 无 token → AuthOverlay 切到"登录"模式：用户输入邮箱 + 密码
   → POST /auth/login → 返回 Session → 扩展再次校验 PrUn 身份一致
   （不一致则自动 logout 并提示）
```

### 5.3 凭据存储

- **Token**：存于 `localStorage`（键 `rprun-org-access-token` / `rprun-org-refresh-token`），
  详见 `src/infrastructure/org-api/session.ts`。**不**复用 `crypto-secrets.ts`，
  因为扩展页面上下文与 background 隔离，crypto-secrets 的加密开销对纯页面侧 JWT 不必要。
- **User 元信息**：存于 `localStorage`（键 `rprun-org-user`，JSON 序列化）
- **登出**：`/auth/logout`（带 refreshToken）+ 清除 localStorage 三键

### 5.4 邀请码发放

- 后端管理后台由管理员手动生成一批邀请码（一次性使用）
- 邀请码发放渠道不在扩展范围内（Discord / 游戏内聊天等）
- 注册时若邀请码无效或已用 → 扩展显示错误提示

---

## 6. 客户端模块结构

```
src/infrastructure/org-api/          # 新增基础设施层
  ├── client.ts                      # fetch wrapper + JWT 自动注入 + 401 刷新
  ├── auth.ts                        # register/login/logout/me/refresh
  ├── tasks.ts                       # 任务 CRUD + 状态转移 API 调用（业务逻辑在 Worker）
  ├── notes.ts                       # 备注 CRUD
  ├── contract-link.ts               # 监听 contractsStore → POST /tasks/:id/sync-status
  ├── polling.ts                     # 30s 轮询 + 增量更新 + 通知触发
  ├── session.ts                     # localStorage 存 access/refresh token
  └── types.ts                       # OrgUser / OrgTask / TaskStatus / TaskContractJson / TaskNote

src/features/XIT/ORG/                # 新增 XIT 命令
  ├── ORG.ts                         # xit.add 注册
  ├── ORG.vue                        # 主面板（Tabs: 任务板 / 我的发布 / 我的接取 / 管理[仅 BOARD]）
  ├── AuthOverlay.vue                # 邀请码注册 + 登录浮层
  ├── RoleBadge.vue                  # 当前用户角色徽章（BOARD/COLLABORATOR 显示在顶部）
  ├── TaskList.vue                   # 任务列表（按状态过滤、增量更新）
  ├── TaskCard.vue                   # 任务卡片（显示 contractJson 摘要 + 操作按钮）
  ├── TaskDetail.vue                 # 任务详情（完整 contractJson + 操作按钮 + 备注区；BOARD 多"取消任何任务"按钮）
  ├── PublishTask.vue                # 复用 CONTGEN 表单生成 contractJson + 有效期字段
  ├── LinkContract.vue               # 上报 contractId + creator 选择
  ├── NoteEditor.vue                 # 任务级备注编辑
  ├── board/                         # 董事会专属子视图（仅 BOARD 可见，详见 §12.21）
  │   ├── BoardPanel.vue             # 管理主页（左侧导航：邀请码/用户/审计/统计）
  │   ├── InviteCodes.vue            # 邀请码生成/列表/吊销
  │   ├── UserManager.vue            # 用户列表 + promote/demote
  │   ├── AuditLogs.vue              # 审计日志查看
  │   └── Stats.vue                  # 组织统计
  ├── EmptyState.vue                 # 空状态
  └── utils.ts                       # 状态颜色、格式化、CONTGEN → CONTD 转交
```

### 6.1 文件职责边界

- `infrastructure/org-api/` 只负责 HTTP 通信与类型，无 Vue 依赖（符合 `architecture.md` 依赖方向：infrastructure → utils，不依赖 features）
- `features/XIT/ORG/` 负责 UI 与编排：调用 org-api、与 CONTGEN/CONTD 集成、读 users/company store、30s 轮询触发通知
- 不在 features 之间互相 import（遵循 `contributing.md` "Feature Dependencies" 规则）；CONTGEN 的 JSON 结构通过 `types.ts` 中显式定义的 `TaskContractJson` 复用，而非直接 import CONTGEN 内部类型
- **客户端无业务逻辑**：状态转移校验、合同状态映射、邀请码原子性等都在 Worker 内完成（详见 §12.10）；客户端只是 UI + API 调用 + 通知触发

---

## 7. 集成点

### 7.1 CONTGEN JSON 复用

`PublishTask.vue` 复用 CONTGEN 的 `ContractJson` 结构（`template / currency / name / location / origin / destination / price / deadline / items`），类型限 `BUY | SELL | SHIP`；LOAN 在 `TaskType` 中保留为合法值，但 `PublishTask.vue` 暂不暴露 LOAN 选项（占位待后期扩展）。

### 7.2 CONTD 联动（接取任务并创建合约）

复用 CONTGEN → CONTD 的现有转交路径（见 `CONTGEN.vue` 第 202-211 行 `sendToContd`）：

```ts
// utils.ts
import { getTileState } from '@src/store/user-data-tiles';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';

export function sendTaskToContd(contractJson: TaskContractJson) {
  const workspace = getTileState<{ json: string }>('contgen-output');
  workspace.json = JSON.stringify(contractJson, null, 2);
  void showBuffer('CONTD', { force: true });
}
```

**合同类型反转规则**：任务类型 BUY/SELL 在创建合约时需反转（BUY 任务由接取者创建 SELL 合约，反之亦然）；SHIP 任务由发布者创建 SHIP 合约。详见 §3 状态机说明。

**接取任务并创建合约的流程**（合同驱动状态机）：
1. 接取者在 `TaskDetail.vue` 点击"接取"
2. 客户端调用 `POST /tasks/:id/claim` → Worker 推进状态为 AWAITING_CONTRACT
3. 接取者（或发布者，取决于 contractCreator）点击"创建合约"
4. 扩展调用 `sendTaskToContd(task.contractJson)` 打开 CONTD 自动填充（按反转规则）
5. 用户在 CONTD 确认创建合约（仍需用户点击，遵守 ToS）
6. 用户回到 XIT ORG，在 `LinkContract.vue` 中选择 contractId 上报 → `POST /tasks/:id/link-contract`
7. 客户端开始监听 contractsStore 中该 contractId 的状态变化

### 7.3 合同状态监听与同步

客户端监听 `contractsStore` 中任务关联合同的状态变化，自动上报 Worker 推进任务状态：

```ts
// contract-link.ts
import { contractsStore } from '@src/infrastructure/prun-api/data/contracts';

// 监听任务关联合同的状态
function watchContractStatus(task: OrgTask) {
  if (!task.contractId) return;
  const contract = contractsStore.getById(task.contractId);
  if (!contract) return;

  // 合同状态变化时上报 Worker
  watchEffect(() => {
    const status = contract.status.value;
    if (hasStatusChanged(task.id, status)) {
      api.post(`/tasks/${task.id}/sync-status`, { contractStatus: status });
    }
  });
}

// 合同状态 → 任务状态映射（Worker 内 CONTRACT_STATUS_TO_TASK，详见 §12.10.3）
// 状态名必须用大写，对齐客户端 types.ts 的 PrunContractStatus 与 PrUn contracts.types.d.ts
// CLOSED      → IN_PROGRESS
// FULFILLED   → COMPLETED
// CANCELLED   → CANCELLED
// BREACHED    → CANCELLED
// TERMINATED  → CANCELLED
```

**Worker 端校验**（详见 §12.10.3）：上报者必须是 publisher 或 claimer；contractId 必须与 task.contractId 匹配；状态转移必须合法（`canTransition`）。

**通知触发**：客户端轮询拉取到状态变化时（详见 §12.11），触发面板内 Badge + PrUn NOTS 双通道通知。

### 7.4 PrUn 用户名读取

```ts
// 从 users store 读取 username
import { usersStore } from '@src/infrastructure/prun-api/data/users';
// 从 company store 读取公司代码
import { companyStore } from '@src/infrastructure/prun-api/data/company';

const prunUsername = computed(() => usersStore.current.value?.username);
const companyCode = computed(() => companyStore.current.value?.code);
```

> **待确认**：`usersStore` / `companyStore` 的具体 API 形态需在客户端实现计划阶段读取实际 store 文件确认（当前架构文档仅示意）。

**身份一致性校验**：登录后客户端校验 `/auth/me` 返回的 `prun_username` / `company_code` 与当前 PrUn 游戏内身份一致；不一致则 logout 并提示用户重新登录（防止 PrUn 账号切换后误用他人身份操作任务）。

### 7.5 凭据存储（Cloudflare 方案已简化）

**Cloudflare 方案下不再使用 crypto-secrets**（详见 §12.17 调整关系）：
- access token / refresh token 直接存 localStorage（浏览器扩展上下文，localStorage 与页面隔离）
- 启动时读取并注入到 `client.ts` 的 fetch wrapper
- 401 时自动用 refresh token 调 `/auth/refresh` 滚动续期
- 详见 §12.16 客户端模块结构

### 7.6 userData 扩展（Cloudflare 方案已简化）

需在 `src/store/user-data.types.d.ts` 与 `src/store/user-data.ts` 中新增 `org` 字段：

```ts
// user-data.types.d.ts 新增
interface OrgUserData {
  lastViewedTab?: 'board' | 'published' | 'claimed';
  lastPollAt?: string;     // ISO 8601，用于增量轮询
}
```

**简化说明**：Cloudflare 方案下 session 由客户端 localStorage 管理（access/refresh token），userData.org 仅存 UI 状态（lastViewedTab）与轮询游标（lastPollAt）。原 Supabase 方案的 `session.user` / `session.expiresAt` 已删除。

---

## 8. UI / UX 要点

遵循 `contributing.md` "UI/UX Philosophy"：

- **Minimize New Elements**：主面板用 Tabs 切换三个视图，不堆叠多余控件
- **Respect PrUn's Visual Style**：复用 `C` 对象的 PrUn CSS 类，颜色用 `rgb(217, 83, 79)` 等 PrUn 自带色
- **Tooltips**：用 `data-tooltip` 而非 `title`
- **状态颜色**：参照 `feature-patterns.md` 的三档色（红/橙/绿用 inline style，因 `C.ColoredValue` 无 `.danger`/`.warning`）
  - PUBLISHED → 绿 `#5cb85c`
  - CLAIMED → 橙 `#f0ad4e`
  - COMPLETED → 灰（普通文字色）
  - CANCELLED → 红 `#d9534f`
- **服务端动作**：每个状态转移按钮均需用户点击，禁用任何自动轮询触发的状态变更
- **空状态**：每个 Tab 提供简短引导文案

---

## 9. 后续拆分

本计划仅到架构层。后续将拆为两份独立实现计划：

### 9.1 客户端实现计划（下一步）
- `infrastructure/org-api/` 各文件实现（含单元测试，详见 §12.16 模块结构）
- `features/XIT/ORG/` 各 Vue 组件实现（详见 §6 模块结构）
- 与 CONTGEN/CONTD 集成测试（详见 §7.1/7.2）
- 合同状态监听与上报（详见 §7.3）
- 30s 轮询与通知触发（详见 §12.11）
- userData 迁移（`user-data-migrations.ts` 顶部新增）
- 在 `XIT/index.ts` 注册 ORG 命令
- 在 `xit-commands.ts` 添加命令元信息

### 9.2 后端实现计划（Cloudflare Worker 独立仓库）
- Worker 项目骨架（Hono + TypeScript，详见 §12.5）
- D1 数据库 schema 与 migrations（详见 §12.4）
- 鉴权实现：JWT + PBKDF2 + refresh token（详见 §12.7/12.8）
- API 端点实现（详见 §12.9 清单）
- 业务逻辑：状态校验/合同同步/邀请码原子性/限流（详见 §12.10）
- Cron Trigger 过期任务清理（详见 §12.10.5）
- 管理员端点（详见 §12.12）
- 部署：wrangler deploy + secrets（详见 §12.13）
- 测试：Vitest + Miniflare

---

## 10. 风险与待确认事项

| # | 风险 / 待确认 | 缓解 / 后续动作 |
| --- | --- | --- |
| 1 | `usersStore` / `companyStore` 的实际 API 形态未确认 | 客户端实现计划阶段读取 `prun-api/data/users.ts` 与 `company.ts` 确认 |
| 2 | LOAN 类型的 `contractJson` 结构未定 | 后期扩展时单独规划，本计划仅保留类型占位 |
| 3 | 任务删除策略（CANCELLED/COMPLETED 是否软删除、保留多久）| 后端实现计划覆盖（建议保留 + 定期归档） |
| 4 | 用户切换 PrUn 账号时的处理 | §7.4 已定：客户端校验身份一致性，不一致则 logout |
| 5 | 后端服务地址（生产环境 URL、本地开发 URL）| §12.15 已定：`VITE_ORG_API_BASE` 注入；本地用 `wrangler dev` |
| 6 | 业务逻辑全在 Worker 内，Worker 代码 bug 可能漏校验 | §12.19 风险 #1：单元测试 + 集成测试覆盖所有状态转移 |
| 7 | `(prun_username, company_code)` 可被用户伪造 | §12.19 风险 #2：登录后客户端校验；后期可加 service_role 验证 |
| 8 | 50 人超限后需升级 Workers Paid $5/月 | §12.19 风险 #3：监控 Workers 请求量；用户量增长时升级 |
| 9 | 邀请码爆破（10 字符 base32 = 50 bit 熵）| §12.19 风险 #4：注册端点限流 5/h + 失败审计告警 |
| 10 | D1 是 SQLite，无 PostgreSQL 高级特性（JSONB/RLS/plpgsql）| §12.19 风险 #5：接受简化；JSON 用 `json_extract()`；隔离用 Worker 中间件 |
| 11 | Cloudflare 账号被封禁导致服务中断 | §12.19 风险 #6：备份 D1 到 R2；保留 schema 可迁移 |
| 12 | 跨用户数据隔离仅靠 Worker 校验（无 DB 强制）| §12.19 风险 #8：严格 code review + 单元测试；后期可加 DB CHECK 约束 |
| 13 | access token 失效期间用户操作被中断 | §12.19 风险 #7：客户端 401 自动刷新；refresh 7d 滚动续期 |
| 14 | contractsStore 中合同状态的实际 API 形态未确认 | 客户端实现计划阶段读取 `prun-api/data/contracts.ts` 确认 |
| 15 | 所有 BOARD 同时离线/被降级 → 无管理员 | §12.21 引导流程：初始 BOARD 通过 wrangler SQL 提升；BOARD 之间互相降级有"不可降级自己"保护，但仍可能互相降级锁死——审计日志可追溯，wrangler SQL 兜底恢复 |
| 16 | role 提升后旧 access token 仍带旧 role 最多 15 分钟 | §12.7.4/12.21.4 已确认可接受；客户端 401/403 后立即 /auth/me 拉取最新 role |
| 17 | 客户端权限 helper 被绕过（用户改本地代码直接调 /board/*）| §12.21.2 已声明：客户端 helper 仅 UI 显示用，Worker boardOnly 中间件 + cancelTask role 校验为最终权威 |
| 18 | BOARD 误降级最后一个其他 BOARD | §12.21 自我降级保护仅防自己降自己；建议运维约定"至少保留 2 个 BOARD" + 审计告警 |

---

## 11. 任务清单（高层，待拆分为可执行步骤）

> 以下为高层任务，每项在后续"客户端实现计划"或"后端实现计划"中拆分为 writing-plans 风格的可执行步骤（含失败测试 → 实现 → 通过测试 → 提交）。

### 客户端高层任务

- [ ] **C1**: 在 `src/infrastructure/org-api/types.ts` 定义全部类型（OrgUser 含 role / OrgTask / TaskStatus / TaskContractJson / TaskNote / UserRole）
- [ ] **C2**: 实现 `session.ts`（localStorage 读写 access/refresh token + 当前 user 含 role）
- [ ] **C3**: 实现 `client.ts`（fetch wrapper + JWT 自动注入 + 401 自动刷新）
- [ ] **C4**: 实现 `auth.ts`（register/login/logout/me/refresh）
- [ ] **C5**: 实现 `tasks.ts`（list/create/patch/claim/release/cancel/link-contract/sync-status API 调用）
- [ ] **C6**: 实现 `notes.ts`（list/create 备注）
- [ ] **C7**: 实现 `contract-link.ts`（监听 contractsStore → POST sync-status）
- [ ] **C8**: 实现 `polling.ts`（30s 轮询 + 增量更新 + 通知触发 + 定期刷新 /auth/me 同步 role）
- [ ] **C9**: 实现 `board.ts`（/board/invite-codes /board/users /board/audit-logs /board/stats API 调用）
- [ ] **C10**: 实现 `permissions.ts`（isBoard/canCancelAny/canCancelTask/canSeeBoardPanel/canPromoteDemote 只读 helper，详见 §12.21.3）
- [ ] **C11**: userData schema 新增 `org` 字段（lastViewedTab + lastPollAt）+ 顶部新增 migration
- [ ] **C12**: 实现 `AuthOverlay.vue`（邀请码注册 + 登录，含 PrUn 身份读取）
- [ ] **C13**: 实现 `RoleBadge.vue`（顶部显示当前用户角色徽章 BOARD/COLLABORATOR）
- [ ] **C14**: 实现 `ORG.vue` 主面板（Tabs + 路由到子视图；"管理"Tab 仅 BOARD 可见）
- [ ] **C15**: 实现 `TaskList.vue` + `TaskCard.vue`（按状态过滤、显示摘要）
- [ ] **C16**: 实现 `TaskDetail.vue`（完整 contractJson + 操作按钮矩阵 + 备注区；BOARD 多"取消任何任务"按钮 + reason 输入）
- [ ] **C17**: 实现 `PublishTask.vue`（复用 CONTGEN 表单逻辑 + 有效期字段）
- [ ] **C18**: 实现 `LinkContract.vue`（上报 contractId + creator 选择）
- [ ] **C19**: 实现 `NoteEditor.vue`（任务级备注编辑）
- [ ] **C20**: 实现 `board/BoardPanel.vue` + 子视图（InviteCodes / UserManager / AuditLogs / Stats，仅 BOARD 可见）
- [ ] **C21**: 实现 `utils.ts` 的 `sendTaskToContd` 联动 CONTD（含合同类型反转规则）
- [ ] **C22**: 在 `XIT/index.ts` 注册 ORG 命令 + 在 `xit-commands.ts` 添加元信息
- [ ] **C23**: 端到端手动测试（注册[COLLABORATOR] → BOARD 提升 → 发布 → 接取 → 创建合约 → 上报 contractId → 合同状态同步 → 完成；BOARD 取消他人任务）

### 后端高层任务（Cloudflare Worker 独立仓库）

- [ ] **B1**: Worker 项目骨架（Hono + TypeScript + wrangler.toml + D1/KV 绑定）
- [ ] **B2**: D1 数据库 schema + migrations/001_init.sql（含 users.role 字段，详见 §12.4）
- [ ] **B3**: 鉴权工具实现（jwt.ts 含 role payload + password.ts + invite-code.ts）
- [ ] **B4**: 邀请码管理（BOARD 生成、吊销、一次性校验，D1 batch 原子占用）
- [ ] **B5**: 认证端点（register[即 COLLABORATOR]/login/me/logout/refresh，详见 §12.8）
- [ ] **B6**: 任务端点（CRUD + 状态转移校验，详见 §12.10.1/12.10.2）
- [ ] **B7**: 合同状态同步端点（sync-status，详见 §12.10.3）
- [ ] **B8**: 任务取消端点按 role 区分权限（详见 §12.10.6 cancelTask isPublisher/isBoard）
- [ ] **B9**: boardOnly 中间件 + 限流中间件（D1 表计数，详见 §12.10.4）+ Cron Trigger 过期清理（详见 §12.10.5）
- [ ] **B10**: 董事会端点（/board/invite-codes CRUD + /board/users list + promote/demote[禁止降级自己] + /board/stats + /board/audit-logs，详见 §12.9）
- [ ] **B11**: 部署（wrangler deploy + secrets 设置 + 初始 BOARD 引导，详见 §12.13）
- [ ] **B12**: 测试（Vitest + Miniflare 单元 + 集成测试，覆盖所有状态转移、隔离校验、role 权限校验、自我降级保护）

---

## 12. 后端细化设定（Cloudflare 原生栈 + 免费档）

本章节汇总"后端设定"对话中确认的所有后端架构决策。**后端采用 Cloudflare 原生栈**：Workers（计算）+ D1（SQLite 数据库）+ KV（限流）+ Cron Triggers（定时任务），完全运行在 Cloudflare 免费档上，针对 50 人邀请制群体优化。

### 12.1 架构形态

```
┌─────────────────────────────────────────────────────────┐
│  PrUn Game (浏览器)                                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Refined PrUn Extension                           │  │
│  │  ┌─────────────────┐    ┌──────────────────────┐  │  │
│  │  │  XIT ORG Panel  │    │  AuthOverlay         │  │  │
│  │  │  (UI + 状态)     │    │  (注册/登录 UI)       │  │  │
│  │  └────────┬────────┘    └──────────┬───────────┘  │  │
│  │           │                         │              │  │
│  │  ┌────────▼─────────────────────────▼───────────┐  │  │
│  │  │  fetch() → Cloudflare Worker REST API        │  │  │
│  │  │  (业务逻辑全部在 Worker 内)                   │  │  │
│  │  └────────┬──────────────────────────────────────┘  │  │
│  └───────────┼─────────────────────────────────────────┘  │
└──────────────┼─────────────────────────────────────────────┘
               │ HTTPS + JWT Bearer
┌──────────────▼─────────────────────────────────────────────┐
│  Cloudflare 边缘网络（免费档）                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Worker (Hono + TypeScript)                          │ │
│  │  - 路由：/auth/* /tasks/* /notes/* /admin/*          │ │
│  │  - JWT 验证中间件                                    │ │
│  │  - 业务逻辑（状态转移校验/邀请码原子性/有效期清理）  │ │
│  │  - D1 数据访问层（参数化 SQL）                       │ │
│  └────┬─────────────────────────────────┬───────────────┘ │
│       │                                 │                 │
│  ┌────▼───────────┐              ┌─────▼──────────────┐  │
│  │  D1 (SQLite)   │              │  KV                │  │
│  │  users         │              │  rate-limit counters│ │
│  │  invite_codes  │              │                    │  │
│  │  refresh_tokens│              │                    │  │
│  │  tasks         │              │                    │  │
│  │  task_notes    │              │                    │  │
│  │  audit_logs    │              │                    │  │
│  └────────────────┘              └────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Cron Triggers (每 5 分钟)                           │ │
│  │  - 清理过期 PUBLISHED 任务 → CANCELLED               │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

**关键决策**：
- 后端**无应用服务器层**（无 Fastify/Express 长驻进程），Cloudflare Worker 是 V8 isolate + 短任务模型
- **业务逻辑全部在 Worker 内**：状态转移校验、合同状态同步、邀请码原子性、有效期判断、审计日志记录都在 Worker 内完成（比"全客户端"更安全，客户端无法绕过状态校验）
- **客户端只负责 UI + 调 REST API**（不再有任何业务逻辑）
- 同步策略：30s 客户端轮询 + Worker Cron Trigger 双向保障

### 12.2 技术选型

| 维度 | 选型 | 理由 |
| -------- | -------- | -------- |
| 计算平台 | **Cloudflare Workers**（V8 isolate） | 边缘 300+ 节点、免费档 10 万请求/天、冷启动 0ms |
| Web 框架 | **Hono** | 轻量、TypeScript 优先、为 Workers 优化、中间件生态成熟 |
| 数据库 | **D1**（SQLite-based） | Cloudflare 原生、免费档 5GB / 500 万读/天 / 10 万写/天 |
| 键值存储 | **KV** | 限流计数器、会话黑名单；免费档 10 万读/天 |
| 定时任务 | **Cron Triggers** | Cloudflare 原生、与 Worker 集成、免费档不限次数 |
| 鉴权 | **自签 JWT (HS256)** + PBKDF2 密码哈希 | 用 WebCrypto API 实现，无需外部依赖 |
| 类型共享 | **独立 types.ts** + 人工同步 | 50 人规模小项目，monorepo 过度设计 |
| 部署 | **`wrangler deploy`** 一条命令 | 无需 Docker、无需 CI/CD |
| 日志 | **Workers Logs**（结构化 console.log） | 免费档 20 万条/天，足够 |
| 测试 | **Vitest + Miniflare** | 本地 D1 模拟、单元 + 集成测试 |

### 12.3 免费档负载核算（50 人规模）

| 维度 | 50 人预估 | 免费档 | 余量 |
| -------- | -------- | -------- | -------- |
| Workers 请求 | ~12,600/天（30s 轮询 × 50 用户 × 4h + 5% 非轮询） | 100,000/天 | 87% |
| D1 行读 | ~5 万行/天 | 500 万行/天 | 99% |
| D1 行写 | ~300 行/天 | 10 万行/天 | 99.7% |
| D1 存储 | <1 MB/年 | 5 GB | 远超所需 |
| KV 读 | ~12,600/天（限流计数） | 100,000/天 | 87% |
| KV 写 | ~12,600/天 | 1,000/天 | ⚠️ **受限** |
| Cron Triggers | 288 次/天（5 分钟一次） | 不限 | 充足 |
| Workers Logs | ~12,600 条/天 | 200,000/天 | 94% |

**KV 写受限的应对**：50 人规模下注册/登录请求量低，限流改用 **Worker 内存计数（按实例）+ D1 表持久化（按小时桶）**，避免依赖 KV 写：

```sql
CREATE TABLE rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,           -- 如 "register:ip-1.2.3.4:2026071814"
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
```

Worker 内：先 SELECT 计数 → 若未超限则 UPSERT 计数 +1。D1 写计入 10 万/天额度，但 50 人下远低于上限。

### 12.4 D1 数据库 Schema（SQLite 语法）

```sql
-- ============ migrations/001_init.sql ============

-- users 表
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,                    -- cuid
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,                       -- PBKDF2 哈希
  prun_username   TEXT NOT NULL,
  company_code    TEXT NOT NULL,
  display_name    TEXT NOT NULL DEFAULT prun_username,
  role            TEXT NOT NULL DEFAULT 'COLLABORATOR'
                  CHECK (role IN ('BOARD','COLLABORATOR')),  -- 详见 §12.21
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
  code            TEXT NOT NULL UNIQUE,                -- 10 字符 base32
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  used_by_user_id TEXT UNIQUE,
  used_at         TEXT,
  revoked_at      TEXT
);
CREATE INDEX idx_invite_codes_code ON invite_codes (code);

-- refresh_tokens 表（用于刷新 access token，存 hash）
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
  contract_json          TEXT NOT NULL,                -- JSON string
  status                 TEXT NOT NULL DEFAULT 'PUBLISHED'
                         CHECK (status IN ('PUBLISHED','AWAITING_CONTRACT','IN_PROGRESS','COMPLETED','CANCELLED')),
  publisher_id           TEXT NOT NULL REFERENCES users(id),
  publisher_username     TEXT NOT NULL,
  publisher_company_code TEXT NOT NULL,
  claimer_id             TEXT REFERENCES users(id),
  claimer_username       TEXT,
  claimer_company_code   TEXT,
  contract_id            TEXT UNIQUE,                  -- PrUn 游戏内合同 ID
  contract_creator       TEXT CHECK (contract_creator IN ('publisher','claimer')),
  expires_at             TEXT,                         -- ISO 8601
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
  actor_type      TEXT NOT NULL,                       -- user/admin/system
  actor_id        TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  metadata        TEXT,                                -- JSON string
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

-- updated_at 触发器（SQLite 原生）
CREATE TRIGGER trg_tasks_touch_updated_at
  AFTER UPDATE ON tasks
  FOR EACH ROW
  BEGIN
    UPDATE tasks SET updated_at = datetime('now') WHERE id = OLD.id;
  END;
```

**与 PostgreSQL/Supabase 的关键差异**：
- 用 `TEXT` 存 ISO 8601 时间戳（SQLite 无 `TIMESTAMPTZ`）
- `contract_json` / `metadata` 用 `TEXT` 存 JSON 字符串（SQLite 无 `JSONB`，D1 支持 `json_extract()` 函数）
- 触发器用 SQLite 语法（`AFTER UPDATE ... BEGIN ... END`）
- 无 RLS、无 `SECURITY DEFINER`、无 plpgsql——所有数据隔离与业务校验在 Worker 内

### 12.5 Worker 项目结构

```
rprun-org-worker/                     # 独立仓库（与 rprun 扩展分离）
├── src/
│   ├── index.ts                      # Worker 入口 + Hono app + Cron handler
│   ├── config.ts                     # env 绑定（D1/KV/Secrets）
│   ├── routes/
│   │   ├── auth.ts                   # /auth/register /login /me /refresh /logout
│   │   ├── tasks.ts                  # /tasks CRUD + 状态转移
│   │   ├── notes.ts                  # /tasks/:id/notes
│   │   └── admin/
│   │       ├── invite-codes.ts       # /admin/invite-codes CRUD
│   │       └── stats.ts              # /admin/stats /audit-logs
│   ├── middleware/
│   │   ├── jwt.ts                    # JWT 验证 + req.user 注入
│   │   ├── admin.ts                  # X-Admin-Key 校验
│   │   ├── rate-limit.ts             # D1 表计数限流
│   │   └── error.ts                  # 全局错误处理
│   ├── services/                     # 业务逻辑
│   │   ├── auth-service.ts           # 注册/登录/JWT 颁发
│   │   ├── task-service.ts           # 状态转移校验（canTransition）
│   │   ├── contract-sync-service.ts  # 合同状态同步
│   │   ├── invite-service.ts         # 邀请码生成 + 一次性校验
│   │   └── audit-service.ts          # 审计日志
│   ├── db/
│   │   ├── client.ts                 # D1 准备语句封装
│   │   ├── schema.sql                # CREATE TABLE / INDEX
│   │   ├── migrations/
│   │   │   └── 001_init.sql
│   │   └── repositories/             # 数据访问层
│   │       ├── users.repo.ts
│   │       ├── invite-codes.repo.ts
│   │       ├── tasks.repo.ts
│   │       ├── notes.repo.ts
│   │       ├── audit-logs.repo.ts
│   │       └── rate-limits.repo.ts
│   ├── utils/
│   │   ├── jwt.ts                    # HS256 签发/验证（WebCrypto API）
│   │   ├── password.ts               # PBKDF2 哈希（WebCrypto）
│   │   ├── invite-code.ts            # 10 字符 base32 生成
│   │   ├── errors.ts                 # HttpError 类
│   │   └── validation.ts             # Zod schema
│   └── types.ts                      # 共享类型（与扩展人工同步）
├── tests/                            # Vitest + Miniflare 本地测试
├── wrangler.toml                     # Cloudflare 配置
├── package.json
├── tsconfig.json
└── README.md
```

### 12.6 wrangler.toml 配置

```toml
name = "rprun-org-api"
main = "src/index.ts"
compatibility_date = "2026-07-01"
compatibility_flags = ["nodejs_compat"]

# D1 数据库绑定
[[d1_databases]]
binding = "DB"
database_name = "rprun-org-db"
database_id = "<wrangler d1 create 自动生成>"

# KV 命名空间绑定（仅用于会话黑名单等低频写场景）
[[kv_namespaces]]
binding = "KV"
id = "<wrangler kv:namespace create 自动生成>"

# Cron Triggers（每 5 分钟清理过期任务）
[triggers]
crons = ["*/5 * * * *"]

# 环境变量（非敏感）
[vars]
ENV = "production"
JWT_ACCESS_TTL = "900"           # 15min
JWT_REFRESH_TTL = "604800"       # 7d
RATE_LIMIT_REGISTER_PER_HOUR = "5"
RATE_LIMIT_LOGIN_PER_HOUR = "20"
POLL_INTERVAL_ADVICE = "30"      # 给客户端的建议轮询间隔（秒）

# 敏感 secrets 用 wrangler secret put 设置
# JWT_SECRET, REFRESH_TOKEN_SECRET, ADMIN_KEY
```

### 12.7 鉴权设计

#### 12.7.1 JWT 自签（WebCrypto API）

```ts
// src/utils/jwt.ts
const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify'],
  );
}

export async function signJWT(
  payload: object, secret: string, ttlSeconds: number,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return `${data}.${base64url(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<object | null> {
  const [headerB64, payloadB64, sigB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) return null;
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC', key, base64urlDecode(sigB64),
    encoder.encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) return null;
  const payload = JSON.parse(base64urlDecodeStr(payloadB64));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
```

#### 12.7.2 密码哈希（PBKDF2，WebCrypto）

```ts
// src/utils/password.ts
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key, 256,
  );
  return `pbkdf2$100000$${toHex(salt)}$${toHex(new Uint8Array(hash))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterStr, saltHex, hashHex] = stored.split('$');
  if (algo !== 'pbkdf2') return false;
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: parseInt(iterStr), hash: 'SHA-256' },
    key, 256,
  );
  return toHex(new Uint8Array(hash)) === hashHex;
}
```

#### 12.7.3 JWT 鉴权中间件 + boardOnly 中间件

```ts
// src/middleware/jwt.ts
import { createMiddleware } from 'hono/factory';
import { verifyJWT } from '../utils/jwt';

export const authMiddleware = createMiddleware(async (c, next) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } }, 401);
  }
  const payload = await verifyJWT(auth.slice(7), c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, 401);
  }
  c.set('user', payload as { sub: string; prun_username: string; company_code: string; role: 'BOARD' | 'COLLABORATOR' });
  await next();
});

// src/middleware/board-only.ts
// 董事会专属端点鉴权（取代原 X-Admin-Key，详见 §12.21 权限分层）
import { createMiddleware } from 'hono/factory';

export const boardOnly = createMiddleware(async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'BOARD') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Board members only' } }, 403);
  }
  await next();
});
```

> **使用方式**：`app.post('/board/invite-codes', authMiddleware, boardOnly, handler)`。authMiddleware 先验证 JWT 注入 user，boardOnly 再校验 role。

#### 12.7.4 Token 策略

- **access token**：15 分钟，JWT HS256，payload `{ sub, prun_username, company_code, role, iat, exp }`
- **refresh token**：7 天，随机 32 字节 base64url，仅存 hash 在 `refresh_tokens` 表
- **登出**：吊销当前 refresh token；access token 15 分钟后自然过期（无 token 撤销列表，依赖 short-lived）
- **续期**：客户端检测到 401 时用 refresh token 调 `/auth/refresh` 获取新 access + refresh token（滚动刷新）
- **role 提升后**：客户端在下次 `/auth/refresh` 或 `/auth/me` 时获取新 role；旧 access token 仍带旧 role 直到过期（最多 15 分钟，可接受）

### 12.8 鉴权与注册流程

#### 12.8.1 注册流程（D1 事务保证原子性）

```ts
// src/services/auth-service.ts
export async function registerWithInvite(
  env: Env,
  params: { email: string; password: string; inviteCode: string; prunUsername: string; companyCode: string },
): Promise<{ user: User; accessToken: string; refreshToken: string }> {
  const { email, password, inviteCode, prunUsername, companyCode } = params;
  const passwordHash = await hashPassword(password);
  const userId = generateId();

  // D1 batch：单个 SQLite 事务，任一失败全部回滚
  const statements = [
    // 1. 原子占用邀请码（条件 UPDATE，保证一次性）
    env.DB.prepare(
      `UPDATE invite_codes
       SET used_by_user_id = ?, used_at = datetime('now')
       WHERE code = ? AND used_by_user_id IS NULL AND revoked_at IS NULL`,
    ).bind(userId, inviteCode),

    // 2. 创建用户（email/username 唯一冲突时 batch 自动回滚）
    env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, prun_username, company_code, invite_code_id)
       VALUES (?, ?, ?, ?, ?,
         (SELECT id FROM invite_codes WHERE code = ?))`,
    ).bind(userId, email, passwordHash, prunUsername, companyCode, inviteCode),

    // 3. 审计日志
    env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id)
       VALUES (?, 'user', ?, 'user.register', 'user', ?)`,
    ).bind(generateId(), userId, userId),
  ];

  const results = await env.DB.batch(statements);
  // 第一个语句（UPDATE invite_codes）的 meta.changes 必须为 1，否则邀请码无效或已被抢用
  if (results[0].meta.changes !== 1) {
    throw new HttpError(400, 'INVITE_INVALID');
  }

  // 颁发 tokens
  const accessToken = await signJWT(
    { sub: userId, prun_username: prunUsername, company_code: companyCode },
    env.JWT_SECRET, parseInt(env.JWT_ACCESS_TTL),
  );
  const refreshToken = await issueRefreshToken(env, userId);
  return { user: { id: userId, email, prun_username: prunUsername, company_code: companyCode, display_name: prunUsername }, accessToken, refreshToken };
}
```

> **D1 batch 原子性**：`db.batch()` 在单个 SQLite 事务中执行所有语句，任一失败自动回滚。条件 `UPDATE invite_codes ... WHERE used_by_user_id IS NULL` 保证两人同时用同一邀请码时只有一个 `meta.changes = 1`。这取代了 PostgreSQL 的 `SECURITY DEFINER` RPC + `FOR UPDATE` 锁行。

#### 12.8.2 注册时序

```
1. 客户端：POST /auth/register
   Body: { email, password, inviteCode, prunUsername, companyCode }
   → prunUsername/companyCode 从扩展内 usersStore/companyStore 读取
2. Worker：registerWithInvite()
   a. PBKDF2 哈希密码
   b. D1 batch 事务：UPDATE invite_codes + INSERT users + INSERT audit_logs
   c. 颁发 access + refresh token
3. 客户端：收到 tokens → 存 localStorage → 进入 XIT ORG 面板
4. 失败（INVITE_INVALID / USER_EXISTS / EMAIL_EXISTS）→ 客户端显示错误，不存 token
```

> **与 Supabase 方案的关键改进**：无 auth.users 与业务 users 表分离的问题，单次 batch 事务原子完成，无需客户端回滚 auth.users。

#### 12.8.3 登录流程

```ts
// 客户端
const res = await api.post('/auth/login', { email, password });
// → Worker 校验 email + PBKDF2 密码 → 颁发 tokens
// → 客户端存 localStorage

// 登录后客户端校验当前 PrUn 身份一致性
const me = await api.get('/auth/me');
if (me.prun_username !== currentPrunUsername || me.company_code !== currentCompanyCode) {
  await api.post('/auth/logout', { refreshToken });
  throw new Error('PRUN_IDENTITY_MISMATCH');
}
```

### 12.9 API 端点清单

| 方法 | 路径 | 鉴权 | 说明 |
| -------- | -------- | -------- | -------- |
| POST | `/auth/register` | 限流 5/h | Body: `{ email, password, inviteCode, prunUsername, companyCode }`；注册即 COLLABORATOR（详见 §12.21） |
| POST | `/auth/login` | 限流 20/h | Body: `{ email, password }` |
| POST | `/auth/refresh` | - | Body: `{ refreshToken }` |
| POST | `/auth/logout` | JWT | Body: `{ refreshToken }` |
| GET | `/auth/me` | JWT | 当前用户信息（含 role） |
| GET | `/tasks?scope=board\|published\|claimed&...` | JWT | 任务列表（支持 type/username/location/since 过滤） |
| GET | `/tasks/:id` | JWT | 任务详情（含 notes） |
| POST | `/tasks` | JWT | 创建任务（BOARD 与 COLLABORATOR 均可，详见 §12.21） |
| PATCH | `/tasks/:id` | JWT | 编辑（仅 PUBLISHED 且为发布者） |
| POST | `/tasks/:id/claim` | JWT | 接取 → AWAITING_CONTRACT |
| POST | `/tasks/:id/release` | JWT | 释放 → PUBLISHED（仅当前接取者） |
| POST | `/tasks/:id/cancel` | JWT | 取消（发布者可取消自己任务；BOARD 可取消任何任务，详见 §12.10.6） |
| POST | `/tasks/:id/link-contract` | JWT | 上报 contractId + creator |
| POST | `/tasks/:id/sync-status` | JWT | 客户端检测合同状态变化后上报 `{ contractStatus }` |
| GET | `/tasks/:id/notes` | JWT | 备注列表 |
| POST | `/tasks/:id/notes` | JWT | 追加备注 |
| GET | `/board/invite-codes` | JWT + boardOnly | 列表（含使用情况） |
| POST | `/board/invite-codes` | JWT + boardOnly | 批量生成 `{ count, createdBy }` |
| POST | `/board/invite-codes/:id/revoke` | JWT + boardOnly | 吊销未使用的邀请码 |
| GET | `/board/users` | JWT + boardOnly | 用户列表（含 role） |
| POST | `/board/users/:id/promote` | JWT + boardOnly | COLLABORATOR → BOARD |
| POST | `/board/users/:id/demote` | JWT + boardOnly | BOARD → COLLABORATOR（不允许降级自己，防误操作锁死） |
| GET | `/board/stats` | JWT + boardOnly | 用户数、任务数、角色分布统计 |
| GET | `/board/audit-logs` | JWT + boardOnly | 审计日志查询 |
| GET | `/health` | - | 健康检查（无需鉴权） |

> **/admin/* 端点已废弃**：原 X-Admin-Key 鉴权方案已删除，全部迁移到 `/board/*` 路径 + JWT + boardOnly 中间件。ADMIN_KEY 环境变量保留作为 Cloudflare Dashboard 维护用（如数据库直连修复），不再进入 Worker 鉴权流程。

### 12.10 业务逻辑（全部在 Worker 内）

#### 12.10.1 状态转移校验

```ts
// src/services/task-service.ts
const TASK_TRANSITIONS: Record<string, string[]> = {
  PUBLISHED: ['AWAITING_CONTRACT', 'CANCELLED'],
  AWAITING_CONTRACT: ['IN_PROGRESS', 'PUBLISHED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: string, to: string): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}
```

每次状态转移端点（claim/release/cancel/sync-status）调用前，Worker 都校验：
1. 用户是任务的 publisher 或 claimer（数据隔离）
2. `canTransition(currentStatus, nextStatus)` 通过（业务校验）
3. 写入 D1 + 审计日志

#### 12.10.2 数据访问隔离（取代 RLS）

```ts
// src/db/repositories/tasks.repo.ts
export async function getTasksForUser(db: D1Database, userId: string, filter: TaskFilter) {
  if (filter.scope === 'board') {
    // 任务板：所有 PUBLISHED 任务可见（无需数据隔离，公开任务）
    return db.prepare(
      `SELECT * FROM tasks WHERE status = 'PUBLISHED'
       ${filter.type ? 'AND type = ?' : ''}
       ${filter.publisherUsername ? 'AND publisher_username = ?' : ''}
       ORDER BY published_at DESC LIMIT ? OFFSET ?`,
    ).bind(...).all();
  }
  if (filter.scope === 'published') {
    // 我的发布：仅自己作为 publisher（数据隔离）
    return db.prepare(
      `SELECT * FROM tasks WHERE publisher_id = ? ORDER BY created_at DESC`,
    ).bind(userId).all();
  }
  if (filter.scope === 'claimed') {
    // 我的接取：仅自己作为 claimer（数据隔离）
    return db.prepare(
      `SELECT * FROM tasks WHERE claimer_id = ? ORDER BY claimed_at DESC`,
    ).bind(userId).all();
  }
}

export async function updateTask(
  db: D1Database, taskId: string, userId: string, updates: Partial<Task>,
): Promise<void> {
  // 隔离校验：仅 publisher 或 claimer 可改
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  if (!task) throw new HttpError(404, 'TASK_NOT_FOUND');
  if (task.publisher_id !== userId && task.claimer_id !== userId) {
    throw new HttpError(403, 'NOT_TASK_PARTY');
  }
  // 状态转移校验
  if (updates.status && !canTransition(task.status as string, updates.status)) {
    throw new HttpError(400, 'INVALID_TRANSITION');
  }
  // ... 执行 UPDATE
}
```

> **与 RLS 的区别**：RLS 是数据库层强制（即使 Worker 有 bug 也无法绕过）；Worker 中间件是应用层校验。Cloudflare 路线只有这一个选项——Worker 单一代码库审计比分散的 RLS 策略更易审查。

#### 12.10.3 合同状态同步（客户端上报 + Worker 校验）

```ts
// src/services/contract-sync-service.ts
// ⚠️ 状态名必须用大写：客户端 types.ts 的 PrunContractStatus 与 PrUn contracts.types.d.ts 一致
const CONTRACT_STATUS_TO_TASK: Partial<Record<PrunContractStatus, TaskStatus>> = {
  CLOSED: 'IN_PROGRESS',
  FULFILLED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  BREACHED: 'CANCELLED',
  TERMINATED: 'CANCELLED',
};

export async function syncTaskFromContract(
  env: Env, taskId: string, contractStatus: string, userId: string,
): Promise<void> {
  const next = CONTRACT_STATUS_TO_TASK[contractStatus];
  if (!next) return;

  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?')
    .bind(taskId).first() as Task | null;
  if (!task) throw new HttpError(404, 'TASK_NOT_FOUND');

  // 隔离校验
  if (task.publisher_id !== userId && task.claimer_id !== userId) {
    throw new HttpError(403, 'NOT_TASK_PARTY');
  }
  // 状态转移校验
  if (!canTransition(task.status, next)) return;

  const now = new Date().toISOString();
  const updateFields = ['status = ?', 'updated_at = ?'];
  const bindings: any[] = [next, now];
  if (next === 'IN_PROGRESS') { updateFields.push('in_progress_at = ?'); bindings.push(now); }
  if (next === 'COMPLETED') { updateFields.push('completed_at = ?'); bindings.push(now); }
  if (next === 'CANCELLED') { updateFields.push('cancelled_at = ?'); bindings.push(now); }
  bindings.push(taskId);

  await env.DB.prepare(
    `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`,
  ).bind(...bindings).run();

  await writeAuditLog(env, {
    actor_type: 'user', actor_id: userId,
    action: 'task.sync_status', target_type: 'task', target_id: taskId,
    metadata: JSON.stringify({ from: task.status, to: next, contract_status: contractStatus }),
  });
}
```

#### 12.10.4 限流（D1 表计数，避免 KV 写限制）

```ts
// src/middleware/rate-limit.ts
export function rateLimit(action: string, limit: number, windowSeconds: number) {
  return createMiddleware(async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const bucketKey = `${action}:${ip}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const expiresAt = new Date(Date.now() + windowSeconds * 1000).toISOString();

    // UPSERT 计数
    await c.env.DB.prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, count, expires_at)
       VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE
       SET count = count + 1`,
    ).bind(bucketKey, expiresAt).run();

    const row = await c.env.DB.prepare(
      `SELECT count FROM rate_limit_buckets WHERE bucket_key = ?`,
    ).bind(bucketKey).first();

    if (row && (row.count as number) > limit) {
      return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429);
    }
    await next();
  });
}

// 注册/登录路由应用限流
auth.post('/register', rateLimit('register', 5, 3600), async (c) => { ... });
auth.post('/login', rateLimit('login', 20, 3600), async (c) => { ... });
```

#### 12.10.5 Cron Trigger：清理过期任务（每 5 分钟）

```ts
// src/index.ts
export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `UPDATE tasks
       SET status = 'CANCELLED', cancelled_at = ?, updated_at = ?
       WHERE status = 'PUBLISHED' AND expires_at IS NOT NULL AND expires_at < ?`,
    ).bind(now, now, now).run();
    console.log(`Expiry sweeper: cancelled ${result.meta.changes} tasks`);

    if (result.meta.changes > 0) {
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_type, action, target_type, metadata, created_at)
         VALUES (?, 'system', 'task.expiry_sweep', 'task', ?, datetime('now'))`,
      ).bind(generateId(), JSON.stringify({ count: result.meta.changes })).run();
    }

    // 顺便清理过期 rate_limit_buckets
    await env.DB.prepare(
      `DELETE FROM rate_limit_buckets WHERE expires_at < ?`,
    ).bind(now).run();
  },
} satisfies ExportedHandler<Env>;
```

> **优于客户端触发清理的方案**：Cron Trigger 是服务端可靠定时，不依赖客户端在线。即使所有用户离线，过期任务仍会被清理。

#### 12.10.6 任务取消权限（基于 role 区分）

任务取消端点 `POST /tasks/:id/cancel` 根据 `user.role` 区分权限（详见 §12.21 权限矩阵）：

```ts
// src/services/task-service.ts
export async function cancelTask(
  env: Env, taskId: string, userId: string, userRole: 'BOARD' | 'COLLABORATOR', reason?: string,
): Promise<void> {
  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?')
    .bind(taskId).first() as Task | null;
  if (!task) throw new HttpError(404, 'TASK_NOT_FOUND');

  // 权限校验：发布者可取消自己任务；BOARD 可取消任何任务
  const isPublisher = task.publisher_id === userId;
  const isBoard = userRole === 'BOARD';
  if (!isPublisher && !isBoard) {
    throw new HttpError(403, 'NOT_AUTHORIZED_TO_CANCEL');
  }

  // BOARD 取消他人任务时必须填 reason（审计需要）
  if (isBoard && !isPublisher && !reason) {
    throw new HttpError(400, 'REASON_REQUIRED_FOR_BOARD_CANCEL');
  }

  // 状态转移校验
  if (!canTransition(task.status, 'CANCELLED')) {
    throw new HttpError(400, 'INVALID_TRANSITION');
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE tasks SET status = 'CANCELLED', cancelled_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(now, now, taskId).run();

  await writeAuditLog(env, {
    actor_type: 'user', actor_id: userId,
    action: isBoard && !isPublisher ? 'task.cancel_by_board' : 'task.cancel',
    target_type: 'task', target_id: taskId,
    metadata: JSON.stringify({ reason, by_board: isBoard && !isPublisher }),
  });
}
```

> **审计区分**：BOARD 取消他人任务记为 `task.cancel_by_board`（含 reason），便于事后追溯；普通取消记为 `task.cancel`。

### 12.11 同步策略（30s 客户端轮询）

```ts
// 客户端 src/infrastructure/org-api/polling.ts
const POLL_INTERVAL_MS = 30_000;
let lastPollAt = new Date().toISOString();

async function pollTasks() {
  const data = await api.get(`/tasks?scope=board&since=${encodeURIComponent(lastPollAt)}`);
  if (data.length > 0) {
    lastPollAt = data[data.length - 1].updated_at;
    applyTaskUpdates(data);     // 更新本地状态 + 触发通知
  }
}

setInterval(pollTasks, POLL_INTERVAL_MS);
```

**50 人规模下的成本**：50 用户 × 4h × (3600/30) = 24,000 请求/天，仅用免费档 24%。

**优化（按需触发）**：仅当 XIT ORG 面板处于活动 tile 时轮询，窗口失焦时暂停——可进一步降低 50%-80% 请求量。

**通知触发**：客户端比对本地缓存的 `lastSeenStatus` 与轮询拉取的新 status，状态变化时触发面板内 Badge + PrUn NOTS。

**后期升级路径**（免费档不支持）：升级 Workers Paid $5/月后可用 Durable Objects + WebSocket 长连接，进一步降本。

### 12.12 董事会管理后台（XIT ORG 内嵌 + curl 备用）

**双入口**：董事会特权既可在 XIT ORG 面板内嵌的 `BoardPanel.vue` 中操作（推荐，详见 §6），也可通过 curl 调用 `/board/*` 端点（运维备用）。鉴权统一为 JWT + boardOnly 中间件（详见 §12.7.3），不再使用 X-Admin-Key。

**curl 示例**（需先调 `/auth/login` 获取 access token）：

```bash
# 登录获取 access token（BOARD 账号）
TOKEN=$(curl -s -X POST 'https://rprun-org-api.<acct>.workers.dev/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"board@example.com","password":"***"}' | jq -r .accessToken)

# 生成 5 个邀请码
curl -X POST 'https://rprun-org-api.<acct>.workers.dev/board/invite-codes' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"count": 5, "createdBy": "board-alice"}'

# 查看邀请码使用情况
curl 'https://rprun-org-api.<acct>.workers.dev/board/invite-codes' \
  -H "Authorization: Bearer $TOKEN"

# 吊销未使用的邀请码
curl -X POST 'https://rprun-org-api.<acct>.workers.dev/board/invite-codes/<id>/revoke' \
  -H "Authorization: Bearer $TOKEN"

# 列出用户（含 role）
curl 'https://rprun-org-api.<acct>.workers.dev/board/users' \
  -H "Authorization: Bearer $TOKEN"

# 提升合作者为董事会
curl -X POST 'https://rprun-org-api.<acct>.workers.dev/board/users/<id>/promote' \
  -H "Authorization: Bearer $TOKEN"

# 降级董事会为合作者（不允许降级自己）
curl -X POST 'https://rprun-org-api.<acct>.workers.dev/board/users/<id>/demote' \
  -H "Authorization: Bearer $TOKEN"

# 查看审计日志
curl 'https://rprun-org-api.<acct>.workers.dev/board/audit-logs?limit=100' \
  -H "Authorization: Bearer $TOKEN"
```

**初始 BOARD 账号的引导**：第一个 BOARD 账号通过 D1 直接 INSERT 创建（无邀请码路径，因为邀请码注册即 COLLABORATOR）：

```bash
# 通过 wrangler 直接 SQL 插入第一个 BOARD 账号（已用邀请码注册后提升）
wrangler d1 execute rprun-org-db --command \
  "UPDATE users SET role = 'BOARD' WHERE email = 'first-board@example.com'"
```

> 引导流程：1) 管理员 wrangler 创建初始邀请码 → 2) 第一个用户注册（COLLABORATOR）→ 3) 管理员 wrangler 直接 SQL 提升为 BOARD → 4) 该 BOARD 之后通过 `/board/invite-codes` 与 `/board/users/:id/promote` 管理后续用户。

**邀请码生成规则**：
- 长度 10 字符，字符集 `[A-Z2-9]`（去除易混淆的 0/O/1/I/L）
- `crypto.getRandomValues` 生成 → base32 编码 → 截断
- 数据库 `code` 字段唯一索引兜底碰撞

### 12.13 部署流程

```bash
# 1. 安装 wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 创建 D1 数据库
wrangler d1 create rprun-org-db
# 把返回的 database_id 填入 wrangler.toml

# 4. 创建 KV 命名空间（可选，限流已改用 D1 表，KV 留作扩展）
wrangler kv:namespace create KV
# 把返回的 id 填入 wrangler.toml

# 5. 设置 secrets
wrangler secret put JWT_SECRET          # 32+ 字节随机
wrangler secret put REFRESH_TOKEN_SECRET  # 32+ 字节随机
# ADMIN_KEY 不再使用（已迁移到 BOARD JWT 鉴权，详见 §12.9 注释）

# 6. 执行数据库迁移
wrangler d1 execute rprun-org-db --file=src/db/migrations/001_init.sql

# 7. 部署 Worker
wrangler deploy

# 8. 引导初始 BOARD 账号（详见 §12.12 引导流程）：
#    a) 用 wrangler 直接 INSERT 一个初始邀请码
wrangler d1 execute rprun-org-db --command \
  "INSERT INTO invite_codes (id, code, created_by) VALUES ('bootstrap', 'BOOTSTRAP01', 'system')"
#    b) 第一个用户在客户端用该邀请码注册（自动 COLLABORATOR）
#    c) wrangler 直接 SQL 提升该用户为 BOARD
wrangler d1 execute rprun-org-db --command \
  "UPDATE users SET role = 'BOARD' WHERE email = 'first-board@example.com'"
#    d) 该 BOARD 之后通过 /board/invite-codes 与 /board/users/:id/promote 管理后续用户

# 9. 验证健康检查
curl https://rprun-org-api.<acct>.workers.dev/health
```

**CORS 配置**（在 Worker 内）：
```ts
import { cors } from 'hono/cors';
app.use('*', cors({
  origin: ['chrome-extension://<extension-id>', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));
```

### 12.14 安全设定

| 维度 | 措施 |
| -------- | -------- |
| 邀请码防爆破 | 10 字符 base32 = 50 bit 熵；D1 batch 条件 UPDATE 防竞态；注册端点限流 5/h |
| username 伪造防护 | `(prun_username, company_code)` 在 users 表 UNIQUE；登录后客户端校验当前 PrUn 身份与 users 表一致，不一致则 logout |
| 密码安全 | PBKDF2 (100K 迭代 + 16 字节随机盐 + SHA-256)；不存明文 |
| JWT 安全 | HS256 + 服务端密钥；access 15min；refresh 7d 仅存 hash；登出吊销 refresh；payload 含 role |
| 跨用户数据隔离 | Worker 中间件校验 publisher_id/claimer_id = auth.uid()；tasks/notes 表所有查询带 user 过滤 |
| 角色权限校验 | `boardOnly` 中间件校验 role=BOARD；任务取消按 role 区分（详见 §12.10.6）；promote/demote 端点禁止降级自己 |
| 输入校验 | 所有端点用 Zod schema 校验；contractJson 用 JSON Schema 校验结构 |
| SQL 注入 | D1 全部参数化查询（`prepare().bind()`），无字符串拼接 |
| HTTPS 强制 | Cloudflare 自动 HTTPS，禁止 HTTP 回源 |
| CORS | 仅允许 rprun 扩展 origin + 本地测试 origin |
| 初始 BOARD 引导 | 第一次部署用 wrangler 直接 SQL 提升（详见 §12.12/12.13）；不暴露任何 ADMIN_KEY 端点 |
| 审计日志 | 所有关键状态转移 + 邀请码操作 + promote/demote + BOARD 取消他人任务均写 audit_logs |
| 限流 | 注册 5/h、登录 20/h、普通端点按需（D1 表计数） |
| 自我降级保护 | `/board/users/:id/demote` 校验 `:id !== auth.uid()`，防止误操作锁死自己 |

### 12.15 环境变量

**Worker 端（wrangler secret / vars）**：
```bash
# Secrets（wrangler secret put 设置）
JWT_SECRET=<32+ bytes random>
REFRESH_TOKEN_SECRET=<32+ bytes random>
# ADMIN_KEY 已废弃（BOARD 鉴权改用 JWT + boardOnly，详见 §12.9）

# Vars（wrangler.toml 中）
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800
RATE_LIMIT_REGISTER_PER_HOUR=5
RATE_LIMIT_LOGIN_PER_HOUR=20
POLL_INTERVAL_ADVICE=30
```

**扩展端（Vite 注入）**：
```bash
VITE_ORG_API_BASE=https://rprun-org-api.<acct>.workers.dev
```

### 12.16 客户端模块结构更新

原 §6 客户端模块结构需更新为 fetch 调用 Worker API（无业务逻辑，无 Supabase SDK）：

```
src/infrastructure/org-api/          # 新增基础设施层
  ├── client.ts                      # fetch wrapper + token 注入 + 401 自动刷新
  ├── auth.ts                        # register/login/logout/me/refresh
  ├── tasks.ts                       # 任务 CRUD + 状态转移（仅调 API，业务逻辑在 Worker）
  ├── notes.ts                       # 备注 CRUD
  ├── board.ts                       # 董事会专属 API：invite-codes/users(promote/demote)/stats/audit-logs
  ├── contract-link.ts               # 监听 contractsStore → POST /tasks/:id/sync-status
  ├── polling.ts                     # 30s 轮询 + 增量更新 + 通知触发
  ├── session.ts                     # localStorage 存 access/refresh token + 当前 user（含 role）
  ├── permissions.ts                 # 客户端权限判定（canCancelAny/isBoardOnly 等只读 helper，详见 §12.21）
  └── types.ts                       # 与 Worker 仓库人工同步类型
```

**关键简化（相比 Supabase 方案）**：
- 无 `task-transitions.ts`（状态校验在 Worker 内）
- 无 `audit.ts`（审计日志由 Worker 内部写）
- 无 `supabase-client.ts`（普通 fetch）
- 客户端纯 UI + API 调用，无业务逻辑

**权限相关客户端模块**：
- `board.ts` 封装所有 `/board/*` 端点调用；非 BOARD 用户调用时 Worker 直接 403，客户端不预校验（避免业务逻辑分散）
- `permissions.ts` 仅提供 UI 显示用 helper（如 `isBoard(user)` 决定是否显示"管理"Tab、`canCancelAny(user)` 决定取消按钮可见性）；任何敏感操作仍以 Worker 校验为最终权威

### 12.17 与原 §7 集成点的调整关系

| 原章节 | 调整 |
| -------- | -------- |
| §7.2 CONTD 联动 | 不变（仍是 sendTaskToContd + 用户上报 contractId） |
| §7.3 合同状态监听 | 客户端监听 contractsStore → `POST /tasks/:id/sync-status`（Worker 内校验 + 推进状态） |
| §7.4 PrUn 用户名读取 | 不变（仍从 usersStore/companyStore 读取，注册时上报 Worker） |
| §7.5 凭据存储 | **删除**——access/refresh token 存 localStorage，无需 crypto-secrets |
| §7.6 userData 扩展 | 简化——仅存 `lastViewedTab` 与 `lastPollAt`，session 由客户端 localStorage 管理 |

### 12.18 免费档硬性限制与缓解

| 限制 | 影响 | 缓解 |
| -------- | -------- | -------- |
| Workers CPU 10ms/请求 | 复杂查询/加密会超时 | D1 索引优化；JWT 验证 < 1ms；PBKDF2 仅注册时用 |
| D1 写 10 万行/天 | 大批量操作受限 | 50 人规模下每日写 < 300 行，远低于上限 |
| KV 写 1000/天 | 限流计数器受限 | 限流改用 D1 `rate_limit_buckets` 表（按小时桶） |
| 无 Durable Objects（免费档） | 不能用 WebSocket 长连接 | 接受 30s 轮询模式（50 人下仅用 24% 额度） |
| 无 Queues（免费档） | 不能异步任务 | 同步处理即可，50 人规模无需异步 |
| Workers Logs 20 万条/天 | 高频日志受限 | 仅关键路径日志；50 人下每日 < 1.3 万条 |

### 12.19 风险与待确认

| # | 风险 / 待确认 | 缓解 / 后续动作 |
| --- | --- | --- |
| 1 | 业务逻辑全在 Worker 内，Worker 代码 bug 可能漏校验 | 单元测试 + 集成测试覆盖所有状态转移；Worker 单代码库审计 |
| 2 | `(prun_username, company_code)` 可被用户伪造（注册时填错或故意）| 登录时客户端校验当前 PrUn 身份与 users 表一致；客户端校验可被绕过——可考虑后期加 service_role 验证 RPC |
| 3 | 50 人超限后需升级 Workers Paid $5/月 | 监控 Workers 请求量；用户量增长时升级 |
| 4 | 邀请码爆破（10 字符 base32 = 50 bit 熵）| 注册端点限流 5/h；失败次数记审计日志告警 |
| 5 | D1 是 SQLite，无 PostgreSQL 高级特性（JSONB/RLS/plpgsql） | 接受简化；JSON 用 `json_extract()` 函数；隔离用 Worker 中间件 |
| 6 | Cloudflare 账号被封禁导致服务中断 | 备份 D1 到 R2；保留 wrangler.toml 与 schema 可快速迁移到其他平台 |
| 7 | access token 失效期间用户操作被中断 | 客户端 401 自动刷新；refresh token 7d 滚动续期 |
| 8 | 跨用户数据隔离仅靠 Worker 校验（无 DB 强制） | 严格 code review + 单元测试；后期可加 DB CHECK 约束或 view 限制 |

### 12.20 与原 Supabase 方案对比（决策记录）

| 维度 | Supabase 方案 | Cloudflare 方案（采用） |
| -------- | -------- | -------- |
| 业务逻辑位置 | 全客户端 | **全 Worker 内**（更安全） |
| 数据隔离 | PostgreSQL RLS（DB 强制） | Worker 中间件（应用层） |
| 邀请码原子性 | plpgsql RPC + FOR UPDATE | D1 batch 事务 + 条件 UPDATE |
| 鉴权 | Supabase Auth（内置） | 自签 JWT + PBKDF2（WebCrypto） |
| REST API | PostgREST 自动生成 | Hono 路由手写 |
| 数据库 | PostgreSQL 15 | D1（SQLite） |
| 定时任务 | 客户端轮询触发（弱） | Cron Triggers（强） |
| 部署 | supabase.com 云托管 | `wrangler deploy` 一条命令 |
| 免费档 | 500MB DB / 50K MAU | 10 万 Workers 请求/天 / 5GB D1（50 人下充足） |
| 50 人下成本 | 免费 | 免费 |
| 全球延迟 | Supabase 区域（美国/欧洲） | Cloudflare 边缘（300+ 节点） |
| 选定理由 | - | **业务逻辑服务端化更安全、Cron Trigger 可靠、全球边缘低延迟、纯 Cloudflare 基础设施** |

### 12.21 用户权限分层（董事会 + 合作者）

**两层角色模型**（取代原 X-Admin-Key 鉴权方案）：

| 角色 | 标识 | 获取方式 | 定位 |
| -------- | -------- | -------- | -------- |
| **BOARD**（董事会） | `role = 'BOARD'` | 注册即 COLLABORATOR，由现有 BOARD 通过 `/board/users/:id/promote` 提升 | 组织管理者，拥有全部管理特权 |
| **COLLABORATOR**（合作者） | `role = 'COLLABORATOR'` | 邀请码注册即默认此角色 | 普通成员，发布/接取任务 |

**初始 BOARD 引导**：第一次部署时通过 wrangler 直接 SQL 提升首个用户为 BOARD（详见 §12.12/12.13）。之后所有角色管理通过 `/board/users/:id/promote|demote` 端点。

#### 12.21.1 权限矩阵

| 能力 | COLLABORATOR | BOARD | 实现位置 |
| -------- | -------- | -------- | -------- |
| 注册账号（邀请码） | - | - | §12.8 registerWithInvite |
| 登录/登出/刷新 token | ✓ | ✓ | §12.9 /auth/* |
| 查看任务板（PUBLISHED） | ✓ | ✓ | §12.10.2 getTasksForUser scope=board |
| 发布任务 | ✓ | ✓ | §12.9 POST /tasks |
| 编辑自己 PUBLISHED 任务 | ✓ | ✓ | §12.9 PATCH /tasks/:id |
| 接取任务 | ✓ | ✓ | §12.9 POST /tasks/:id/claim |
| 释放自己接取的任务 | ✓ | ✓ | §12.9 POST /tasks/:id/release |
| 上报 contractId | ✓ | ✓ | §12.9 POST /tasks/:id/link-contract |
| 上报合同状态变化 | ✓ | ✓ | §12.9 POST /tasks/:id/sync-status |
| 任务备注 | ✓ | ✓ | §12.9 /tasks/:id/notes |
| **取消自己任务** | ✓ | ✓ | §12.10.6 cancelTask isPublisher |
| **取消任何任务** | ✗ | ✓（需 reason） | §12.10.6 cancelTask isBoard |
| **生成/吊销邀请码** | ✗ | ✓ | §12.9 /board/invite-codes |
| **查看用户列表（含 role）** | ✗ | ✓ | §12.9 GET /board/users |
| **角色升降级** | ✗ | ✓（不可降级自己） | §12.9 /board/users/:id/promote\|demote |
| **查看审计日志** | ✗ | ✓ | §12.9 GET /board/audit-logs |
| **查看组织统计** | ✗ | ✓ | §12.9 GET /board/stats |

#### 12.21.2 服务端校验原则

- **客户端 UI 隐藏 ≠ 权限隔离**：客户端根据 `user.role` 隐藏管理 Tab 与取消他人任务按钮，但所有敏感操作仍以 Worker 校验为最终权威
- **boardOnly 中间件**：所有 `/board/*` 端点必须叠加 `authMiddleware + boardOnly`（详见 §12.7.3）；任何漏挂中间件都会导致 401（无 user）或 403（非 BOARD）
- **任务取消按 role 区分**（§12.10.6）：单端点 `POST /tasks/:id/cancel`，Worker 内根据 `userRole` 与 `isPublisher` 决定是否放行；BOARD 取消他人任务必须填 `reason`，审计记 `task.cancel_by_board`
- **自我降级保护**：`/board/users/:id/demote` 校验 `:id !== auth.uid()`，防止 BOARD 误操作把自己降级后无人管理
- **role 不在 JWT 之外暴露**：role 仅通过 JWT payload 与 `/auth/me` 返回，不接受客户端任何修改请求（修改 role 只能通过 `/board/users/:id/promote|demote`）

#### 12.21.3 客户端权限 helper（permissions.ts）

```ts
// src/infrastructure/org-api/permissions.ts
import type { OrgUser, UserRole } from './types';

export function isBoard(user: OrgUser | null): boolean {
  return user?.role === 'BOARD';
}

export function canCancelAny(user: OrgUser | null): boolean {
  return isBoard(user);
}

export function canCancelTask(user: OrgUser | null, task: OrgTask): boolean {
  if (!user) return false;
  // 发布者可取消自己任务；BOARD 可取消任何任务
  return task.publisherUsername === user.prunUsername || isBoard(user);
}

export function canSeeBoardPanel(user: OrgUser | null): boolean {
  return isBoard(user);
}

export function canPromoteDemote(user: OrgUser | null, targetId: string): boolean {
  // BOARD 可升降级他人，但不能降级自己
  return isBoard(user) && user.backendId !== targetId;
}
```

> **重要**：这些 helper 仅用于 UI 显示控制（按钮可见性、Tab 显示）。任何敏感操作的实际权限校验都在 Worker 内（boardOnly 中间件 + cancelTask 内的 role 校验）。客户端绕过这些 helper 直接调 API 时，Worker 仍会拒绝。

#### 12.21.4 角色变更后的客户端同步

- BOARD 调 `/board/users/:id/promote` 成功后，被提升用户的下次 `/auth/refresh` 或 `/auth/me` 才会拿到新 role（access token 内 role 最多滞后 15 分钟过期）
- 客户端 `RoleBadge.vue` 应在轮询时刷新 `/auth/me`，确保 role 变更及时反映
- 被降级的 BOARD 用户：当前 access token 仍带 BOARD role 直到过期；此时他调 `/board/*` 仍能通过；客户端应在 401/403 后立即 `/auth/me` 重新拉取 role 并更新本地状态

#### 12.21.5 审计要求

所有角色相关操作必须写 audit_logs（详见 §12.10.6 与 §12.14）：

| action | 触发 | metadata |
| -------- | -------- | -------- |
| `user.promote` | BOARD 调 promote 端点 | `{ target_user_id, from: 'COLLABORATOR', to: 'BOARD' }` |
| `user.demote` | BOARD 调 demote 端点 | `{ target_user_id, from: 'BOARD', to: 'COLLABORATOR' }` |
| `invite_code.generate` | BOARD 生成邀请码 | `{ count, codes: [...] }` |
| `invite_code.revoke` | BOARD 吊销邀请码 | `{ code_id, code }` |
| `task.cancel_by_board` | BOARD 取消他人任务 | `{ reason, by_board: true }` |

---

## Self-Review

**1. Spec coverage:**
- 入口（XIT ORG）→ §1 决策表 + §6 模块结构 + 任务 C22 ✓
- 发布/接取/释放/完成 → §3 状态机（合同驱动）+ §7.2/7.3 + §12.10 业务逻辑 ✓
- 群体共享 → §1 决策表 + §2 系统组件（Cloudflare） ✓
- 任务类型 BUY/SELL/SHIP + LOAN 占位 → §4.1 TaskType + §7.1 复用说明 ✓
- 邀请码 + 邮箱密码 + 自动绑定用户名 → §1 决策表 + §5 认证流程 + §12.8 注册流程 ✓
- 标识 = username + companyCode → §1 决策表 + §4.1 OrgUser + §5.1 注册流程 + §12.4 users 表 UNIQUE 约束 ✓
- 联动 CONTD → §7.2 ✓
- 合同驱动状态机 → §3 + §7.3 + §12.10.3 ✓
- 任务-合同关联（contractId）→ §3 + §4.1 OrgTask.contractId + §7.3 + §12.9 link-contract 端点 ✓
- 合同类型反转（BUY→SELL）→ §3 + §7.2 ✓
- 全状态监听 → §7.3 + §12.10.3 ✓
- 双通道通知 → §7.3 + §12.11 ✓
- 任务级备注区 → §4.1 TaskNote + §6 模块结构 + §12.9 notes 端点 ✓
- 列表过滤排序 → §6 TaskList + §12.9 任务列表端点 ✓
- PUBLISHED 可编辑 → §3 + §6 PublishTask + §12.9 PATCH /tasks/:id ✓
- 任务有效期 → §4.1 expiresAt + §12.4 tasks.expires_at + §12.10.5 Cron Trigger ✓
- 完成判定（合同 fulfilled）→ §3 + §12.10.3 ✓
- 后端 Cloudflare 原生栈 → §12.1 架构形态 ✓
- Workers + D1 + KV + Cron Triggers → §12.2 技术选型 ✓
- 免费档 50 人负载核算 → §12.3 ✓
- D1 SQLite Schema → §12.4 ✓
- Worker 项目结构 → §12.5 ✓
- wrangler.toml 配置 → §12.6 ✓
- 鉴权（自签 JWT + PBKDF2）→ §12.7 + §12.8 ✓
- API 端点清单 → §12.9 ✓
- 业务逻辑全 Worker 内 → §12.10 ✓
- 30s 轮询同步 → §12.11 ✓
- 董事会管理后台（XIT ORG 内嵌 + curl）→ §12.12 ✓
- 部署流程（含初始 BOARD 引导）→ §12.13 ✓
- 安全设定 → §12.14 ✓
- 环境变量 → §12.15 ✓
- 客户端模块结构更新 → §12.16 ✓
- 与 §7 集成点调整 → §12.17 ✓
- 免费档硬性限制 → §12.18 ✓
- 风险与待确认 → §12.19 ✓
- Supabase 方案对比 → §12.20 ✓
- **用户权限分层（董事会 + 合作者）→ §4.1 UserRole + §6 BoardPanel/RoleBadge + §12.4 users.role + §12.7.3 boardOnly + §12.9 /board/* + §12.10.6 cancelTask role + §12.12 双入口 + §12.14 角色权限校验 + §12.16 board.ts/permissions.ts + §12.21 权限分层矩阵** ✓
- 高层架构 + 后续拆分 → §9 ✓

**2. Placeholder scan:** §11 任务清单是高层任务（明确标注"待拆分为可执行步骤"），符合"先高层架构再拆分"的本次产出范围；具体可执行步骤将在后续客户端/后端实现计划中按 writing-plans 规范产出。§12 各小节均含具体 SQL/TS 代码、wrangler 配置、curl 命令。

**3. Type consistency:**
- `OrgUser` 在 §4.1、§5.1、§7.6、§12.8 一致使用 `{ prunUsername, companyCode, displayName, role }`（TS camelCase）；§12.4 SQL 用 `prun_username, company_code, display_name, role`（snake_case），通过 Worker 层转换对应
- `UserRole` 枚举值（BOARD / COLLABORATOR）在 §4.1 TS 类型、§12.4 SQL `CHECK (role IN ('BOARD','COLLABORATOR'))`、§12.7.3 boardOnly 中间件、§12.7.4 JWT payload、§12.10.6 cancelTask userRole 参数、§12.21.1 权限矩阵、§12.21.3 permissions.ts 中一致
- `OrgTask` 字段（`publisherUsername/claimerUsername/contractId/contractCreator` 等）在 §4.1（TS）、§3 状态机、§12.4 SQL（snake_case）、§12.10 Worker 代码中一致使用
- `TaskStatus` 枚举值（PUBLISHED / AWAITING_CONTRACT / IN_PROGRESS / COMPLETED / CANCELLED）在 §3、§4.1、§7.3、§8、§12.4 SQL CHECK 约束、§12.10.1 TASK_TRANSITIONS、§12.10.3 CONTRACT_STATUS_TO_TASK 中一致
- `TaskContractJson` 字段名与 `CONTGEN.vue` 第 29-39 行 `ContractJson` 完全对齐
- `sendTaskToContd` 与 CONTGEN `sendToContd` 行为一致（写入 `'contgen-output'` workspace + `showBuffer('CONTD')`）
- §12.10.1 `TASK_TRANSITIONS` 与 §3 状态机一致
- §12.10.3 `CONTRACT_STATUS_TO_TASK` 与 §7.3 状态映射一致
- §12.10.6 `cancelTask` 中 `isPublisher` 判定与 §12.21.1 权限矩阵"取消自己任务 ✓ / 取消任何任务仅 BOARD ✓"一致
- §12.16 客户端模块结构取代 §6 中的 Supabase 版本，与 §12.9 API 端点、§12.10 Worker 业务逻辑、§12.21 权限矩阵对应
- §12.17 调整项与 §7 原小节编号一致（§7.5 凭据存储删除、§7.6 userData 简化）
- §12.20 决策对比表与 §12.1-12.19 各小节描述一致
- §12.21 权限矩阵与 §12.9 端点鉴权列（JWT / JWT + boardOnly）一致；§12.21.5 审计 action 与 §12.10.6 cancelTask 审计调用一致
