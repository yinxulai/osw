import { z } from 'zod'

export type ErrorCode =
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_CONFLICT'
  | 'DATABASE_UNAVAILABLE'
  | 'SECRET_STORE_UNAVAILABLE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'CLIENT_REQUEST_ABORTED'
  | 'INTERNAL_ERROR'

type AppErrorOptions = { expose?: boolean; cause?: unknown; details?: unknown }

export class AppError extends Error {
  readonly name = 'AppError'
  readonly expose: boolean
  readonly details?: unknown

  constructor(readonly code: string, readonly statusCode: number, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.expose = options.expose ?? true
    this.details = options.details
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof z.ZodError) {
    return new AppError(
      'VALIDATION_ERROR',
      400,
      error.errors.map(issue => issue.message).join('; '),
      { cause: error },
    )
  }

  if (error instanceof Error && error.message === 'CLIENT_REQUEST_ABORTED') {
    return new AppError('CLIENT_REQUEST_ABORTED', 499, '客户端已取消请求', { cause: error })
  }

  return new AppError('INTERNAL_ERROR', 500, '服务器内部错误', {
    expose: false,
    cause: error,
  })
}

export function getErrorResponseMessage(error: AppError, fallback: string): string {
  return error.expose ? error.message : fallback
}

export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof AppError && error.code === code
}
