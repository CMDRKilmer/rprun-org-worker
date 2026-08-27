// src/routes/chain-sync.ts
// 环线多端同步路由（XIT FLEET 产业链）：按船存储。
// 命名空间 = company_code（来自 JWT）；每条记录 = 一艘船的环线快照
// （'__config__' 为环线面板全局配置）。船之间互不覆盖。
// 推送带 baseUpdatedAt 乐观锁：库内该船已有更新时返回 409 + 最新快照。
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../config';
import type { ContextVars } from '../types';
import { authMiddleware } from '../middleware/jwt';
import { chainSyncPutSchema } from '../utils/validation';
import { apiError } from '../utils/http-error';
import {
  getChainSync,
  listChainSync,
  putChainSync,
} from '../db/repositories/chain-sync.repo';

const chainSync = new Hono<{ Bindings: Env; Variables: ContextVars }>();

// 全部 /chain-sync/* 路由都需要登录
chainSync.use('*', authMiddleware);

// GET /chain-sync → 当前公司全部船的环线快照数组
chainSync.get('/', async (c) => {
  const rows = await listChainSync(c.env.DB, c.var.companyCode);
  const items = rows.map((row) => {
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = null;
    }
    return {
      shipId: row.ship_id,
      payload,
      payloadVersion: row.payload_version,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  });
  return c.json({ items }, 200 as ContentfulStatusCode);
});

// GET /chain-sync/single?ship={id} → 单船快照；无记录 204
chainSync.get('/single', async (c) => {
  const shipId = c.req.query('ship') ?? '';
  if (!shipId) {
    throw apiError('VALIDATION_ERROR', 'Missing ship query param', 400);
  }
  const row = await getChainSync(c.env.DB, c.var.companyCode, shipId);
  if (!row) {
    return c.body(null, 204 as ContentfulStatusCode);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    throw apiError('INVALID_DATA', 'Stored chain sync payload is corrupt', 500);
  }
  return c.json(
    {
      shipId: row.ship_id,
      payload,
      payloadVersion: row.payload_version,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    },
    200 as ContentfulStatusCode,
  );
});

// PUT /chain-sync
// body: { shipId, payload, payloadVersion?, baseUpdatedAt }
//   shipId：实际船 id 或 '__config__'。
//   baseUpdatedAt：客户端最近一次 GET 到该船的 updatedAt；乐观锁基准。
// 返回：200 { updatedAt } | 409 { error, latest }（latest 为该船最新快照供合并）。
chainSync.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = chainSyncPutSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const { shipId, payload, payloadVersion, baseUpdatedAt } = parsed.data;
  const now = Date.now();
  const ok = await putChainSync(
    c.env.DB,
    c.var.companyCode,
    shipId,
    JSON.stringify(payload),
    payloadVersion ?? 1,
    baseUpdatedAt,
    c.var.prunUsername,
    now,
  );
  if (!ok) {
    // 冲突：该船在库内已有更新。返回最新快照，前端重新合并后再推。
    const row = await getChainSync(c.env.DB, c.var.companyCode, shipId);
    let latest: unknown = null;
    if (row) {
      try {
        latest = JSON.parse(row.payload);
      } catch {
        latest = null;
      }
    }
    return c.json(
      {
        error: { code: 'CONFLICT', message: 'Chain sync has newer data' },
        latest:
          latest === null
            ? null
            : {
                shipId: row!.ship_id,
                payload: latest,
                updatedAt: row!.updated_at,
                updatedBy: row!.updated_by,
              },
      },
      409 as ContentfulStatusCode,
    );
  }
  return c.json({ updatedAt: now }, 200 as ContentfulStatusCode);
});

export default chainSync;
