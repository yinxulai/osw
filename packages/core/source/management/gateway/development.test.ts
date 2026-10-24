import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { mockResponse } from '../test-support'
import { isDevelopmentOnlyPath, rejectDevelopmentOnlyPath } from './development'

function payload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0]?.[0])) as Record<string, unknown>
}

describe('isDevelopmentOnlyPath', () => {
  it('picks out the seed path', () => {
    expect(isDevelopmentOnlyPath('/api/development/seed')).toBe(true)
  })

  it('compares the whole path, so a lookalike is not swept in', () => {
    // 路由拿到的是 `new URL(...).pathname`，所以这里传进来的也是纯路径；
    // 这条断言锁的是「不会被 `startsWith` 之类的宽松判断放过」。
    expect(isDevelopmentOnlyPath('/api/development/seed/')).toBe(false)
    expect(isDevelopmentOnlyPath('/api/development/seed/extra')).toBe(false)
    expect(isDevelopmentOnlyPath('/api/development')).toBe(false)
  })

  it('does not cover ordinary paths', () => {
    for (const pathname of ['/api/provider/list', '/api/logical-model/create', '/']) {
      expect(isDevelopmentOnlyPath(pathname)).toBe(false)
    }
  })
})

describe('rejectDevelopmentOnlyPath', () => {
  it('answers 404 with the path it judged', () => {
    const response = mockResponse()

    rejectDevelopmentOnlyPath(response, '/api/development/seed')

    expect(response.statusCode).toBe(404)
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    expect(payload(response)).toEqual({
      success: false,
      errorCode: 'NOT_FOUND',
      errorMessage: 'API path not found: /api/development/seed',
      errorParams: { path: '/api/development/seed' },
    })
  })

  it('uses 404 rather than 403', () => {
    // `403` 等于向调用方确认「这条路径存在，只是不给你用」。
    const response = mockResponse()

    rejectDevelopmentOnlyPath(response, '/api/development/seed')

    expect(response.statusCode).toBe(404)
  })

  it('does not write over an already finished response', () => {
    const response = mockResponse({ writableEnded: true })

    rejectDevelopmentOnlyPath(response, '/api/development/seed')

    expect(response.end).not.toHaveBeenCalled()
  })
})
