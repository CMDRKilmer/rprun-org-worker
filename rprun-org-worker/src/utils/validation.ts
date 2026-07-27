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
  shipping: z.number().nonnegative().optional(),
  deadline: z.number().int().positive().optional(),
  items: z.array(contractItemSchema).min(1),
});

// 阶段 2：createTaskSchema 限制单 item（多 item 走 /listings 端点）。
// 注：item 字段仍保留为 array（兼容老数据），但新增任务必须 length === 1。
export const createTaskSchema = z.object({
  type: z.enum(['BUY', 'SELL', 'SHIP', 'LOAN']),
  contractJson: contractJsonSchema.refine(
    (cj) => cj.items.length === 1,
    { message: 'tasks require exactly 1 item; use POST /listings for multi-item listings' },
  ),
  expiresAt: z.string().datetime().optional(),
});

export const patchTaskSchema = z.object({
  contractJson: contractJsonSchema.optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const cancelTaskSchema = z.object({
  reason: z.string().max(512).optional(),
});

// 阶段 2：claimTask 不再支持 amount（裁剪接取走 /listings 端点）。
// 兼容旧客户端：仍允许传 amount 但 service 忽略，触发 deprecation（响应 metadata 提示）。
export const claimTaskSchema = z.object({
  amount: z.number().int().positive().nullable().optional(),
});

export const linkContractSchema = z.object({
  contractId: z.string().min(1).max(64),
  contractCreator: z.enum(['publisher', 'claimer']),
});

// 自动关联合同方案的 fingerprint 上报 schema。
// 形状与前端 ContractFingerprint（RUNCN/src/infrastructure/org-api/contract-link.ts）
// 完全一致——前端负责把 PrUnApi.Contract 投影成该形状，本服务做权威比对。
export const matchContractSchema = z.object({
  contractId: z.string().min(1).max(64),
  fingerprint: z.object({
    template: z.enum(['BUY', 'SELL', 'SHIP']),
    currency: z.string().min(1).max(8),
    items: z.array(contractItemSchema).min(1),
    location: z.string().max(64).optional(),
    origin: z.string().max(64).optional(),
    destination: z.string().max(64).optional(),
    price: z.number().nonnegative().optional(),
  }),
  // 可选：前端希望后端在匹配成功后自动调 link-contract；缺省 false，
  // 前端仍按原 link-contract 端点走（保持与既有流程一致，避免双重调用）。
  autoLink: z.boolean().optional(),
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

// ========== Listings schemas ==========

export const createListingSchema = z.object({
  type: z.enum(['BUY', 'SELL', 'SHIP']),
  commodity: z.string().min(1).max(32),
  amount: z.number().int().positive(),
  price: z.number().nonnegative(),
  currency: z.string().min(1).max(8),
  location: z.string().max(64).optional(),
  origin: z.string().max(64).optional(),
  destination: z.string().max(64).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const listListingsQuerySchema = z.object({
  commodity: z.string().min(1).max(32).optional(),
  type: z.enum(['BUY', 'SELL', 'SHIP']).optional(),
  scope: z.enum(['market', 'mine']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const claimListingSchema = z.object({
  amount: z.number().int().positive(),
});

export const cancelListingSchema = z.object({
  reason: z.string().max(512).optional(),
});
