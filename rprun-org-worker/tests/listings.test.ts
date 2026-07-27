// tests/listings.test.ts
// 解耦后 listings 端到端测试：发布挂单 / 浏览 / 接取 / 取消。
// 阶段 1：listings 全栈上线，前端不动；本测试验证 listings 模块独立可用。
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema, truncateAll, seedBoardUser } from './setup';
import { generateCodes } from '../src/services/invite-service';
import type { AuthSession, OrgListing, OrgTask } from '../src/types';

async function registerCollaborator(
  email: string,
  prunUsername: string,
  companyCode: string,
): Promise<string> {
  // 拿一个邀请码
  const board = await seedBoardUser(env, 'board@org.local');
  const codes = await generateCodes(env, 1, board.id, board.id);
  const inviteCode = codes[0].code;
  const reg = await SELF.fetch('http://localhost/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password: 'password123',
      inviteCode, prunUsername, companyCode,
    }),
  });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);
  const session = (await reg.json()) as AuthSession;
  return session.accessToken;
}

async function loginBoard(): Promise<string> {
  const res = await SELF.fetch('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'board@org.local', password: 'password123' }),
  });
  return ((await res.json()) as AuthSession).accessToken;
}

describe('ORG listings (阶段 1: 后端 listings 全栈)', () => {
  beforeAll(async () => {
    await applySchema(env);
  });
  beforeEach(async () => {
    await truncateAll(env);
  });

  it('发布 → 浏览 → 接取 → 扣 remaining_amount → 任务 AWAITING_CONTRACT', async () => {
    const boardToken = await registerCollaborator(
      'board@org.local', 'board_user', 'BRC',
    );
    // 重置 board 为 BOARD 角色（register 默认 COLLABORATOR）
    await env.DB.prepare(`UPDATE users SET role = 'BOARD' WHERE email = ?`)
      .bind('board@org.local').run();
    const boardAccess = await loginBoard();

    const colabAccess = await registerCollaborator(
      'colab@org.local', 'colab_user', 'CLB',
    );

    // 1. BOARD 发布挂单（amount=100, BUY）
    const createRes = await SELF.fetch('http://localhost/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${boardAccess}` },
      body: JSON.stringify({
        type: 'BUY',
        commodity: 'RAT',
        amount: 100,
        price: 50,
        currency: 'AIC',
        location: 'Antares',
      }),
    });
    expect(createRes.status).toBe(201);
    const listing = (await createRes.json()) as OrgListing;
    expect(listing.status).toBe('OPEN');
    expect(listing.remainingAmount).toBe(100);

    // 2. 浏览市场
    const listRes = await SELF.fetch('http://localhost/listings?commodity=RAT&type=BUY', {
      headers: { Authorization: `Bearer ${colabAccess}` },
    });
    expect(listRes.status).toBe(200);
    const { items } = (await listRes.json()) as { items: OrgListing[] };
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(listing.id);

    // 3. COLLABORATOR 接取 30
    const claimRes = await SELF.fetch(`http://localhost/listings/${listing.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${colabAccess}` },
      body: JSON.stringify({ amount: 30 }),
    });
    expect(claimRes.status).toBe(201);
    const claimResult = (await claimRes.json()) as { task: OrgTask; listing: OrgListing };
    expect(claimResult.task.status).toBe('AWAITING_CONTRACT');
    // 接取者创建反向合同 → 反向 type 是 SELL
    expect(claimResult.task.type).toBe('SELL');
    // listing 扣减
    expect(claimResult.listing.remainingAmount).toBe(70);
    expect(claimResult.listing.status).toBe('OPEN');

    // 4. 再接 70 → listing 关闭
    const claim2Res = await SELF.fetch(`http://localhost/listings/${listing.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${colabAccess}` },
      body: JSON.stringify({ amount: 70 }),
    });
    expect(claim2Res.status).toBe(201);
    const r2 = (await claim2Res.json()) as { task: OrgTask; listing: OrgListing };
    expect(r2.task.type).toBe('SELL');
    expect(r2.listing.remainingAmount).toBe(0);
    expect(r2.listing.status).toBe('CLOSED');

    // 5. 接取失败：listing 已关闭
    const claim3Res = await SELF.fetch(`http://localhost/listings/${listing.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${colabAccess}` },
      body: JSON.stringify({ amount: 10 }),
    });
    expect(claim3Res.status).toBe(400);

    // 验证：listings 端点不返回 CLOSED 的 listing（默认 scope=market）
    const listAfter = await SELF.fetch('http://localhost/listings?commodity=RAT', {
      headers: { Authorization: `Bearer ${colabAccess}` },
    });
    const { items: itemsAfter } = (await listAfter.json()) as { items: OrgListing[] };
    expect(itemsAfter).toHaveLength(0);

    // 但 scope=mine 仍能查到
    const listMine = await SELF.fetch('http://localhost/listings?scope=mine', {
      headers: { Authorization: `Bearer ${boardAccess}` },
    });
    const { items: itemsMine } = (await listMine.json()) as { items: OrgListing[] };
    expect(itemsMine).toHaveLength(1);
    expect(itemsMine[0].status).toBe('CLOSED');
  });

  it('不能接自己的挂单 (CANNOT_CLAIM_OWN)', async () => {
    await registerCollaborator('publisher@org.local', 'pub', 'PBR');
    const pubRes = await SELF.fetch('http://localhost/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'publisher@org.local', password: 'password123' }),
    });
    const pubToken = ((await pubRes.json()) as AuthSession).accessToken;

    const createRes = await SELF.fetch('http://localhost/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        type: 'SELL', commodity: 'FE', amount: 10, price: 100, currency: 'ICA', location: 'Antares',
      }),
    });
    const listing = (await createRes.json()) as OrgListing;

    const claimRes = await SELF.fetch(`http://localhost/listings/${listing.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({ amount: 5 }),
    });
    expect(claimRes.status).toBe(400);
    expect(((await claimRes.json()) as { error: { code: string } }).error.code).toBe('CANNOT_CLAIM_OWN');
  });

  it('接取量超过剩余 → 400 INVALID_CLAIM_AMOUNT', async () => {
    await registerCollaborator('pub@org.local', 'pub', 'PBR');
    await registerCollaborator('clb@org.local', 'clb', 'CLB');
    const pubToken = ((await SELF.fetch('http://localhost/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pub@org.local', password: 'password123' }),
    }).then(r => r.json())) as AuthSession).accessToken;
    const clbToken = ((await SELF.fetch('http://localhost/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'clb@org.local', password: 'password123' }),
    }).then(r => r.json())) as AuthSession).accessToken;

    const createRes = await SELF.fetch('http://localhost/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        type: 'SELL', commodity: 'FE', amount: 10, price: 100, currency: 'ICA', location: 'Antares',
      }),
    });
    const listing = (await createRes.json()) as OrgListing;

    const claimRes = await SELF.fetch(`http://localhost/listings/${listing.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clbToken}` },
      body: JSON.stringify({ amount: 100 }),
    });
    expect(claimRes.status).toBe(400);
    expect(((await claimRes.json()) as { error: { code: string } }).error.code).toBe('INVALID_CLAIM_AMOUNT');
  });

  it('SHIP 类型：接取者 type 不反转，contract_creator=publisher', async () => {
    await registerCollaborator('shipper@org.local', 'shipper', 'SHP');
    await registerCollaborator('carrier@org.local', 'carrier', 'CAR');
    const shipperToken = ((await SELF.fetch('http://localhost/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'shipper@org.local', password: 'password123' }),
    }).then(r => r.json())) as AuthSession).accessToken;
    const carrierToken = ((await SELF.fetch('http://localhost/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'carrier@org.local', password: 'password123' }),
    }).then(r => r.json())) as AuthSession).accessToken;

    const createRes = await SELF.fetch('http://localhost/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shipperToken}` },
      body: JSON.stringify({
        type: 'SHIP',
        commodity: 'RAT',
        amount: 50,
        price: 200,
        currency: 'ICA',
        origin: 'Antares',
        destination: 'Benten',
      }),
    });
    const listing = (await createRes.json()) as OrgListing;

    const claimRes = await SELF.fetch(`http://localhost/listings/${listing.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${carrierToken}` },
      body: JSON.stringify({ amount: 50 }),
    });
    expect(claimRes.status).toBe(201);
    const result = (await claimRes.json()) as { task: OrgTask; listing: OrgListing };
    expect(result.task.type).toBe('SHIP'); // 不反转
    expect(result.task.contractCreator).toBe('publisher'); // SHIP: 发布者创建合同
  });

  it('取消挂单：仅 publisher 可取消 OPEN 的挂单', async () => {
    await registerCollaborator('pub@org.local', 'pub', 'PBR');
    const pubToken = ((await SELF.fetch('http://localhost/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pub@org.local', password: 'password123' }),
    }).then(r => r.json())) as AuthSession).accessToken;

    const createRes = await SELF.fetch('http://localhost/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pubToken}` },
      body: JSON.stringify({
        type: 'BUY', commodity: 'RAT', amount: 10, price: 50, currency: 'AIC', location: 'Antares',
      }),
    });
    const listing = (await createRes.json()) as OrgListing;

    const cancelRes = await SELF.fetch(`http://localhost/listings/${listing.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pubToken}` },
    });
    expect(cancelRes.status).toBe(200);
    const cancelled = (await cancelRes.json()) as OrgListing;
    expect(cancelled.status).toBe('CANCELLED');

    // 取消后的挂单不能再接取
    await registerCollaborator('clb@org.local', 'clb', 'CLB');
    const clbToken = ((await SELF.fetch('http://localhost/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'clb@org.local', password: 'password123' }),
    }).then(r => r.json())) as AuthSession).accessToken;
    const claimRes = await SELF.fetch(`http://localhost/listings/${listing.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clbToken}` },
      body: JSON.stringify({ amount: 5 }),
    });
    expect(claimRes.status).toBe(400);
  });
});