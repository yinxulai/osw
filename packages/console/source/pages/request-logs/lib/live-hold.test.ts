import { describe, expect, it } from 'vitest'
import type { LiveRequest } from '@common/schemas'
import { LIVE_HOLD_MILLISECONDS, isLiveRowAlive, liveHoldDeadlineOf } from './live-hold'

function live(overrides: Partial<LiveRequest> = {}): LiveRequest {
  return {
    id: 'req_x',
    status: 'pending',
    phase: 'streaming',
    logicalModelId: null,
    clientProtocol: 'openai-responses',
    transport: 'http-stream',
    method: 'POST',
    path: '/v1/responses',
    startedAt: 1_000,
    updatedAt: 2_000,
    endedAt: null,
    candidates: [],
    attempts: [],
    events: [],
    ...overrides,
  }
}

describe('liveHoldDeadlineOf', () => {
  it('sets no deadline while the request is still running', () => {
    expect(liveHoldDeadlineOf({ live: live(), logStatus: 'pending', expanded: false, collapsedAt: null, now: 0 })).toBeNull()
  })

  it('sets no deadline while the user has it expanded', () => {
    const settled = live({ status: 'success', phase: 'settled', endedAt: 2_000 })
    expect(liveHoldDeadlineOf({ live: settled, logStatus: 'success', expanded: true, collapsedAt: null, now: 3_000 })).toBeNull()
  })

  it('counts from the moment it settled when nobody ever expanded it', () => {
    const settled = live({ status: 'success', phase: 'settled', endedAt: 2_000 })
    expect(liveHoldDeadlineOf({ live: settled, logStatus: 'success', expanded: false, collapsedAt: null, now: 3_000 }))
      .toBe(2_000 + LIVE_HOLD_MILLISECONDS)
  })

  it('counts from the collapse when the user opened it after it had already settled', () => {
    // 展开期间一直留着，收起那一刻起再留满一个完整窗口——否则「点开看了一眼就收起」
    // 会因为落定早就过去而立刻消失，等于这一眼白看。
    const settled = live({ status: 'success', phase: 'settled', endedAt: 2_000 })
    expect(liveHoldDeadlineOf({ live: settled, logStatus: 'success', expanded: false, collapsedAt: 9_000, now: 9_100 }))
      .toBe(9_000 + LIVE_HOLD_MILLISECONDS)
  })

  it('has no deadline when the ledger no longer knows the request', () => {
    expect(liveHoldDeadlineOf({ live: undefined, logStatus: 'success', expanded: false, collapsedAt: null, now: 0 })).toBeNull()
  })
})

describe('isLiveRowAlive', () => {
  it('keeps the row live while it is running', () => {
    expect(isLiveRowAlive({ live: live(), logStatus: undefined, expanded: false, collapsedAt: null, now: 5_000 })).toBe(true)
  })

  it('keeps the row live while the database row still says pending', () => {
    // 落库比推送慢最多 1.5s。这期间挑「还没结束」：否则一条刚跑完的请求会先塌成一张空卡片再跳回来。
    const settled = live({ status: 'success', phase: 'settled', endedAt: 2_000 })
    expect(isLiveRowAlive({ live: settled, logStatus: 'pending', expanded: false, collapsedAt: null, now: 3_000 })).toBe(true)
  })

  it('keeps it for the whole window after settling, then hands it back', () => {
    const settled = live({ status: 'failed', phase: 'settled', endedAt: 2_000 })
    const at = (now: number) => isLiveRowAlive({ live: settled, logStatus: 'failed', expanded: false, collapsedAt: null, now })

    expect(at(2_000)).toBe(true)
    expect(at(2_000 + LIVE_HOLD_MILLISECONDS - 1)).toBe(true)
    expect(at(2_000 + LIVE_HOLD_MILLISECONDS)).toBe(false)
  })

  it('keeps it as long as the user holds it open', () => {
    const settled = live({ status: 'failed', phase: 'settled', endedAt: 2_000 })
    expect(isLiveRowAlive({ live: settled, logStatus: 'failed', expanded: true, collapsedAt: null, now: 999_999 })).toBe(true)
  })

  it('never keeps a row the ledger has already dropped', () => {
    // 台账保留期（60s）到头就把这一条丢掉了；此时它必须交回落库形态，
    // 否则「一直展开着」会让这一行永远等不到自己的历史详情。
    expect(isLiveRowAlive({ live: undefined, logStatus: 'failed', expanded: true, collapsedAt: null, now: 0 })).toBe(false)
  })
})
