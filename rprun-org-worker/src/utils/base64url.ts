// src/utils/base64url.ts
// WebCrypto 处理 ArrayBuffer，需要 base64url 编解码用于 JWT

export function base64urlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlEncodeStr(s: string): string {
  return base64urlEncode(new TextEncoder().encode(s));
}

export function base64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const base64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function base64urlDecodeStr(s: string): string {
  return new TextDecoder().decode(base64urlDecode(s));
}
