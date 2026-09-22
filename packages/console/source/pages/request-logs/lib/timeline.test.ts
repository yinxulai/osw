import { describe, expect, it } from 'vitest'
import type { LiveRequest, LiveRequestAttempt, LiveRequestEvent, LiveRequestEventLevel } from '@common/schemas'
import { timelineOf } from './timeline'

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
    requestBytes: 1_024,
    requestRewriteRuleNames: [],
    upstreamBytes: 4_096,
    downstreamBytes: 2_048,
    chunkCount: 3,
    chunkPreview: null,
    ttftMilliseconds: 120,
    inputTokens: 12,
    outputTokens: 42,
    errorCode: null,
    errorMessage: null,
    startedAt: 1_000,
    endedAt: null,
    ...overrides,
  }
}

type EventDetail = Record<string, string | number | boolean>

function eventOf(kind: string, level: LiveRequestEventLevel, detail: EventDetail | null, offset = 0): LiveRequestEvent {
  return { at: 1_000 + offset, offsetMilliseconds: offset, kind, level, detail }
}

function liveOf(events: LiveRequestEvent[], overrides: Partial<LiveRequest> = {}): LiveRequest {
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
    // 两次尝试：一次成功交付、一次被放弃，用来验「事件里的序号能不能查回是哪家上游」。
    // 第二次故意换了协议：`request.prepared` 只带一个布尔，两跳协议得从台账里读。
    // 它同时带了两个命中的修改器名字，用来验「多命中要点名而不是只报个数」。
    attempts: [
      attemptOf(),
      attemptOf({
        index: 1,
        providerName: 'Provider Two',
        providerModelName: 'model-two',
        endpointProtocol: 'anthropic-messages',
        requestRewriteRuleNames: ['Remove Date Suffix', 'Set Temperature'],
      }),
    ],
    events,
    ...overrides,
  }
}

/** 去掉合成出来的「收到请求」，只看事件本身翻出来的节点。 */
function eventMessagesOf(events: LiveRequestEvent[]): unknown[] {
  return timelineOf(liveOf(events)).slice(1).map(node => node.message)
}

/**
 * 时间轴是「进行中请求」那块面板的骨架：把台账里的事件翻成一列能顺读的事实。
 * 这里验的是翻译规则本身——谁翻成哪句话、序号怎么数、坏数据怎么办——而不是像素。
 */
