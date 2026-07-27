// src/routes/listings.ts
// 市场挂单路由（与任务解耦）：发布 / 浏览 / 接取 / 取消。
// 接取接口在事务里同时创建 task + 扣 listing.remaining_amount；
// task 仍是合同载体（task.contract_id 关联到 PrUn 合同）。
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../config';
import type { ContextVars } from '../types';
import { authMiddleware } from '../middleware/jwt';
import {
  createListingSchema,
  listListingsQuerySchema,
  claimListingSchema,
  cancelListingSchema,
} from '../utils/validation';
import { apiError } from '../utils/http-error';
import {
  createListing,
  listListings,
  findListingForUser,
  cancelListingForPublisher,
  claimListing,
} from '../services/listing-service';

const listings = new Hono<{ Bindings: Env; Variables: ContextVars }>();

// 全部 /listings/* 路由需要登录
listings.use('*', authMiddleware);

// GET /listings
//   query: ?commodity=FE&type=BUY&scope=market|mine&limit=200
//   - scope=market（默认）：公开市场（status=OPEN 的所有挂单）
//   - scope=mine：我发布的挂单（含 OPEN/CLOSED/CANCELLED）
listings.get('/', async (c) => {
  const query = Object.fromEntries(new URLSearchParams(c.req.query()));
  const parsed = listListingsQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const opts: Parameters<typeof listListings>[1] = {
    limit: parsed.data.limit,
  };
  if (parsed.data.commodity) opts.commodity = parsed.data.commodity;
  if (parsed.data.type) opts.type = parsed.data.type;
  if (parsed.data.scope === 'mine') opts.publisherId = c.var.userId;
  const result = await listListings(c.env, opts);
  return c.json(result, 200 as ContentfulStatusCode);
});

// GET /listings/:id
listings.get('/:id', async (c) => {
  const listing = await findListingForUser(c.env, c.req.param('id'));
  return c.json(listing, 200 as ContentfulStatusCode);
});

// POST /listings
listings.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createListingSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const listing = await createListing(
    c.env,
    c.var.userId,
    c.var.prunUsername,
    c.var.companyCode,
    parsed.data,
  );
  return c.json(listing, 201 as ContentfulStatusCode);
});

// POST /listings/:id/claim
// body: { amount }
//   在事务里扣 listing.remaining_amount + 创建 task（AWAITING_CONTRACT）。
//   task 关联到 listing（task.listing_id = listing.id）；自动合同关联链路不变。
listings.post('/:id/claim', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = claimListingSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const result = await claimListing(
    c.env,
    c.req.param('id'),
    c.var.userId,
    c.var.prunUsername,
    c.var.companyCode,
    parsed.data.amount,
  );
  return c.json(result, 201 as ContentfulStatusCode);
});

// POST /listings/:id/cancel
//   仅 publisher 可取消自己发布的 OPEN 挂单。
listings.post('/:id/cancel', async (c) => {
  // body 可选 reason（暂未持久化，预留扩展）
  await c.req.json().catch(() => ({}));
  const parsed = cancelListingSchema.safeParse({});
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const listing = await cancelListingForPublisher(
    c.env,
    c.req.param('id'),
    c.var.userId,
  );
  return c.json(listing, 200 as ContentfulStatusCode);
});

export default listings;