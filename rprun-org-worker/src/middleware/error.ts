// src/middleware/error.ts
import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../config';
import { HttpError } from '../utils/http-error';

export const errorHandler: ErrorHandler<{ Bindings: Env }> = (err, c) => {
  if (err instanceof HttpError) {
    return c.json(err.toApiError(), err.status as ContentfulStatusCode);
  }
  console.error('[unhandled error]', err);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    500 as ContentfulStatusCode,
  );
};
