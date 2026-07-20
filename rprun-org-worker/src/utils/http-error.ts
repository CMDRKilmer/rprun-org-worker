// src/utils/http-error.ts
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }

  toApiError() {
    return { error: { code: this.code, message: this.message } };
  }
}

// 常用错误快捷构造（参数顺序统一为 code, message, status）
export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not Found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

// 通用 API 错误构造（路由层用 throw apiError(...) 抛错；errorHandler 统一捕获）
// 参数顺序：code, message, status（与 HttpError 构造器相反，便于路由层阅读）
export const apiError = (code: string, message: string, status: number): HttpError =>
  new HttpError(status, code, message);
