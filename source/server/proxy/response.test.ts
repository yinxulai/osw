import { describe, expect, it } from 'vitest'
import { classifyUpstreamStatus } from './response'

describe('classifyUpstreamStatus', () => {
  it.each([200, 201, 204, 301, 399])('treats %i as a successful upstream response', status => {
    expect(classifyUpstreamStatus(status)).toBe('success')
  })

  it.each([408, 401, 403, 429, 500, 502, 503, 599])('allows failover for %i', status => {
    expect(classifyUpstreamStatus(status)).toBe('retry')
  })

  it.each([400, 404, 409, 422])('returns non-retryable client error %i', status => {
    expect(classifyUpstreamStatus(status)).toBe('terminal')
  })
})
