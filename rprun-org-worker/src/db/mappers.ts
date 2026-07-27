// src/db/mappers.ts
import type {
  OrgUser, OrgTask, TaskNote, InviteCode, AuditLog, OrgListing,
} from '../types';

// D1 行类型（snake_case，与 schema 对齐）
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  prun_username: string;
  company_code: string;
  display_name: string;
  role: 'BOARD' | 'COLLABORATOR';
  invite_code_id: string;
  created_at: string;
  last_login_at: string | null;
}

export interface TaskRow {
  id: string;
  type: 'BUY' | 'SELL' | 'SHIP' | 'LOAN';
  contract_json: string;
  status: 'PUBLISHED' | 'AWAITING_CONTRACT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  publisher_id: string;
  publisher_username: string;
  publisher_company_code: string;
  claimer_id: string | null;
  claimer_username: string | null;
  claimer_company_code: string | null;
  contract_id: string | null;
  contract_creator: 'publisher' | 'claimer' | null;
  // 解耦后新增：task 由哪个挂单接取产生（老任务为 NULL）。
  listing_id: string | null;
  claim_seq: number | null;
  expires_at: string | null;
  created_at: string;
  published_at: string | null;
  claimed_at: string | null;
  in_progress_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  task_id: string;
  author_id: string;
  author_username: string;
  content: string;
  created_at: string;
}

export interface InviteCodeRow {
  id: string;
  code: string;
  created_by: string;
  created_at: string;
  used_by_user_id: string | null;
  used_at: string | null;
  revoked_at: string | null;
}

export interface AuditLogRow {
  id: string;
  actor_type: 'user' | 'admin' | 'system';
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: string | null;
  created_at: string;
}

export interface ListingRow {
  id: string;
  type: 'BUY' | 'SELL' | 'SHIP';
  commodity: string;
  amount: number;
  remaining_amount: number;
  price: number;
  currency: string;
  location: string | null;
  origin: string | null;
  destination: string | null;
  publisher_id: string;
  publisher_username: string;
  publisher_company_code: string;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'EXPIRED';
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapUser(row: UserRow): OrgUser {
  return {
    id: row.id,
    email: row.email,
    prunUsername: row.prun_username,
    companyCode: row.company_code,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? undefined,
  };
}

export function mapTask(row: TaskRow): OrgTask {
  return {
    id: row.id,
    type: row.type,
    contractJson: JSON.parse(row.contract_json),
    status: row.status,
    publisherId: row.publisher_id,
    publisherUsername: row.publisher_username,
    publisherCompanyCode: row.publisher_company_code,
    claimerId: row.claimer_id ?? undefined,
    claimerUsername: row.claimer_username ?? undefined,
    claimerCompanyCode: row.claimer_company_code ?? undefined,
    contractId: row.contract_id ?? undefined,
    contractCreator: row.contract_creator ?? undefined,
    listingId: row.listing_id ?? undefined,
    claimSeq: row.claim_seq ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    inProgressAt: row.in_progress_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

export function mapNote(row: NoteRow): TaskNote {
  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    authorUsername: row.author_username,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function mapInviteCode(row: InviteCodeRow): InviteCode {
  return {
    id: row.id,
    code: row.code,
    createdBy: row.created_by,
    createdAt: row.created_at,
    usedByUserId: row.used_by_user_id ?? undefined,
    usedAt: row.used_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
  };
}

export function mapAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id ?? undefined,
    action: row.action,
    targetType: row.target_type ?? undefined,
    targetId: row.target_id ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
  };
}

export function mapListing(row: ListingRow): OrgListing {
  return {
    id: row.id,
    type: row.type,
    commodity: row.commodity,
    amount: row.amount,
    remainingAmount: row.remaining_amount,
    price: row.price,
    currency: row.currency,
    location: row.location ?? undefined,
    origin: row.origin ?? undefined,
    destination: row.destination ?? undefined,
    publisherId: row.publisher_id,
    publisherUsername: row.publisher_username,
    publisherCompanyCode: row.publisher_company_code,
    status: row.status,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
