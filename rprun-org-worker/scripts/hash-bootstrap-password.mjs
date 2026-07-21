// scripts/hash-bootstrap-password.mjs
// 一次性脚本:算 PBKDF2 哈希,用于引导第一个 BOARD 用户。
// 跑法: pnpm exec node scripts/hash-bootstrap-password.mjs "YourPassword123!"
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('用法: node scripts/hash-bootstrap-password.mjs "<至少 8 位密码>"');
  process.exit(1);
}

const salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES));
const key = await webcrypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(password),
  { name: 'PBKDF2' },
  false,
  ['deriveBits'],
);
const hash = await webcrypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
  key,
  HASH_BITS,
);

const out = `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(new Uint8Array(hash))}`;
console.log(out);