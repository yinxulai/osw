import { describe, expect, it } from 'vitest'
import { classifyHealthFailure, classifyUpstreamStatus, isClientAttributableStatus } from '@server/proxy/response/response'

describe('classifyUpstreamStatus', () => {
  it.each([200, 201, 204])('treats %i as a successful upstream response', status => {
    expect(classifyUpstreamStatus(status)).toBe('success')
  })

  it.each([300, 301, 399, 400, 401, 403, 404, 405, 408, 409, 422, 429, 500, 502, 503, 599])('allows failover for %i', status => {
    // 上游 4xx 最常见的来源是「这家不支持这个参数」：状态码不能证明换一家也无效，
    // 因此包括 400/422 在内的非 2xx 一律优先切换候选（见 `request-entry.test.ts` 的用例）。
    expect(classifyUpstreamStatus(status)).toBe('failover')
  })
})

describe('isClientAttributableStatus', () => {
  it.each([400, 413, 414, 422])('reports %i as a request the upstream itself rejected', status => {
    // 这一组是仅有的「报文格式不成立」类：换多少家上游都一样，因此全部候选告罄时
    // 客户端应该收到这个状态码，而不是「可重试」的 502。
    expect(isClientAttributableStatus(status)).toBe(true)
  })

  it.each([200, 300, 401, 403, 404, 405, 408, 409, 429, 500, 502, 503])('keeps %i out of the client-attributable set', status => {
    // 401/403（凭证）、404（模型或路径）、408（上游等待超时）、429（限流）都可能换一家就成立，
    // 客户端重试也确实合理，因此不能让它们把最终状态码改写成 4xx。
    expect(isClientAttributableStatus(status)).toBe(false)
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
