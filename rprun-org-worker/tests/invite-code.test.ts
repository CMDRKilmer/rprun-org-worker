// tests/invite-code.test.ts
import { describe, it, expect } from 'vitest';
import { generateInviteCode, generateInviteCodes } from '../src/utils/invite-code';

describe('invite-code', () => {
  it('generates 10-char code from valid alphabet', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(10);
    expect(code).toMatch(/^[A-Z2-9]+$/);
    // 不含易混淆字符
    expect(code).not.toMatch(/[01OIL]/);
  });

  it('generates unique codes', () => {
    const codes = generateInviteCodes(20);
    expect(new Set(codes).size).toBe(20);
  });
});
