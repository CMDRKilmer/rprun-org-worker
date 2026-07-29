// src/services/listing-service.ts
// 市场挂单业务服务：发布 / 列表 / 接取 / 取消。
// 接取（claim）的事务里同时创建 task + 扣 listing.remaining_amount + 更新 listing.status。
import type { Env } from '../config';
import type {
  OrgListing, OrgTask, ListingType, ListingStatus, ContractCreator,
} from '../types';
import { badRequest, forbidden, notFound, HttpError } from '../utils/http-error';
import {
  createListing as repoCreateListing,
  findListingById,
  listOpenListings,
  listListingsByPublisher,
  claimFromListing,
  cancelListing,
  restoreListingAmount,
  nextClaimSeq,
} from '../db/repositories/listings.repo';
import { findTaskRowById } from '../db/repositories/tasks.repo';
import { writeAuditLog } from '../db/repositories/audit-logs.repo';
import { mapTask } from '../db/mappers';

export interface CreateListingParams {
  type: ListingType;
  commodity: string;
  amount: number;
  price: number;
  currency: string;
  location?: string;
  origin?: string;
  destination?: string;
  expiresAt?: string;
}

export async function createListing(
  env: Env,
  userId: string,
  prunUsername: string,
  companyCode: string,
  params: CreateListingParams,
): Promise<OrgListing> {
  if (params.amount <= 0 || !Number.isInteger(params.amount)) {
    throw badRequest('INVALID_AMOUNT', 'amount must be a positive integer');
  }
  if (params.price < 0 || !Number.isFinite(params.price)) {
    throw badRequest('INVALID_PRICE', 'price must be a non-negative number');
  }
  if (params.type === 'SHIP') {
    if (!params.origin || !params.destination) {
      throw badRequest('MISSING_ROUTE', 'SHIP listing requires origin and destination');
    }
    if (params.origin === params.destination) {
      throw badRequest('INVALID_ROUTE', 'origin and destination must differ');
    }
  } else {
    if (!params.location) {
      throw badRequest('MISSING_LOCATION', 'BUY/SELL listing requires location');
    }
  }

  const listing = await repoCreateListing(env.DB, {
    type: params.type,
    commodity: params.commodity.toUpperCase(),
    amount: params.amount,
    price: params.price,
    currency: params.currency,
    location: params.location,
    origin: params.origin,
    destination: params.destination,
    publisherId: userId,
    publisherUsername: prunUsername,
    publisherCompanyCode: companyCode,
    expiresAt: params.expiresAt,
  });

  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'listing.create',
    targetType: 'listing',
    targetId: listing.id,
    metadata: { type: listing.type, commodity: listing.commodity, amount: listing.amount },
  });

  return listing;
}

export async function listListings(
  env: Env,
  opts: {
    commodity?: string;
    type?: ListingType;
    publisherId?: string;
    limit?: number;
  },
): Promise<{ items: OrgListing[] }> {
  if (opts.publisherId) {
    const items = await listListingsByPublisher(env.DB, opts.publisherId);
    return { items };
  }
  const items = await listOpenListings(env.DB, {
    commodity: opts.commodity,
    type: opts.type,
    limit: opts.limit,
  });
  return { items };
}

export async function findListingForUser(
  env: Env,
  listingId: string,
): Promise<OrgListing> {
  const listing = await findListingById(env.DB, listingId);
  if (!listing) throw notFound('Listing not found');
  return listing;
}

export async function cancelListingForPublisher(
  env: Env,
  listingId: string,
  userId: string,
): Promise<OrgListing> {
  const existing = await findListingById(env.DB, listingId);
  if (!existing) throw notFound('Listing not found');
  if (existing.publisherId !== userId) {
    throw forbidden('Only the publisher can cancel the listing');
  }
  if (existing.status !== 'OPEN') {
    throw badRequest('INVALID_TRANSITION', `Cannot cancel listing in ${existing.status} state`);
  }
  const cancelled = await cancelListing(env.DB, listingId, userId);
  if (!cancelled) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Cancel listing failed');
  }
  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'listing.cancel',
    targetType: 'listing',
    targetId: listingId,
    metadata: { remaining_amount: cancelled.remainingAmount },
  });
  return cancelled;
}

