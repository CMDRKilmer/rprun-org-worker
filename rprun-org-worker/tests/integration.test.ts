// tests/integration.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema, truncateAll, seedBoardUser } from './setup';
import { generateCodes } from '../src/services/invite-service';
import type { AuthSession, OrgTask } from '../src/types';

describe('ORG backend integration', () => {
  // v0.13+ 存储隔离按测试文件级别（per-test-file），所有测试共享同一个 D1
  // 只在 beforeAll 中应用一次 schema；beforeEach 只清空数据
  beforeAll(async () => {
    await applySchema(env);
  });

  beforeEach(async () => {
    await truncateAll(env);
  });

  it('full happy path: register → login → publish → claim → link → sync → complete', async () => {
    // 1. 引导一个 BOARD 用户
    const board = await seedBoardUser(env, 'board@org.local');

    // 2. BOARD 生成邀请码
    //    service 签名：generateCodes(env, count, createdBy, actorUserId)
    const codes = await generateCodes(env, 1, board.id, board.id);
    expect(codes).toHaveLength(1);
    const inviteCode = codes[0].code;

    // 3. 用邀请码注册一个 COLLABORATOR
    const registerRes = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'colab@org.local',
        password: 'password123',
        inviteCode,
        prunUsername: 'colab_user',
        companyCode: 'CLB',
      }),
    });
    expect(registerRes.status).toBe(201);
    const session = (await registerRes.json()) as AuthSession;
    expect(session.user.role).toBe('COLLABORATOR');
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    const colabAccessToken = session.accessToken;

    // 4. BOARD 登录拿 token，由 BOARD 发布任务（避免 COLLABORATOR 自发自接触发 CANNOT_CLAIM_OWN）
    const boardLoginRes = await SELF.fetch('http://localhost/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'board@org.local', password: 'password123' }),
    });
    expect(boardLoginRes.status).toBe(200);
    const boardAccessToken = ((await boardLoginRes.json()) as AuthSession).accessToken;

    // 5. BOARD 发布任务
    const createRes = await SELF.fetch('http://localhost/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${boardAccessToken}` },
      body: JSON.stringify({
        type: 'BUY',
        contractJson: {
          template: 'BUY',
          currency: 'AIC',
          name: 'Test Buy',
          location: 'Antares',
          items: [{ commodity: 'RAT', amount: 100, price: 50 }],
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as OrgTask;
    expect(task.status).toBe('PUBLISHED');
    const taskId = task.id;

    // 6. COLLABORATOR 接取任务
    const claimRes = await SELF.fetch(`http://localhost/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${colabAccessToken}` },
    });
    expect(claimRes.status).toBe(200);
    const claimed = (await claimRes.json()) as OrgTask;
    expect(claimed.status).toBe('AWAITING_CONTRACT');
    expect(claimed.claimerId).toBe(session.user.id);

    // 7. link-contract（不改变状态）
    const linkRes = await SELF.fetch(`http://localhost/tasks/${taskId}/link-contract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${colabAccessToken}` },
      body: JSON.stringify({ contractId: 'c-123', contractCreator: 'claimer' }),
    });
    expect(linkRes.status).toBe(200);
    const linked = (await linkRes.json()) as OrgTask;
    expect(linked.status).toBe('AWAITING_CONTRACT');
    expect(linked.contractId).toBe('c-123');

    // 8. sync-status: CLOSED → IN_PROGRESS
    const sync1Res = await SELF.fetch(`http://localhost/tasks/${taskId}/sync-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${colabAccessToken}` },
      body: JSON.stringify({ contractStatus: 'CLOSED' }),
    });
    expect(sync1Res.status).toBe(200);
    expect(((await sync1Res.json()) as OrgTask).status).toBe('IN_PROGRESS');

    // 9. sync-status: FULFILLED → COMPLETED
    const sync2Res = await SELF.fetch(`http://localhost/tasks/${taskId}/sync-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${colabAccessToken}` },
      body: JSON.stringify({ contractStatus: 'FULFILLED' }),
    });
    expect(sync2Res.status).toBe(200);
    expect(((await sync2Res.json()) as OrgTask).status).toBe('COMPLETED');
  });

  it('non-board user gets 403 on /board/*', async () => {
    const board = await seedBoardUser(env, 'board@org.local');
    const codes = await generateCodes(env, 1, board.id, board.id);
    const inviteCode = codes[0].code;

    // 注册 COLLABORATOR
    const reg = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'colab@org.local', password: 'password123',
        inviteCode, prunUsername: 'colab', companyCode: 'CLB',
      }),
    });
    const { accessToken } = (await reg.json()) as AuthSession;

    // COLLABORATOR 访问 /board/users → 403
    const res = await SELF.fetch('http://localhost/board/users', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('cannot claim own published task', async () => {
    const board = await seedBoardUser(env, 'board@org.local');
    // 直接用 BOARD 登录拿 token（BOARD 也能发布任务）
    const loginRes = await SELF.fetch('http://localhost/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'board@org.local', password: 'password123' }),
    });
    const { accessToken } = (await loginRes.json()) as AuthSession;

    const createRes = await SELF.fetch('http://localhost/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        type: 'SELL',
        contractJson: { template: 'SELL', currency: 'AIC', items: [{ commodity: 'RAT', amount: 10 }] },
      }),
    });
    const taskId = ((await createRes.json()) as OrgTask).id;

    // 接自己的任务 → 400
    const claimRes = await SELF.fetch(`http://localhost/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(claimRes.status).toBe(400);
    expect(((await claimRes.json()) as { error: { code: string } }).error.code).toBe('CANNOT_CLAIM_OWN');
  });

  it('board cannot demote self', async () => {
    const board = await seedBoardUser(env, 'board@org.local');
    const loginRes = await SELF.fetch('http://localhost/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'board@org.local', password: 'password123' }),
    });
    const { accessToken } = (await loginRes.json()) as AuthSession;

    const res = await SELF.fetch(`http://localhost/board/users/${board.id}/demote`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CANNOT_DEMOTE_SELF');
  });

  it('refresh token rotation: old token invalid after refresh', async () => {
    const board = await seedBoardUser(env, 'board@org.local');
    const codes = await generateCodes(env, 1, board.id, board.id);
    const reg = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'x@org.local', password: 'password123',
        inviteCode: codes[0].code, prunUsername: 'x', companyCode: 'X',
      }),
    });
    const session = (await reg.json()) as AuthSession;
    const oldRefresh = session.refreshToken;

    // 续期
    const refreshRes = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: oldRefresh }),
    });
    expect(refreshRes.status).toBe(200);
    const newSession = (await refreshRes.json()) as AuthSession;
    expect(newSession.refreshToken).not.toBe(oldRefresh);

    // 旧 token 已失效
    const retry = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: oldRefresh }),
    });
    expect(retry.status).toBe(401);
  });

  it('rate limit: 6th register within 1 hour → 429', async () => {
    // 架构 §12.9：register 限流 5/小时。第 6 次必然触发 429。
    // 即使 body 校验失败也会消耗桶（rateLimit 中间件先于 body 解析）。
    // inviteCode 用 'DOESNOTEXS'（10 字符，符合 ^[A-Z2-7]{10}$），
    // 但 body 校验在限流之后，所以不影响 429 触发。
    for (let i = 0; i < 5; i++) {
      await SELF.fetch('http://localhost/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `x${i}@x`, password: 'p', inviteCode: 'DOESNOTEXS', prunUsername: 'u', companyCode: 'C' }),
      });
    }
    const res = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x5@x', password: 'p', inviteCode: 'DOESNOTEXS', prunUsername: 'u', companyCode: 'C' }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });

  it('invalid invite code → 400 INVITE_INVALID', async () => {
    // inviteCode 必须先通过 schema ^[A-Z2-9]{10}$ 校验，才能进入 service 层做"是否存在"检查
    // 'DOESNOTEXS' 正好 10 字符且全部在 [A-Z2-9] 范围内（D O E S N O T E X S）
    // 注：email 用合法格式 'x@x.com'，因为 Zod 3.23+ 的 .email() 校验要求域名含点
    const res = await SELF.fetch('http://localhost/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'x@x.com', password: 'password123',
        inviteCode: 'DOESNOTEXS', prunUsername: 'x', companyCode: 'X',
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVITE_INVALID');
  });
});
