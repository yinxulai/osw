import { describe, expect, it } from 'vitest'
import type { LiveRequest } from '@common/schemas'
import { liveRequestActivity } from './live-request-selectors'

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
