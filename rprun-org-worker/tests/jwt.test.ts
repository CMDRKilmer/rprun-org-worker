// tests/jwt.test.ts
import { describe, it, expect } from 'vitest';
import { signJWT, verifyJWT } from '../src/utils/jwt';

describe('jwt', () => {
  it('signs and verifies a valid token', async () => {
    const token = await signJWT(
      { sub: 'u1', prun_username: 'alice', company_code: 'ALICE', role: 'COLLABORATOR' },
      'secret',
      60,
    );
    const payload = await verifyJWT(token, 'secret');
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('u1');
    expect(payload?.role).toBe('COLLABORATOR');
  });

  it('rejects token with wrong secret', async () => {
    const token = await signJWT(
      { sub: 'u1', prun_username: 'alice', company_code: 'ALICE', role: 'BOARD' },
      'secret',
      60,
    );
    const payload = await verifyJWT(token, 'wrong');
    expect(payload).toBeNull();
  });

  it('rejects expired token', async () => {
    const token = await signJWT(
      { sub: 'u1', prun_username: 'alice', company_code: 'ALICE', role: 'BOARD' },
      'secret',
      -10, // 已过期
    );
    const payload = await verifyJWT(token, 'secret');
    expect(payload).toBeNull();
  });

  it('rejects malformed token', async () => {
    const payload = await verifyJWT('not.a.jwt', 'secret');
    expect(payload).toBeNull();
  });
});
