// src/types.ts
// 与 rprun 扩展 src/infrastructure/org-api/types.ts 人工同步。
// 修改任一处都必须同步另一处。

export type UserRole = 'BOARD' | 'COLLABORATOR' | 'NON_ORG';
export type TaskType = 'BUY' | 'SELL' | 'SHIP' | 'LOAN';
export type TaskStatus = 'PUBLISHED' | 'AWAITING_CONTRACT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type ContractCreator = 'publisher' | 'claimer';

export interface OrgUser {
  id: string;
  email: string;
  prunUsername: string;
  companyCode: string;
  displayName: string;
  role: RegisteredUserRole;
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
  // 运费：与 price 平级，独立于"货物总价"。publisher 发布任务时声明，
  // 接取者在创建合同时把它叠加进合同总金额。存于 contract_json JSON 列。
  shipping?: number;
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
  role: RegisteredUserRole;
  iat: number;
  exp: number;
}

// 注册用户角色（authMiddleware 注入的角色）
export type RegisteredUserRole = 'BOARD' | 'COLLABORATOR';

// Hono Context variables（authMiddleware 注入）
export interface ContextVars {
  user: {
    sub: string;
    prun_username: string;
    company_code: string;
    role: RegisteredUserRole;
  };
  // 便捷字段：等价于 user.sub，路由层直接 c.var.userId 取用
  userId: string;
  prunUsername: string;
  companyCode: string;
  role: RegisteredUserRole;
}
