import { describe, expect, it } from 'vitest'
import type { LiveRequest } from '@common/schemas'
import { liveRequestActivity, logicalModelActivities } from './live-request-selectors'

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

describe('logicalModelActivities', () => {
  it('deduplicates models with multiple in-flight requests', () => {
    const activity = logicalModelActivities([
      request({ id: 'req_one', logicalModelId: 'logical_primary' }),
      request({ id: 'req_two', logicalModelId: 'logical_primary' }),
      request({ id: 'req_three', logicalModelId: 'logical_secondary' }),
    ])

    expect([...activity.keys()]).toEqual(['logical_primary', 'logical_secondary'])
  })

  it('uses the newest semantic event as the animation key', () => {
    const activity = logicalModelActivities([
      request({
        id: 'req_old',
        logicalModelId: 'logical_primary',
        events: [{ at: 10, offsetMilliseconds: 10, kind: 'route.resolved', level: 'info', detail: null }],
      }),
      request({
        id: 'req_new',
        logicalModelId: 'logical_primary',
        events: [{ at: 20, offsetMilliseconds: 20, kind: 'upstream.head', level: 'success', detail: null }],
      }),
    ])

    expect(activity.get('logical_primary')).toEqual({
      key: 'req_new:1:20:upstream.head',
      tone: 'success',
    })
  })

  it('does not replay the animation for byte-only snapshot updates', () => {
    const event = { at: 20, offsetMilliseconds: 20, kind: 'upstream.head', level: 'success' as const, detail: null }
    const first = logicalModelActivities([request({ events: [event], updatedAt: 20 })])
    const second = logicalModelActivities([request({ events: [event], updatedAt: 1_000, attempts: [] })])

    expect(first.get('logical_primary')).toEqual(second.get('logical_primary'))
  })

  it('ignores settled requests and requests without a logical model', () => {
    const activity = logicalModelActivities([
      request({ id: 'req_success', status: 'success', phase: 'settled' }),
      request({ id: 'req_unmatched', logicalModelId: null }),
    ])

    expect(activity.size).toBe(0)
  })

  it('returns an empty map before the first snapshot arrives', () => {
    expect(logicalModelActivities(undefined).size).toBe(0)
  })
})
