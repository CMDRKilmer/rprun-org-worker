// src/routes/tasks.ts
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../config';
import type { ContextVars } from '../types';
import { authMiddleware } from '../middleware/jwt';
import {
  createTaskSchema,
  patchTaskSchema,
  cancelTaskSchema,
  linkContractSchema,
  syncStatusSchema,
  listTasksQuerySchema,
  createNoteSchema,
} from '../utils/validation';
import { apiError } from '../utils/http-error';
import {
  createTask,
  deleteTaskForPublisher,
  getTaskForUser,
  listTasksForUser,
  patchTask,
  claimTask,
  releaseTask,
  cancelTask,
  linkContract,
} from '../services/task-service';
import { syncTaskFromContract } from '../services/contract-sync-service';
import { listNotesByTask, createNote } from '../db/repositories/notes.repo';

const tasks = new Hono<{ Bindings: Env; Variables: ContextVars }>();

// 全部 /tasks/* 路由都需要登录
tasks.use('*', authMiddleware);

// GET /tasks
tasks.get('/', async (c) => {
  const query = Object.fromEntries(new URLSearchParams(c.req.query()));
  const parsed = listTasksQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const result = await listTasksForUser(c.env, c.var.userId, parsed.data);
  return c.json(result, 200 as ContentfulStatusCode);
});

// GET /tasks/:id
tasks.get('/:id', async (c) => {
  const task = await getTaskForUser(c.env, c.req.param('id'), c.var.userId);
  return c.json(task, 200 as ContentfulStatusCode);
});

// POST /tasks
tasks.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const task = await createTask(
    c.env,
    c.var.userId,
    c.var.prunUsername,
    c.var.companyCode,
    parsed.data,
  );
  return c.json(task, 201 as ContentfulStatusCode);
});

// PATCH /tasks/:id
tasks.patch('/:id', async (c) => {
  const body = await c.req.json();
  const parsed = patchTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const task = await patchTask(c.env, c.req.param('id'), c.var.userId, parsed.data);
  return c.json(task, 200 as ContentfulStatusCode);
});

// POST /tasks/:id/claim
tasks.post('/:id/claim', async (c) => {
  const task = await claimTask(
    c.env,
    c.req.param('id'),
    c.var.userId,
    c.var.prunUsername,
    c.var.companyCode,
  );
  return c.json(task, 200 as ContentfulStatusCode);
});

// POST /tasks/:id/release
tasks.post('/:id/release', async (c) => {
  const task = await releaseTask(c.env, c.req.param('id'), c.var.userId);
  return c.json(task, 200 as ContentfulStatusCode);
});

// POST /tasks/:id/cancel
tasks.post('/:id/cancel', async (c) => {
  // 客户端 cancelTask：body 可选 reason
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  // BOARD 可取消他人任务；COLLABORATOR 仅可取消自己发布的。service 内部做权限判定
  const task = await cancelTask(
    c.env,
    c.req.param('id'),
    c.var.userId,
    c.var.role,
    parsed.data.reason,
  );
  return c.json(task, 200 as ContentfulStatusCode);
});

// POST /tasks/:id/link-contract
tasks.post('/:id/link-contract', async (c) => {
  const body = await c.req.json();
  const parsed = linkContractSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const task = await linkContract(
    c.env,
    c.req.param('id'),
    c.var.userId,
    parsed.data.contractId,
    parsed.data.contractCreator,
  );
  return c.json(task, 200 as ContentfulStatusCode);
});

// POST /tasks/:id/sync-status
tasks.post('/:id/sync-status', async (c) => {
  const body = await c.req.json();
  const parsed = syncStatusSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  const task = await syncTaskFromContract(
    c.env,
    c.req.param('id'),
    parsed.data.contractStatus,
    c.var.userId,
  );
  return c.json(task, 200 as ContentfulStatusCode);
});

// GET /tasks/:id/notes
tasks.get('/:id/notes', async (c) => {
  // 校验用户对该任务可见（同上 getTaskForUser）
  await getTaskForUser(c.env, c.req.param('id'), c.var.userId);
  const notes = await listNotesByTask(c.env.DB, c.req.param('id'));
  return c.json(notes, 200 as ContentfulStatusCode);
});

// POST /tasks/:id/notes
tasks.post('/:id/notes', async (c) => {
  const body = await c.req.json();
  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    throw apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  }
  // 校验可见性 + 拿用户名
  const task = await getTaskForUser(c.env, c.req.param('id'), c.var.userId);
  const note = await createNote(
    c.env.DB,
    c.req.param('id'),
    c.var.userId,
    task.publisherId === c.var.userId
      ? task.publisherUsername
      : task.claimerUsername ?? task.publisherUsername,
    parsed.data.content,
  );
  return c.json(note, 201 as ContentfulStatusCode);
});

// DELETE /tasks/:id
// 物理删除：仅 publisher 可删自己发布的任务（service 内部校验）。
// 返回删除前的快照 + 状态码 200，便于前端展示"已删除 ... "。
// task_notes 通过 FK CASCADE 自动清理；audit_logs 保留（无 FK）。
tasks.delete('/:id', async (c) => {
  const snapshot = await deleteTaskForPublisher(
    c.env,
    c.req.param('id'),
    c.var.userId,
  );
  return c.json(snapshot, 200 as ContentfulStatusCode);
});

export default tasks;
