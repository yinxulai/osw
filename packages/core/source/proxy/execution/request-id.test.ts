import { describe, expect, it } from 'vitest'
import { extractRequestIdFromBody, extractRequestIdFromSse, extractUpstreamRequestId } from './request-id'

/**
 * 从响应头里找上游请求标识。
 *
 * 这张表按可信度排了二十多个头，所以测试的重点不是「能不能找到」，而是**顺序**：
 * 同时存在多个候选时必须挑最靠前的那一个，否则一条既带 `anthropic-request-id`
 * 又带 `cf-ray` 的响应会拿到 CDN 的边缘节点号去问上游。
 */
describe('extractUpstreamRequestId', () => {
  it('takes the first hit in the candidate order', () => {
    expect(extractUpstreamRequestId({
      'anthropic-request-id': 'req_011C',
      'x-request-id': 'gateway-id',
      'cf-ray': '8f2b1c',
    })).toBe('req_011C')
  })

  it('prefers a provider id over a tracing id', () => {
    // 追踪值是「这一次调用链」的标识，不是「这一次上游请求」的标识，只能最后才用。
    expect(extractUpstreamRequestId({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      'x-goog-request-id': 'goog-abc',
    })).toBe('goog-abc')
  })

  it('recognises the vendor-specific ids', () => {
    expect(extractUpstreamRequestId({ 'apim-request-id': 'apim-1' })).toBe('apim-1')
    expect(extractUpstreamRequestId({ 'x-ms-request-id': 'ms-1' })).toBe('ms-1')
    expect(extractUpstreamRequestId({ 'x-amzn-requestid': 'amzn-1' })).toBe('amzn-1')
    expect(extractUpstreamRequestId({ 'x-tt-logid': '20251031120000ABC' })).toBe('20251031120000ABC')
    expect(extractUpstreamRequestId({ 'x-bce-request-id': 'bce-1' })).toBe('bce-1')
    expect(extractUpstreamRequestId({ 'x-dashscope-request-id': 'dash-1' })).toBe('dash-1')
  })

  it('pulls the trace id out of traceparent instead of the whole header', () => {
    // 整串带版本号、span、采样标记，粘进搜索框没人对得上；trace-id 才是共用那一串。
    expect(extractUpstreamRequestId({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    })).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('pulls Root out of x-amzn-trace-id', () => {
    expect(extractUpstreamRequestId({
      'x-amzn-trace-id': 'Root=1-6789abcd-1234567890abcdef;Parent=5399;Sampled=1',
    })).toBe('1-6789abcd-1234567890abcdef')
  })

  it('pulls the trace id out of x-cloud-trace-context', () => {
    expect(extractUpstreamRequestId({ 'x-cloud-trace-context': 'abc123/def456;o=1' })).toBe('abc123')
  })

  it('keeps looking when a parsed header has no usable id', () => {
    // `traceparent` 只有三段（畸形），剖不出 trace-id，要回到后面那个头。
    expect(extractUpstreamRequestId({
      traceparent: '00-abc-01',
      'x-request-id': 'fallback-id',
    })).toBe('fallback-id')
    expect(extractUpstreamRequestId({ 'x-amzn-trace-id': 'Parent=5399;Sampled=1' })).toBeNull()
  })

  it('ignores blank values and keeps looking', () => {
    expect(extractUpstreamRequestId({ 'anthropic-request-id': '   ', 'x-request-id': 'ok' })).toBe('ok')
  })

  it('takes the first element of a repeated header', () => {
    // Node 对重复头给数组；取第一个，与「首个命中即返回」同一条规则。
    expect(extractUpstreamRequestId({ 'x-request-id': ['first', 'second'] })).toBe('first')
  })

  it('matches header names case-insensitively', () => {
    // 正常路径上游回来的头已经是小写，但自拼的握手响应与测试报文不一定。
    expect(extractUpstreamRequestId({ 'X-Request-Id': 'cased-id' })).toBe('cased-id')
  })

  it('returns null when nothing matches', () => {
    expect(extractUpstreamRequestId({})).toBeNull()
    expect(extractUpstreamRequestId({ 'content-type': 'application/json' })).toBeNull()
  })
})

describe('upstream request id extraction', () => {
  it('extracts a top-level request id from JSON', () => {
    expect(extractRequestIdFromBody('{"id":"req-upstream-123"}')).toBe('req-upstream-123')
    expect(extractRequestIdFromBody('{"request_id":"req-upstream-456"}')).toBe('req-upstream-456')
    expect(extractRequestIdFromBody('{"requestId":"req-upstream-789"}')).toBe('req-upstream-789')
  })

  it('extracts a nested request id from provider error JSON', () => {
    expect(extractRequestIdFromBody(JSON.stringify({
      error: { metadata: { request_id: 'req-nested-123' } },
    }))).toBe('req-nested-123')
  })

  it('extracts a request id from SSE data events', () => {
    const body = 'event: response\ndata: {"response":{"id":"resp-sse-123"}}\n\ndata: [DONE]\n\n'
    expect(extractRequestIdFromSse(body)).toBe('resp-sse-123')
    expect(extractRequestIdFromBody(body)).toBe('resp-sse-123')
  })

  it('extracts a request id from captured streaming chunks', () => {
    const body = JSON.stringify({
      schemaVersion: 1,
      chunks: ['data: {"id":"chatcmpl-sse-123"}\n\n', 'data: [DONE]\n\n'],
    })
    expect(extractRequestIdFromBody(body)).toBe('chatcmpl-sse-123')
  })

  it('ignores missing, blank, malformed, and done-only responses', () => {
    expect(extractRequestIdFromBody(null)).toBeNull()
    expect(extractRequestIdFromBody('')).toBeNull()
    expect(extractRequestIdFromBody('{"id":"   "}')).toBeNull()
    expect(extractRequestIdFromBody('{not-json}')).toBeNull()
    expect(extractRequestIdFromSse('data: [DONE]\n\n')).toBeNull()
  })
})