describe('timelineOf', () => {
  it('starts with the request itself rather than with an event', () => {
    const nodes = timelineOf(liveOf([]))

    // 台账的 `begin` 不产生事件（那时连协议都还不知道），但读者需要一个起点。
    expect(nodes).toEqual([
      {
        key: 'received',
        offsetMilliseconds: 0,
        tone: 'neutral',
        message: { kind: 'received', method: 'POST', path: '/v1/responses' },
      },
    ])
  })

  it('keeps the order of the events and colours them by level', () => {
    const nodes = timelineOf(liveOf([
      eventOf('route.resolved', 'info', { candidates: 2 }, 5),
      eventOf('upstream.head', 'warn', { attempt: 2, httpStatus: 429 }, 300),
    ]))

    expect(nodes.map(node => node.offsetMilliseconds)).toEqual([0, 5, 300])
    expect(nodes.map(node => node.tone)).toEqual(['neutral', 'neutral', 'warn'])
  })

  it('numbers attempts for humans instead of for arrays', () => {
    // 契约里 `attempt.start` 的 `index` 是 0 起的，界面上从 1 数起。
    expect(eventMessagesOf([
      eventOf('attempt.start', 'info', { index: 1, providerModelName: 'model-two' }),
    ])).toEqual([
      { kind: 'attemptStart', providerModelName: 'model-two', attemptNumber: 2 },
    ])
  })

  it('resolves the upstream name from the attempt the event reports', () => {
    // `upstream.head` 带的是 1 起的尝试序号，名字要回台账里查——事件本身不带上游名。
    expect(eventMessagesOf([
      eventOf('upstream.head', 'success', { attempt: 2, httpStatus: 200, disposition: 'success' }),
      eventOf('upstream.head', 'warn', { attempt: 1, httpStatus: 200, transportMismatch: true }),
    ])).toEqual([
      {
        kind: 'upstreamHead',
        providerModelName: 'model-two',
        httpStatus: 200,
        disposition: 'success',
        mismatch: false,
        upstreamTransport: null,
        requestedTransport: 'http-stream',
      },
      {
        kind: 'upstreamHead',
        providerModelName: 'model-one',
        httpStatus: 200,
        disposition: null,
        mismatch: true,
        upstreamTransport: null,
        requestedTransport: 'http-stream',
      },
    ])
  })

  it('carries the upstream shape so a mismatch can be explained', () => {
    // 「形态不符」只说结论不够，得带上两边分别是什么，否则读者没法判断该改哪一边。
    expect(eventMessagesOf([
      eventOf('upstream.head', 'warn', {
        attempt: 1,
        httpStatus: 200,
        disposition: 'failover',
        upstreamTransport: 'http',
        transportMismatch: true,
      }),
    ])).toEqual([
      {
        kind: 'upstreamHead',
        providerModelName: 'model-one',
        httpStatus: 200,
        disposition: 'failover',
        mismatch: true,
        upstreamTransport: 'http',
        requestedTransport: 'http-stream',
      },
    ])
  })

  it('does not invent a disposition it cannot read', () => {
    // 读不出来就是读不出来：编一个「成功」会让界面把一次失败画成绿的。
    expect(eventMessagesOf([
      eventOf('upstream.head', 'success', { attempt: 1, httpStatus: 200, disposition: 'whatever' }),
    ])).toEqual([
      {
        kind: 'upstreamHead',
        providerModelName: 'model-one',
        httpStatus: 200,
        disposition: null,
        mismatch: false,
        upstreamTransport: null,
        requestedTransport: 'http-stream',
      },
    ])
  })

  it('reads the candidate chain in priority order', () => {
    // 候选名单比一个数字有用：它把「为何会试到第二家」提前写在了轴上。
    const nodes = timelineOf(liveOf(
      [eventOf('route.resolved', 'info', { candidates: 2 }, 5)],
      {
        candidates: [
          { providerId: 'prov_1', providerName: 'Provider One', providerModelId: 'model_1', providerModelName: 'model-one' },
          { providerId: 'prov_2', providerName: 'Provider Two', providerModelId: 'model_2', providerModelName: 'model-two' },
        ],
      },
    ))

    expect(nodes[1]?.message).toEqual({ kind: 'routeResolved', candidates: ['model-one', 'model-two'] })
  })

  it('describes what was rewritten for the attempt that was actually sent', () => {
    // 只有真的改过什么才有这一条（改写规则 / 协议转换），两跳协议与规则名都得回台账里取。
    expect(eventMessagesOf([
      eventOf('request.prepared', 'info', {
        attempt: 2,
        providerModelName: 'model-two',
        appliedRules: 2,
        protocolConverted: true,
        requestBytes: 4_096,
      }),
    ])).toEqual([
      {
        kind: 'prepared',
        requestBytes: 4_096,
        appliedRules: 2,
        appliedRuleNames: ['Remove Date Suffix', 'Set Temperature'],
        converted: true,
        protocolFrom: 'openai-responses',
        protocolTo: 'anthropic-messages',
      },
    ])
  })

  it('falls back to the count when the ledger has no rule names', () => {
    // 第一次尝试的台账里没带名字：这一格少几个字，但不能连「改过」这件事都不说。
    expect(eventMessagesOf([
      eventOf('request.prepared', 'info', { attempt: 1, appliedRules: 3, protocolConverted: false }),
    ])).toEqual([
      { kind: 'prepared', requestBytes: 0, appliedRules: 3, appliedRuleNames: [], converted: false, protocolFrom: 'openai-responses', protocolTo: 'openai-responses' },
    ])
  })

  it('reports the first byte against the attempt that produced it', () => {
    expect(eventMessagesOf([
      eventOf('upstream.first-byte', 'info', { attempt: 2, ttftMilliseconds: 640 }),
    ])).toEqual([
      { kind: 'firstByte', providerModelName: 'model-two', ttftMilliseconds: 640 },
    ])
  })

  it('survives an event whose detail is missing or of the wrong type', () => {
    // 快照是跨进程传过来的：某一格读不出来只该让那一行少几个字，不该让整条轴崩掉。
    expect(eventMessagesOf([
      eventOf('upstream.head', 'warn', null),
      eventOf('attempt.start', 'info', { index: '1' }),
      eventOf('route.resolved', 'info', {}),
      eventOf('upstream.first-byte', 'info', { attempt: 99 }),
      eventOf('request.prepared', 'info', { attempt: 'two' }),
    ])).toEqual([
      {
        kind: 'upstreamHead',
        providerModelName: null,
        httpStatus: null,
        disposition: null,
        mismatch: false,
        upstreamTransport: null,
        requestedTransport: 'http-stream',
      },
      { kind: 'attemptStart', providerModelName: null, attemptNumber: 1 },
      { kind: 'routeResolved', candidates: [] },
      { kind: 'firstByte', providerModelName: null, ttftMilliseconds: null },
      { kind: 'prepared', requestBytes: 0, appliedRules: 0, appliedRuleNames: [], converted: false, protocolFrom: 'openai-responses', protocolTo: null },
    ])
  })

  it('falls back from the status code to the error code when a request fails', () => {
    expect(eventMessagesOf([
      eventOf('request.failed', 'error', { attempt: 1, httpStatus: 502 }),
      eventOf('request.failed', 'error', { attempt: 1, errorCode: 'UPSTREAM_ERROR' }),
    ])).toEqual([
      { kind: 'failed', reason: 'HTTP 502' },
      { kind: 'failed', reason: 'UPSTREAM_ERROR' },
    ])
  })

  it('maps every terminal event onto a single sentence', () => {
    expect(eventMessagesOf([
      eventOf('request.completed', 'success', { attempt: 1, httpStatus: 200, durationMilliseconds: 3_000 }),
      eventOf('request.cancelled', 'warn', { attempt: 1 }),
      eventOf('request.aborted', 'warn', null),
      eventOf('request.rejected', 'error', { errorCode: 'BAD_REQUEST', httpStatus: 400 }),
      eventOf('request.rewrite_rejected', 'error', { errorCode: 'REWRITE_FAILED', httpStatus: 422 }),
      eventOf('request.exhausted', 'error', { attempts: 2, lastUpstreamStatus: 503 }),
    ])).toEqual([
      { kind: 'completed', httpStatus: 200, durationMilliseconds: 3_000 },
      { kind: 'cancelled' },
      { kind: 'cancelled' },
      { kind: 'rejected', errorCode: 'BAD_REQUEST' },
      { kind: 'rejected', errorCode: 'REWRITE_FAILED' },
      { kind: 'exhausted', attemptCount: 2, lastUpstreamStatus: 503 },
    ])
  })

  it('tells switching upstream apart from running out of candidates', () => {
    expect(eventMessagesOf([
      eventOf('route.failover', 'warn', { attempt: 1, httpStatus: 429, nextProviderModelName: 'model-two', healthFailureScope: 'provider' }),
      // 最后一跳没有下一家：事件里干脆不带这个键，而不是带一个 `null`。
      eventOf('route.failover', 'warn', { attempt: 2, httpStatus: 503, healthFailureScope: 'provider-model' }),
    ])).toEqual([
      { kind: 'attemptFailed', attemptNumber: 1, httpStatus: 429, healthScope: 'provider', nextProviderModelName: 'model-two' },
      { kind: 'attemptFailed', attemptNumber: 2, httpStatus: 503, healthScope: 'provider-model', nextProviderModelName: null },
    ])
  })

  it('reads an unrecognised health scope as “nothing to report”', () => {
    // 降级范围是枚举里多出来的取值时，宁可不提，也不要在界面上写出一个内部词。
    expect(eventMessagesOf([
      eventOf('route.failover', 'warn', { attempt: 1, httpStatus: 500, healthFailureScope: 'account' }),
    ])).toEqual([
      { kind: 'attemptFailed', attemptNumber: 1, httpStatus: 500, healthScope: 'none', nextProviderModelName: null },
    ])
  })

  it('keeps an unknown event visible instead of dropping it', () => {
    // 契约层加事件总是快过界面跟上：读不懂也要让人看见它发生过，并知道它叫什么。
    expect(eventMessagesOf([
      eventOf('request.something_new', 'info', { a: 1 }),
    ])).toEqual([
      { kind: 'raw', label: 'request.something_new' },
    ])
  })

  it('keeps keys unique when several events land on the same millisecond', () => {
    const nodes = timelineOf(liveOf([
      eventOf('attempt.start', 'info', { index: 0 }, 10),
      eventOf('attempt.start', 'info', { index: 1 }, 10),
    ]))

    expect(new Set(nodes.map(node => node.key)).size).toBe(nodes.length)
  })
})
