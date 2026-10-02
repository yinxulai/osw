import { describe, expect, it } from 'vitest'
import type { LiveRequest, LiveRequestAttempt, LiveRequestAttemptState } from './schemas'
import {
  activeRequestCount,
  computeLiveMetrics,
  DEFAULT_LIVE_METRIC_TEMPLATE,
  liveTps,
  LIVE_METRIC_UNAVAILABLE,
  renderLiveMetric,
} from './live-metrics'

function attempt(overrides: Partial<LiveRequestAttempt> = {}): LiveRequestAttempt {
  return {
    index: 0,
    providerId: 'prov_1',
    providerName: 'Provider',
    providerModelId: 'pm_1',
    providerModelName: 'model-1',
    endpointProtocol: 'openai-completions',
    url: 'https://example.com/v1',
    state: 'streaming',
    httpStatus: 200,
    upstreamTransport: 'http-stream',
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
    startedAt: 0,
    endedAt: null,
    ...overrides,
  }
}

function request(overrides: Partial<LiveRequest> = {}): LiveRequest {
  return {
    id: 'req_test',
    status: 'pending',
    phase: 'streaming',
    logicalModelId: 'logical_primary',
    clientProtocol: 'openai-completions',
    transport: 'http-stream',
    method: 'POST',
    path: '/v1/chat/completions',
    startedAt: 0,
    updatedAt: 0,
    endedAt: null,
    candidates: [],
    attempts: [],
    events: [],
    ...overrides,
  }
}

/** 一条在途请求，最后一次尝试进入了给定状态。 */
function inFlight(requestState: 'pending' | 'success', attemptState: LiveRequestAttemptState, outputTokens: number | null, startedAt: number): LiveRequest {
  return request({
    status: requestState,
    startedAt,
    attempts: [attempt({ state: attemptState, outputTokens, startedAt })],
  })
}

/** 一条已落定请求：尝试耗时段已冻结，速度是个定值。 */
function settled(outputTokens: number | null, startedAt: number, endedAt: number, requestEndedAt: number = endedAt): LiveRequest {
  return request({
    status: 'success',
    startedAt,
    endedAt: requestEndedAt,
    attempts: [attempt({ state: 'success', outputTokens, startedAt, endedAt })],
  })
}

describe('liveTps', () => {
  it('divides the output tokens of the latest attempt by the whole attempt duration', () => {
    // 42 Token / 1 秒 = 42 TPS。
    expect(liveTps([inFlight('pending', 'streaming', 42, 0)], 1000)).toBe(42)
    // 分母是整段尝试耗时，不是扣掉首字之后的那一段。
    expect(liveTps([inFlight('pending', 'streaming', 1000, 0)], 2000)).toBe(500)
  })

  it('has no speed before the upstream reports any output token', () => {
    expect(liveTps([inFlight('pending', 'streaming', null, 0)], 1000)).toBeNull()
    expect(liveTps([inFlight('pending', 'streaming', 0, 0)], 1000)).toBeNull()
  })

  it('has no speed when there is no in-flight request', () => {
    expect(liveTps([], 1000)).toBeNull()
    expect(liveTps([inFlight('success', 'success', 42, 0)], 1000)).toBeNull()
  })

  it('reads the most recently started in-flight request, not the fastest or the sum', () => {
    const now = 1000
    const requests = [
      // 更早开始的一条：很快，但不该被选中。
      inFlight('pending', 'streaming', 9999, 0),
      // 最近开始的一条：回答「我刚发的那条现在多快」。
      inFlight('pending', 'streaming', 100, 500),
    ]
    // 100 Token / 0.5 秒 = 200 TPS（旧那条是 9999，取最大就会选错）。
    expect(liveTps(requests, now)).toBe(200)
  })

  it('reads the latest attempt when a request failed over', () => {
    const request = (): LiveRequest => ({
      ...inFlight('pending', 'streaming', 0, 0),
      attempts: [
        attempt({ state: 'failed', outputTokens: 9999, startedAt: 0 }),
        attempt({ state: 'streaming', outputTokens: 100, startedAt: 0 }),
      ],
    })
    // 只认最新一次尝试：100 / 1 秒 = 100 TPS，被放弃那次不参与。
    expect(liveTps([request()], 1000)).toBe(100)
  })

  it('falls back to the most recent settled request speed when nothing is in flight', () => {
    // 内存里最近一条已落定请求跑出 100 Token / 2 秒 = 50 TPS。
    const finished = settled(100, 0, 2000)
    // 没有在途请求：不返回 null，而是回落到刚跑完那条的最终速度。
    expect(liveTps([finished], 9000)).toBe(50)
  })

  it('prefers the in-flight speed over any settled fallback', () => {
    const finished = settled(100, 0, 2000)
    const running = inFlight('pending', 'streaming', 42, 0)
    // 有在途请求时只认它的实时速度，不回落到已落定那条。
    expect(liveTps([finished, running], 1000)).toBe(42)
  })

  it('falls back to the most recently settled request among several', () => {
    // 两条都落定：一条更早结束（速度更高），一条刚结束（速度更低）。按结束时间取最近的那条。
    const older = settled(9000, 0, 1000, 1000)
    const newer = settled(60, 0, 3000, 3000)
    expect(liveTps([older, newer], 9000)).toBe(20)
  })

  it('stays null when no settled request yields a speed either', () => {
    // 内存里只剩一条落定、但上游没报输出 Token 的请求：没有速度可言。
    expect(liveTps([settled(null, 0, 1000)], 9000)).toBeNull()
    // 上游报了 0：分子为零，仍然没有速度。
    expect(liveTps([settled(0, 0, 1000)], 9000)).toBeNull()
  })
})

