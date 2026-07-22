// src/services/extension-user-service.ts
import type { Env } from '../config';
import { upsertExtensionUser } from '../db/repositories/extension-users.repo';

export async function reportExtensionUser(
  env: Env,
  prunUsername: string,
  companyCode: string,
  displayName: string,
): Promise<void> {
  await upsertExtensionUser(env.DB, prunUsername, companyCode, displayName);
}
