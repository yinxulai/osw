import { describe, expect, it } from 'vitest'
import type { LiveRequest, LiveRequestEvent, LiveRequestEventLevel, LiveRequestAttempt } from '@common/schemas'
import { timelineOf } from './timeline'
import { groupTimeline } from './timeline-groups'

function attemptOf(overrides: Partial<LiveRequestAttempt> = {}): LiveRequestAttempt {
  return {
    index: 0,
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    endpointProtocol: 'openai-responses',
    url: 'https://example.com/v1/responses',
    state: 'streaming',
    httpStatus: 200,
    upstreamTransport: 'http-stream',
    upstreamRequestId: null,
    requestBytes: 1_024,
    requestRewriteRuleNames: [],
    upstreamBytes: 4_096,
    downstreamBytes: 2_048,
    chunkCount: 3,
    chunkPreview: null,
    ttftMilliseconds: 120,
    inputTokens: 12,
    outputTokens: 42,
    errorMessage: null,
    startedAt: 1_000,
    endedAt: null,
    ...overrides,
  }
}

function eventOf(kind: string, level: LiveRequestEventLevel, detail: Record<string, string | number | boolean> | null, offset: number): LiveRequestEvent {
  return { at: 1_000 + offset, offsetMilliseconds: offset, kind, level, detail }
}

function liveOf(events: LiveRequestEvent[]): LiveRequest {
  return {
    id: 'req_live',
    status: 'pending',
    phase: 'streaming',
    logicalModelId: 'model_default',
    clientProtocol: 'openai-responses',
    transport: 'http-stream',
    method: 'POST',
    path: '/v1/responses',
    startedAt: 1_000,
    updatedAt: 1_100,
    endedAt: null,
    candidates: [],
    attempts: [attemptOf(), attemptOf({ index: 1, providerModelName: 'model-two' })],
    events,
  }
}

/**
 * 分段是「执行过程」那块面板的骨架：一条请求试了几家、每家多久、为什么放弃，
 * 这三件事在平铺的事件流里全被压成了等重的行。这里验的是切段规则本身。
 */
describe('groupTimeline', () => {
  it('keeps everything before the first attempt in one request-level group', () => {
    const groups = groupTimeline(timelineOf(liveOf([
      eventOf('route.resolved', 'info', { candidates: 1 }, 5),
      eventOf('attempt.start', 'info', { index: 0, providerModelName: 'model-one' }, 20),
    ])))

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ attemptNumber: 0, target: null, outcome: 'running' })
    expect(groups[0].nodes.map(node => node.message.kind)).toEqual(['received', 'routeResolved'])
  })

  it('starts a new group on every attempt.start and names its target', () => {
    const groups = groupTimeline(timelineOf(liveOf([
      eventOf('attempt.start', 'info', { index: 0, providerModelName: 'model-one' }, 20),
      eventOf('attempt.start', 'info', { index: 1, providerModelName: 'model-two' }, 400),
    ])))

    expect(groups.map(group => group.target)).toEqual([null, 'model-one', 'model-two'])
    expect(groups.map(group => group.startMilliseconds)).toEqual([0, 20, 400])
  })

  it('measures a group from its first to its last event', () => {
    const groups = groupTimeline(timelineOf(liveOf([
      eventOf('attempt.start', 'info', { index: 0, providerModelName: 'model-one' }, 20),
      eventOf('upstream.head', 'success', { attempt: 1, httpStatus: 200, disposition: 'success' }, 1_120),
      eventOf('request.completed', 'success', { httpStatus: 200, durationMilliseconds: 1_140 }, 1_140),
    ])))

    expect(groups[1]).toMatchObject({ startMilliseconds: 20, endMilliseconds: 1_140, outcome: 'succeeded' })
  })

  it('keeps the first outcome a group reaches, because a failure stays a failure', () => {
    // 第一次尝试失败后紧跟着「改试第二家」，整条请求最后是成功的——
    // 但第一段必须仍然是失败，否则「这家出过事」这件事就被结局抹平了。
    const groups = groupTimeline(timelineOf(liveOf([
      eventOf('attempt.start', 'info', { index: 0, providerModelName: 'model-one' }, 20),
      eventOf('route.failover', 'warn', { attempt: 1, httpStatus: 429, nextProviderModelName: 'model-two' }, 340),
      eventOf('attempt.start', 'info', { index: 1, providerModelName: 'model-two' }, 360),
      eventOf('request.completed', 'success', { httpStatus: 200, durationMilliseconds: 900 }, 900),
    ])))

    expect(groups.map(group => group.outcome)).toEqual(['running', 'failed', 'succeeded'])
  })

  it('treats a delivering upstream response as the attempt succeeding', () => {
    const groups = groupTimeline(timelineOf(liveOf([
      eventOf('attempt.start', 'info', { index: 0, providerModelName: 'model-one' }, 20),
      eventOf('upstream.head', 'success', { attempt: 1, httpStatus: 200, disposition: 'success' }, 300),
    ])))

    expect(groups[1].outcome).toBe('succeeded')
  })

  it('leaves the last attempt running when nothing has ended it yet', () => {
    const groups = groupTimeline(timelineOf(liveOf([
      eventOf('attempt.start', 'info', { index: 0, providerModelName: 'model-one' }, 20),
      eventOf('upstream.first-byte', 'success', { attempt: 1, ttftMilliseconds: 640 }, 660),
    ])))

    expect(groups[1].outcome).toBe('running')
  })

  it('returns nothing for an empty timeline', () => {
    expect(groupTimeline([])).toEqual([])
  })
})