export interface ClaimListingResult {
  task: OrgTask;
  listing: OrgListing;
}

/**
 * 接取挂单：在一个事务内做两件事：
 *   1. 扣 listing.remaining_amount（可能关闭 listing）
 *   2. 创建一个独立 task（AWAITING_CONTRACT，listing_id + claim_seq 已设）
 *
 * 反向合同创建方：
 *   接取者创建反向合同 → contract_creator = 'claimer'
 *   SHIP 任务特殊：发布者创建合同（SHIP 不涉及反向） → contract_creator = 'publisher'
 *
 * task type 反转：
 *   listing BUY → 接取者买 → task SELL（接取者卖出货物）
 *   listing SELL → 接取者卖 → task BUY（接取者买入货物）
 *   listing SHIP → task SHIP
 *
 * 注意：D1 的单条 SQL 是原子的；但跨 statements 的事务需要 db.batch
 * （D1 在 batch 内是顺序执行，任一失败会终止后续）。
 */
export async function claimListing(
  env: Env,
  listingId: string,
  userId: string,
  prunUsername: string,
  companyCode: string,
  amount: number,
): Promise<ClaimListingResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw badRequest('INVALID_CLAIM_AMOUNT', 'amount must be a positive integer');
  }

  const listing = await findListingById(env.DB, listingId);
  if (!listing) throw notFound('Listing not found');
  if (listing.status !== 'OPEN') {
    throw badRequest('INVALID_TRANSITION', `Cannot claim listing in ${listing.status} state`);
  }
  if (listing.publisherId === userId) {
    throw badRequest('CANNOT_CLAIM_OWN', 'Cannot claim your own listing');
  }
  if (amount > listing.remainingAmount) {
    throw badRequest(
      'INVALID_CLAIM_AMOUNT',
      `amount ${amount} exceeds listing remaining ${listing.remainingAmount}`,
    );
  }

  // 反转 type：listing BUY → 接取者创建 SELL task；listing SELL → 接取者创建 BUY task；SHIP 保持
  const reverseType: 'BUY' | 'SELL' | 'SHIP' =
    listing.type === 'BUY' ? 'SELL'
    : listing.type === 'SELL' ? 'BUY'
    : 'SHIP';
  const contractCreator: ContractCreator = listing.type === 'SHIP' ? 'publisher' : 'claimer';

  // task 的 contractJson：单 item = listing 的 commodity/amount/price；其他字段按 type 透传。
  // 市场合同默认 7 天限期：接取者必须在 7 天内完成 PrUn 合同签订与交付。
  // 该 deadline 字段进入 contract_json，对接取者在 PrUn 签合同时作为期限参考。
  const taskContractJson = {
    template: reverseType,
    currency: listing.currency,
    location: listing.location,
    origin: listing.origin,
    destination: listing.destination,
    deadline: 7,
    items: [{ commodity: listing.commodity, amount, price: listing.price }],
  };

  // 用 db.batch 保证 listing 扣减 + task 创建的串行原子性。
  const seq = await nextClaimSeq(env.DB, listingId);
  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  const newRemaining = listing.remainingAmount - amount;
  const newStatus: ListingStatus = newRemaining === 0 ? 'CLOSED' : 'OPEN';

  const statements = [
    env.DB
      .prepare(`UPDATE listings SET remaining_amount = ?, status = ? WHERE id = ? AND status = 'OPEN'`)
      .bind(newRemaining, newStatus, listingId),
    env.DB
      .prepare(
        `INSERT INTO tasks (
          id, type, contract_json, status,
          publisher_id, publisher_username, publisher_company_code,
          claimer_id, claimer_username, claimer_company_code,
          contract_creator, listing_id, claim_seq,
          claimed_at, created_at, published_at, updated_at
        ) VALUES (
          ?, ?, ?, 'AWAITING_CONTRACT',
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?
        )`,
      )
      .bind(
        taskId,
        reverseType,
        JSON.stringify(taskContractJson),
        // publisher = listing 发布者（原挂单方）
        // claimer = 接取者（反向合同的发布者）
        // contract_creator = 谁去 PrUn 签反向合同（默认 'claimer'，SHIP 为 'publisher'）
        listing.publisherId,
        listing.publisherUsername,
        listing.publisherCompanyCode,
        userId,
        prunUsername,
        companyCode,
        contractCreator,
        listingId,
        seq,
        now,
        now,
        now,
        now,
      ),
  ];
  await env.DB.batch(statements);

  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'listing.claim',
    targetType: 'listing',
    targetId: listingId,
    metadata: {
      claim_amount: amount,
      task_id: taskId,
      claim_seq: seq,
      contract_creator: contractCreator,
    },
  });

  const updatedListing = await findListingById(env.DB, listingId);
  const taskRow = await findTaskRowById(env.DB, taskId);
  if (!updatedListing || !taskRow) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Listing or task vanished after claim');
  }
  return { task: mapTask(taskRow), listing: updatedListing };
}

