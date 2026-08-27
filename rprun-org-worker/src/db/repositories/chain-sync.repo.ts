// src/db/repositories/chain-sync.repo.ts
// 环线多端同步仓储：按 (company_code, ship_id) 存储每艘船的环线快照，
// 互不覆盖；'__config__' 为特殊 ship_id，存环线面板全局配置。
// 写操作用「UPSERT + WHERE 条件」实现原子乐观锁（CAS）：
//   单条 SQL 在 D1 上原子执行，冲突判断与写入不分离，无并发竞态窗口。
import type { D1Database } from '@cloudflare/workers-types';

export interface ChainSyncRow {
  company_code: string;
  ship_id: string;
  payload: string;
  payload_version: number;
  updated_at: number;
  updated_by: string;
}

// 列出该公司全部船的环线快照（含 '__config__'）。
export async function listChainSync(db: D1Database, companyCode: string): Promise<ChainSyncRow[]> {
  const result = await db
    .prepare('SELECT * FROM chain_sync WHERE company_code = ?')
    .bind(companyCode)
    .all<ChainSyncRow>();
  return result.results ?? [];
}

// 读单船快照：无记录返回 null
export async function getChainSync(
  db: D1Database,
  companyCode: string,
  shipId: string,
): Promise<ChainSyncRow | null> {
  const row = await db
    .prepare('SELECT * FROM chain_sync WHERE company_code = ? AND ship_id = ?')
    .bind(companyCode, shipId)
    .first<ChainSyncRow>();
  return row ?? null;
}

// 写（UPSERT + 乐观锁，按船）：
// - 无记录：INSERT 分支直接成功（changes = 1）。
// - 有记录且 updated_at <= baseUpdatedAt：DO UPDATE 覆盖（changes = 1）。
// - 有记录且 updated_at > baseUpdatedAt：WHERE 条件不成立，整条语句 0 行
//   （changes = 0）→ 冲突，路由层据此返回 409 + 该船最新快照。
export async function putChainSync(
  db: D1Database,
  companyCode: string,
  shipId: string,
  payload: string,
  payloadVersion: number,
  baseUpdatedAt: number,
  updatedBy: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO chain_sync (company_code, ship_id, payload, payload_version, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_code, ship_id) DO UPDATE SET
         payload = excluded.payload,
         payload_version = excluded.payload_version,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by
       WHERE chain_sync.updated_at <= ?`,
    )
    .bind(companyCode, shipId, payload, payloadVersion, now, updatedBy, baseUpdatedAt)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
