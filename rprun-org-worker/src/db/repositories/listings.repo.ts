// src/db/repositories/listings.repo.ts
// 市场挂单：与任务解耦，只挂一个商品。
// 每被接取一次：扣 remaining_amount + 创建独立 task（不在本 repo 处理）。
import type { D1Database } from '@cloudflare/workers-types';
import { mapListing, type ListingRow } from '../mappers';
import type { OrgListing, ListingType, ListingStatus } from '../../types';
import { generateId } from '../../utils/id';

export interface CreateListingInput {
  type: ListingType;
  commodity: string;
  amount: number;
  price: number;
  currency: string;
  location?: string;
  origin?: string;
  destination?: string;
  publisherId: string;
  publisherUsername: string;
  publisherCompanyCode: string;
  expiresAt?: string;
}

export async function createListing(
  db: D1Database,
  input: CreateListingInput,
): Promise<OrgListing> {
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO listings (
        id, type, commodity, amount, remaining_amount, price, currency,
        location, origin, destination,
        publisher_id, publisher_username, publisher_company_code,
        expires_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
    )
    .bind(
      id,
      input.type,
      input.commodity,
      input.amount,
      input.amount, // remaining_amount = amount
      input.price,
      input.currency,
      input.location ?? null,
      input.origin ?? null,
      input.destination ?? null,
      input.publisherId,
      input.publisherUsername,
      input.publisherCompanyCode,
      input.expiresAt ?? null,
    )
    .run();
  const created = await findListingById(db, id);
  if (!created) throw new Error('LISTING_CREATE_FAILED');
  return created;
}

export async function findListingById(db: D1Database, id: string): Promise<OrgListing | null> {
  const row = await db.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first<ListingRow>();
  return row ? mapListing(row) : null;
}

export async function listOpenListings(db: D1Database, opts?: {
  commodity?: string;
  type?: ListingType;
  limit?: number;
}): Promise<OrgListing[]> {
  const where: string[] = ["status = 'OPEN'"];
  const binds: unknown[] = [];
  if (opts?.commodity) {
    where.push('commodity = ?');
    binds.push(opts.commodity);
  }
  if (opts?.type) {
    where.push('type = ?');
    binds.push(opts.type);
  }
  const limit = opts?.limit ?? 200;
  binds.push(limit);
  const sql = `SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...binds).all<ListingRow>();
  return (result.results ?? []).map(mapListing);
}

export async function listListingsByPublisher(
  db: D1Database,
  publisherId: string,
): Promise<OrgListing[]> {
  const result = await db
    .prepare(`SELECT * FROM listings WHERE publisher_id = ? ORDER BY created_at DESC LIMIT 200`)
    .bind(publisherId)
    .all<ListingRow>();
  return (result.results ?? []).map(mapListing);
}

/**
 * 接取后扣减 remaining_amount。
 * 返回更新后的 listing；若 status 已是终态则返回 null。
 *
 * 注意：调用方需在事务内串行调用 createListingClaimTask → 本函数，
 * 以保证"创建 task + 扣减 listing"的原子性。
 */
export async function claimFromListing(
  db: D1Database,
  listingId: string,
  claimAmount: number,
): Promise<OrgListing | null> {
  // 先取出当前快照（简化版并发控制：依赖 D1 单写串行）
  const row = await db
    .prepare(`SELECT remaining_amount, status FROM listings WHERE id = ?`)
    .bind(listingId)
    .first<{ remaining_amount: number; status: ListingStatus }>();
  if (!row) return null;
  if (row.status !== 'OPEN') return null;
  if (claimAmount <= 0 || claimAmount > row.remaining_amount) return null;

  const newRemaining = row.remaining_amount - claimAmount;
  const newStatus: ListingStatus = newRemaining === 0 ? 'CLOSED' : 'OPEN';

  await db
    .prepare(`UPDATE listings SET remaining_amount = ?, status = ? WHERE id = ?`)
    .bind(newRemaining, newStatus, listingId)
    .run();

  return findListingById(db, listingId);
}

export async function cancelListing(db: D1Database, listingId: string, publisherId: string): Promise<OrgListing | null> {
  const result = await db
    .prepare(`UPDATE listings SET status = 'CANCELLED' WHERE id = ? AND publisher_id = ? AND status = 'OPEN'`)
    .bind(listingId, publisherId)
    .run();
  if (!result.meta || result.meta.changes === 0) return null;
  return findListingById(db, listingId);
}

/**
 * 同一挂单下一次接取的 seq 序号。
 * 调用方：createListingClaimTask 内部。
 */
export async function nextClaimSeq(db: D1Database, listingId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM tasks WHERE listing_id = ?`)
    .bind(listingId)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) + 1;
}