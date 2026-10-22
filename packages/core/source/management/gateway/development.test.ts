import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { mockResponse } from '../test-support'
import {
  DEVELOPMENT_TOKEN_PATH,
  isDevelopmentOnlyPath,
  isDevelopmentTokenRequest,
  rejectDevelopmentOnlyPath,
} from './development'

function request(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage
}

function payload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0]?.[0])) as Record<string, unknown>
}

describe('isDevelopmentTokenRequest', () => {
  it('only answers POST', () => {
    // GET 在网关那层已经是 405；这里也必须是 false，否则一个 GET 就能把凭证捞出来。
    expect(isDevelopmentTokenRequest(request('POST', DEVELOPMENT_TOKEN_PATH))).toBe(true)
    expect(isDevelopmentTokenRequest(request('GET', DEVELOPMENT_TOKEN_PATH))).toBe(false)
    expect(isDevelopmentTokenRequest(request('OPTIONS', DEVELOPMENT_TOKEN_PATH))).toBe(false)
  })

  it('matches the whole path rather than a prefix', () => {
    // `/api/development/management-token/extra` 或 `/x/api/development/management-token`
    // 都该落空：前者不是一个能应答的地址，后者压根不是管理 API。
    expect(isDevelopmentTokenRequest(request('POST', `${DEVELOPMENT_TOKEN_PATH}/extra`))).toBe(false)
    expect(isDevelopmentTokenRequest(request('POST', `/prefix${DEVELOPMENT_TOKEN_PATH}`))).toBe(false)
    expect(isDevelopmentTokenRequest(request('POST', '/api/development/seed'))).toBe(false)
  })

  it('ignores the query string', () => {
    // 判断用的是 `URL.pathname`；查询串常常被调用方随手带上，不该因此变成 404。
    expect(isDevelopmentTokenRequest(request('POST', `${DEVELOPMENT_TOKEN_PATH}?cache=0`))).toBe(true)
  })

  it('does not throw on a malformed URL', () => {
    // 这条路径上的异常会被请求边界接住并回 500，而真实原因只是「有人乱发了条请求」。
    expect(isDevelopmentTokenRequest(request('POST', '::::'))).toBe(false)
  })
})

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

  it('does not cover the token readout, which has its own gate', () => {
    // 凭证读取口的条件是「开发形态 + 已配置凭证 + 非浏览器」，无法在这一条判据里表达。
    expect(isDevelopmentOnlyPath(DEVELOPMENT_TOKEN_PATH)).toBe(false)
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
