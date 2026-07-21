// tests/password.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password';

describe('password', () => {
  it('hashes and verifies correct password', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('hunter2', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('hunter2');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces different hashes for same password (random salt)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});
