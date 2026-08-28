import { describe, expect, it } from 'vitest'
import { classifyHealthFailure, classifyUpstreamStatus } from '@server/proxy/response/response'

describe('classifyUpstreamStatus', () => {
  it.each([200, 201, 204])('treats %i as a successful upstream response', status => {
    expect(classifyUpstreamStatus(status)).toBe('success')
  })

  it.each([300, 301, 399])('does not treat redirect %i as a successful model response', status => {
    expect(classifyUpstreamStatus(status)).toBe('terminal')
  })

  it.each([408, 401, 403, 429, 500, 502, 503, 599])('allows failover for %i', status => {
    expect(classifyUpstreamStatus(status)).toBe('retry')
  })

  it.each([400, 404, 409, 422])('returns non-retryable client error %i', status => {
    expect(classifyUpstreamStatus(status)).toBe('terminal')
  })
})

describe('classifyHealthFailure', () => {
  it.each([null, 401, 403])('attributes provider-wide failure %s to the provider', status => {
    expect(classifyHealthFailure(status)).toBe('provider')
  })

  it.each([404, 408, 500, 503])('attributes model-scoped failure %i to the provider model', status => {
    expect(classifyHealthFailure(status)).toBe('provider-model')
  })

  it('attributes provider-wide rate limit responses to the provider', () => {
    expect(classifyHealthFailure(429, '{"error":"API key rate limit exceeded"}')).toBe('provider')
  })

  it('keeps ambiguous rate limit responses scoped to the provider model', () => {
    expect(classifyHealthFailure(429, '{"error":"rate limit exceeded"}')).toBe('provider-model')
  })

  it.each([400, 409, 422])('does not change health for terminal request error %i', status => {
    expect(classifyHealthFailure(status)).toBe('none')
  })
})