/**
 * 释放挂单接取：恢复 listing.remaining_amount + 物理删除 task（AWAITING_CONTRACT）。
 * 只有"老 release 没接 listing_id 路径"的副作用修复。物理删除 task 是因为：
 *   - claimListing 在事务里创建 task，releaseListingClaim 也在事务里删 task；
 *   - 任何后续的 linkContract 都不允许（task 不存在 = 不能关联合同）。
 *
 * 约束：当前用户必须是 task.claimer_id；task.listing_id 必须存在（这是新架构 task）。
 *
 * 返回：被删除的 task（已在 DB 中删除，返回最后一次快照）。
 */
export async function releaseListingClaim(
  env: Env,
  taskId: string,
  userId: string,
): Promise<{ task: OrgTask; listing: OrgListing | null }> {
  const row = await findTaskRowById(env.DB, taskId);
  if (!row) throw notFound('Task not found');
  if (row.claimer_id !== userId) {
    throw forbidden('Only the claimer can release');
  }
  if (row.status !== 'AWAITING_CONTRACT') {
    throw badRequest(
      'INVALID_TRANSITION',
      `Cannot release from ${row.status} state; release only allowed in AWAITING_CONTRACT`,
    );
  }
  if (!row.listing_id) {
    throw badRequest(
      'NOT_LISTING_TASK',
      'Task is not backed by a listing; use /tasks/:id/release instead',
    );
  }
  if (row.contract_id) {
    throw badRequest(
      'CONTRACT_LINKED',
      'Task already has a contract linked; unlink before release',
    );
  }

  // task.contract_json.items[0].amount 即本次接取量
  let claimAmount = 0;
  try {
    const cj = JSON.parse(row.contract_json);
    claimAmount = cj?.items?.[0]?.amount ?? 0;
  } catch {
    // contract_json 损坏——按 0 处理，但仍然只删 task；listing 不动
  }
  if (claimAmount <= 0) {
    // 异常分支：仅删 task，不动 listing，避免悬挂
    await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(taskId).run();
    return { task: mapTask(row), listing: null };
  }

  // 事务式：先恢复 listing.remaining_amount，再删 task
  // 若删 task 失败，listing 已恢复（接取者可以重试 release 或走老 releaseTask 把 task 置 PUBLISHED）
  const restoredListing = await restoreListingAmount(env.DB, row.listing_id, claimAmount);
  await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(taskId).run();

  await writeAuditLog(env.DB, {
    actorType: 'user',
    actorId: userId,
    action: 'listing.release',
    targetType: 'task',
    targetId: taskId,
    metadata: {
      listing_id: row.listing_id,
      restored_amount: claimAmount,
    },
  });

  return { task: mapTask(row), listing: restoredListing };
}