import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_TOKEN_PATH, isDevelopmentTokenRequest } from './development-token'
import type { IncomingMessage } from 'node:http'

/** 只带上这两件被判断的东西：方法与 URL。多给字段反而会让测试变得像在描述实现。 */
function request(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage
}

describe('isDevelopmentTokenRequest', () => {
  it('只有 POST 才会命中', () => {
    // GET 在守卫那层就已经是 405 了；这里也必须是 false，否则一个 GET 就能把凭证捞出来。
    expect(isDevelopmentTokenRequest(request('POST', DEVELOPMENT_TOKEN_PATH))).toBe(true)
    expect(isDevelopmentTokenRequest(request('GET', DEVELOPMENT_TOKEN_PATH))).toBe(false)
    expect(isDevelopmentTokenRequest(request('OPTIONS', DEVELOPMENT_TOKEN_PATH))).toBe(false)
  })

  it('按路径而不是按前缀匹配', () => {
    // `/api/development/management-token/extra` 或 `/x/api/development/management-token`
    // 都该落空：前者不是一个能应答的地址，后者压根不是管理 API。
    expect(isDevelopmentTokenRequest(request('POST', `${DEVELOPMENT_TOKEN_PATH}/extra`))).toBe(false)
    expect(isDevelopmentTokenRequest(request('POST', `/prefix${DEVELOPMENT_TOKEN_PATH}`))).toBe(false)
    expect(isDevelopmentTokenRequest(request('POST', '/api/development/seed'))).toBe(false)
  })

  it('查询串不影响判定', () => {
    // 判断用的是 `URL.pathname`；查询串常常被调用方随手带上，不该因此变成 404。
    expect(isDevelopmentTokenRequest(request('POST', `${DEVELOPMENT_TOKEN_PATH}?cache=0`))).toBe(true)
  })

  it('畸形 URL 不会抛出', () => {
    // 这条路径上的异常会被请求边界接住并回 500，而真实原因只是「有人乱发了条请求」。
    expect(isDevelopmentTokenRequest(request('POST', '::::'))).toBe(false)
  })
})
