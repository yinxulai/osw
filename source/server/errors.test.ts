import { describe, expect, it } from 'vitest'
import { AppError, getErrorResponseMessage, normalizeError } from './errors'

describe('server errors', () => {
  it('normalizes validation errors without losing client-facing details', () => {
    const normalized = normalizeError(new AppError('VALIDATION_ERROR', 400, '字段无效'))

    expect(normalized.code).toBe('VALIDATION_ERROR')
    expect(normalized.statusCode).toBe(400)
    expect(getErrorResponseMessage(normalized, '服务器内部错误')).toBe('字段无效')
  })

  it('hides unknown internal error messages from clients', () => {
    const normalized = normalizeError(new Error('secret database path'))

    expect(normalized.code).toBe('INTERNAL_ERROR')
    expect(normalized.statusCode).toBe(500)
    expect(getErrorResponseMessage(normalized, '服务器内部错误')).toBe('服务器内部错误')
    expect(normalized.cause).toBeInstanceOf(Error)
  })

  it('normalizes client cancellation by stable code', () => {
    const normalized = normalizeError(new Error('CLIENT_REQUEST_ABORTED'))

    expect(normalized.code).toBe('CLIENT_REQUEST_ABORTED')
    expect(normalized.statusCode).toBe(499)
  })
})
