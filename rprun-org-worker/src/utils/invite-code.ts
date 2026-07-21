// src/utils/invite-code.ts
import crypto from 'node:crypto';
// 10 字符 base32（[A-Z2-9]，去除易混淆的 0/O/1/I/L）
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

export function generateInviteCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateInviteCode());
  }
  return [...codes];
}
