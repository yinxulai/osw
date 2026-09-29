import { describe, expect, it } from 'vitest'
import type { LiveRequest, LiveRequestAttempt, LiveRequestAttemptState } from '@common/schemas'
import { liveRequestActivity, providerModelProcessingCounts } from './live-request-selectors'

function request(overrides: Partial<LiveRequest> = {}): LiveRequest {
  return {
    id: 'req_test',
    status: 'pending',
    phase: 'streaming',
    logicalModelId: 'logical_primary',
    clientProtocol: 'openai-responses',
    transport: 'http',
    method: 'POST',
    path: '/v1/responses',
    startedAt: 1,
    updatedAt: 1,
    endedAt: null,
    candidates: [],
    attempts: [],
    events: [],
    ...overrides,
  }
}

describe('liveRequestActivity', () => {
  it('returns no activity after the request settles', () => {
    expect(liveRequestActivity(request({ status: 'success', phase: 'settled' }))).toBeNull()
  })

  it('starts neutral before the first semantic event arrives', () => {
    expect(liveRequestActivity(request())).toEqual({
      key: 'req_test:start:1',
      tone: 'neutral',
    })
  })

  it.each([
    ['info', 'neutral'],
    ['success', 'success'],
    ['warn', 'warning'],
    ['error', 'error'],
  ] as const)('maps the %s event level to the %s tone', (level, tone) => {
    const activity = liveRequestActivity(request({
      events: [{ at: 10, offsetMilliseconds: 10, kind: 'upstream.head', level, detail: null }],
    }))

    expect(activity).toEqual({
      key: 'req_test:1:10:upstream.head',
      tone,
    })
  })
})

describe('providerModelProcessingCounts', () => {
  function attempt(providerModelId: string, state: LiveRequestAttemptState): LiveRequestAttempt {
    return {
      index: 0,
      providerId: 'prov_1',
      providerName: 'Provider',
      providerModelId,
      providerModelName: providerModelId,
      endpointProtocol: 'openai-responses',
      url: 'https://example.com/v1',
      state,
      httpStatus: null,
      upstreamTransport: null,
      requestBytes: 0,
      requestRewriteRuleNames: [],
      upstreamBytes: 0,
      downstreamBytes: 0,
      chunkCount: 0,
      chunkPreview: null,
      ttftMilliseconds: null,
      inputTokens: null,
      outputTokens: null,
      errorMessage: null,
      startedAt: 1,
      endedAt: null,
    }
  }

  it('counts in-flight requests per provider model', () => {
    const counts = providerModelProcessingCounts([
      request({ id: 'req_one', attempts: [attempt('pm_a', 'streaming')] }),
      request({ id: 'req_two', attempts: [attempt('pm_a', 'awaiting-upstream')] }),
      request({ id: 'req_three', attempts: [attempt('pm_b', 'connecting')] }),
    ])

    expect(counts.get('pm_a')).toBe(2)
    expect(counts.get('pm_b')).toBe(1)
  })

  it('counts a request against its latest attempt after a failover', () => {
    const counts = providerModelProcessingCounts([
      request({ attempts: [attempt('pm_old', 'failed'), attempt('pm_new', 'streaming')] }),
    ])

    expect(counts.get('pm_old')).toBeUndefined()
    expect(counts.get('pm_new')).toBe(1)
  })

  it('ignores settled requests, ended attempts, and requests still routing', () => {
    const counts = providerModelProcessingCounts([
      request({ id: 'req_success', status: 'success', phase: 'settled', attempts: [attempt('pm_a', 'success')] }),
      request({ id: 'req_ended', attempts: [attempt('pm_a', 'success')] }),
      request({ id: 'req_routing', logicalModelId: null, attempts: [] }),
    ])

    expect(counts.size).toBe(0)
  })

  it('returns an empty map before the first snapshot arrives', () => {
    expect(providerModelProcessingCounts(undefined).size).toBe(0)
  })
})