describe('computeLiveMetrics', () => {
  it('aggregates the latest in-flight speed and the active count', () => {
    const now = 1000
    const metrics = computeLiveMetrics([
      inFlight('pending', 'streaming', 42, 0),
      inFlight('pending', 'awaiting-upstream', 7, 0),
      // 请求已落定：不参与速度，也不计入并发。
      inFlight('success', 'success', 9000, 0),
    ], now)

    // 最近开始的一条（42）出速度；7 那条不出现——没有合计，也没有取最大。
    expect(metrics.liveTps).toBe(42)
    expect(metrics.activeRequests).toBe(2)
  })

  it('reports no speed when nothing is in flight', () => {
    const metrics = computeLiveMetrics([inFlight('success', 'success', 42, 0)], 1000)
    expect(metrics.liveTps).toBeNull()
    expect(metrics.activeRequests).toBe(0)
  })

  it('counts a request that just connected even before any token flowed', () => {
    // `connecting` 算「正在进行」，但还没有输出 Token，所以没有速度。
    const metrics = computeLiveMetrics([inFlight('pending', 'connecting', null, 0)], 1000)
    expect(metrics.activeRequests).toBe(1)
    expect(metrics.liveTps).toBeNull()
  })
})

describe('activeRequestCount', () => {
  it('counts connecting, awaiting-upstream and streaming but not settled', () => {
    const count = activeRequestCount([
      inFlight('pending', 'connecting', null, 0),
      inFlight('pending', 'awaiting-upstream', null, 0),
      inFlight('pending', 'streaming', null, 0),
      inFlight('success', 'success', null, 0),
      inFlight('pending', 'failed', null, 0),
    ])
    expect(count).toBe(3)
  })
})

describe('renderLiveMetric', () => {
  it('renders the speed with the TPS unit from the template', () => {
    const metrics = computeLiveMetrics([inFlight('pending', 'streaming', 42, 0)], 1000)
    expect(renderLiveMetric('{liveTps} TPS', metrics)).toBe('42 TPS')
  })

  it('keeps one decimal below ten, like every other output-speed surface', () => {
    const metrics = computeLiveMetrics([inFlight('pending', 'streaming', 45, 0)], 10000)
    // 45 Token / 10 秒 = 4.5 TPS
    expect(renderLiveMetric('{liveTps} TPS', metrics)).toBe('4.5 TPS')
  })

  it('writes the placeholder when there is no in-flight speed', () => {
    const metrics = computeLiveMetrics([], 1000)
    expect(renderLiveMetric('{liveTps} TPS', metrics)).toBe(`${LIVE_METRIC_UNAVAILABLE} TPS`)
  })

  it('renders the default template end to end', () => {
    const metrics = computeLiveMetrics([inFlight('pending', 'streaming', 42, 0)], 1000)
    expect(renderLiveMetric(DEFAULT_LIVE_METRIC_TEMPLATE, metrics)).toBe('42 TPS')
  })

  it('keeps an unknown variable verbatim', () => {
    const metrics = computeLiveMetrics([], 1000)
    expect(renderLiveMetric('{nope}', metrics)).toBe('{nope}')
  })

  it('renders active requests and the speed together', () => {
    const metrics = computeLiveMetrics([
      inFlight('pending', 'streaming', 42, 1000),
      inFlight('pending', 'streaming', 84, 0),
    ], 1000)
    // 最近开始的一条是 42（startedAt=1000），42 / 0 秒不可算 → 占位符。
    // 这里刻意让最近那条不可算，验证并发数照样渲染。
    expect(renderLiveMetric('{activeRequests} req · {liveTps} TPS', metrics)).toBe('2 req · -- TPS')
  })
})
