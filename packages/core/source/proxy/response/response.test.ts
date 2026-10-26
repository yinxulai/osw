import { describe, expect, it } from 'vitest'
import { classifyHealthFailure, classifyUpstreamStatus, isClientAttributableStatus } from '@server/proxy/response/response'
import { CLIENT_ATTRIBUTABLE_STATUS_CODES } from './test-support'

// 状态码分类是**区间**，不是一张点表：生产实现说的是「2xx 成功，其余换一家」。
// 因此这里穷举 100..599 逐码验收，而不是抽查几个代表点——把 `< 300` 写成 `< 250`
// 这类区间漂移，抽样表照不到，穷举一条都跑不掉。
const ALL_STATUS_CODES = Array.from({ length: 500 }, (_, index) => 100 + index)

describe('classifyUpstreamStatus', () => {
  it('treats every 2xx as success and everything else as failover, across 100..599', () => {
    const mismatches: string[] = []
    for (const status of ALL_STATUS_CODES) {
      // 上游 4xx 最常见的来源是「这家不支持这个参数」：状态码不能证明换一家也无效，
      // 因此包括 400/422 在内的非 2xx 一律优先切换候选（见 `request-entry.test.ts` 的用例）。
      const expected = status >= 200 && status < 300 ? 'success' : 'failover'
      const actual = classifyUpstreamStatus(status)
      if (actual !== expected) mismatches.push(`${status}: ${actual} !== ${expected}`)
    }
    expect(mismatches).toEqual([])
  })
})

describe('isClientAttributableStatus', () => {
  it('matches the client-attributable whitelist across 100..599', () => {
    // 这一组是仅有的「报文格式不成立」类：换多少家上游都一样，因此全部候选告罄时
    // 客户端应该收到这个状态码，而不是「可重试」的 502。其余状态码一律不得判真：
    // 401/403（凭证）、404（模型或路径）、408（上游等待超时）、429（限流）都可能换一家就成立。
    const attributable = new Set(CLIENT_ATTRIBUTABLE_STATUS_CODES)
    const mismatches: string[] = []
    for (const status of ALL_STATUS_CODES) {
      const expected = attributable.has(status)
      const actual = isClientAttributableStatus(status)
      if (actual !== expected) mismatches.push(`${status}: ${actual} !== ${expected}`)
    }
    expect(mismatches).toEqual([])
  })

  it('keeps the whitelist to the four malformed-request status codes', () => {
    // 上一条拿这份白名单逐码比对生产实现；这一条钉住白名单本身，
    // 「白名单和它比对的那份实现一起被改错」因此仍然会被抓住。
    expect([...CLIENT_ATTRIBUTABLE_STATUS_CODES].sort((left, right) => left - right)).toEqual([400, 413, 414, 422])
  })
})

describe('classifyHealthFailure', () => {
  it.each([null, 401, 403])('attributes provider-wide failure %s to the provider', status => {
    expect(classifyHealthFailure({ statusCode: status })).toBe('provider')
  })

  it.each([404, 408, 500, 503])('attributes model-scoped failure %i to the provider model', status => {
    expect(classifyHealthFailure({ statusCode: status })).toBe('provider-model')
  })

  it('attributes provider-wide rate limit responses to the provider', () => {
    expect(classifyHealthFailure({ statusCode: 429, responseBody: '{"error":"API key rate limit exceeded"}' })).toBe('provider')
  })

  it('keeps ambiguous rate limit responses scoped to the provider model', () => {
    expect(classifyHealthFailure({ statusCode: 429, responseBody: '{"error":"rate limit exceeded"}' })).toBe('provider-model')
  })

  it.each([400, 409, 422])('does not change health for terminal request error %i', status => {
    expect(classifyHealthFailure({ statusCode: status })).toBe('none')
  })

  it('attributes a transport mismatch to the provider model even though the status is 2xx', () => {
    // 上游用 200 + 非 SSE 正文回答了一个要增量传输的请求：状态码看起来是成功的，
    // 违约事实因此必须由调用方显式告知，否则这类失败会被当成没发生。
    expect(classifyHealthFailure({ statusCode: 200, responseBody: '{"choices":[]}', transportMismatch: true })).toBe('provider-model')
  })

  it('attributes an interrupted stream to the provider model even though the status is 2xx', () => {
    // 上游已经回了 200 并在中途断掉：状态码同样是成功的，失败只存在于「正文没搬完」这个事实里。
    expect(classifyHealthFailure({ statusCode: 200, responseBody: '{"choices":[', streamInterrupted: true })).toBe('provider-model')
  })
})
