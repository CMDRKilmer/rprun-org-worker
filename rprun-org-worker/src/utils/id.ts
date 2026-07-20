// src/utils/id.ts
// crypto.randomUUID 在 Workers 中可用，返回 v4 UUID
export function generateId(): string {
  return crypto.randomUUID();
}
