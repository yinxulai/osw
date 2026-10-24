import { describe, expect, it } from 'vitest'
import type { LiveRequest, LiveRequestAttempt, LiveRequestAttemptState } from './schemas'
import {
  activeRequestCount,
  computeLiveMetrics,
  DEFAULT_LIVE_METRIC_TEMPLATE,
  hasUnknownLiveMetricVariable,
  liveMetricVariablesOf,
  liveTps,
  LIVE_METRIC_UNAVAILABLE,
  LIVE_METRIC_VARIABLES,
  MAX_LIVE_METRIC_LENGTH,
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
    expect(liveTps([finished], 6000)).toBe(50)
  })

  it('stops showing a settled speed once it is older than the TTL', () => {
    const finished = settled(100, 0, 2000)
    // 落定后满 5 秒仍作数（边界含端点）……
    expect(liveTps([finished], 7000)).toBe(50)
    // ……越过时限就不再拿它充数：此刻并没有速度，如实回到 `--`。
    expect(liveTps([finished], 7001)).toBeNull()
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
    expect(liveTps([older, newer], 7000)).toBe(20)
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

describe('liveMetricVariablesOf', () => {
  // 这张清单同时是**设置界面的变量说明来源**，所以「引擎认识的变量」与「界面列出的变量」
  // 只能是同一份，否则用户照文档写出来的模板会被原样吐回来。
  it('把引擎认识的变量列成一张可穷尽的表', () => {
    expect(LIVE_METRIC_VARIABLES.map(variable => variable.name)).toEqual(['liveTps', 'activeRequests'])
    expect(LIVE_METRIC_VARIABLES.every(variable => variable.sample.length > 0)).toBe(true)
  })

  it('默认模板只用认识的变量，且它的取值示例就是变量清单里的那个', () => {
    expect(hasUnknownLiveMetricVariable(DEFAULT_LIVE_METRIC_TEMPLATE)).toBe(false)
    expect(liveMetricVariablesOf(DEFAULT_LIVE_METRIC_TEMPLATE)).toEqual(['liveTps'])
  })

  it('按出现顺序列出变量并去重', () => {
    expect(liveMetricVariablesOf('{activeRequests} · {liveTps} · {activeRequests}')).toEqual(['activeRequests', 'liveTps'])
  })

  it('没有占位符时返回空数组', () => {
    expect(liveMetricVariablesOf('')).toEqual([])
    expect(liveMetricVariablesOf('没有变量')).toEqual([])
    // `{}` 里没有名字，不算一个变量。
    expect(liveMetricVariablesOf('{}')).toEqual([])
  })

  it('未知变量照样列出来，供界面提示用户拼错了', () => {
    expect(liveMetricVariablesOf('{nope}')).toEqual(['nope'])
    expect(hasUnknownLiveMetricVariable('{nope}')).toBe(true)
  })

  it('认识的变量不算未知，掺杂未知的才判为未知', () => {
    expect(hasUnknownLiveMetricVariable('{liveTps} TPS')).toBe(false)
    expect(hasUnknownLiveMetricVariable('{liveTps} {activeRequests}')).toBe(false)
    expect(hasUnknownLiveMetricVariable('{liveTps} {liveTpsPerSecond}')).toBe(true)
  })

  // 判据只看 `{名字}` 的形状，不关心它出现在什么上下文里：模板是用户手写的自由文本。
  it('花括号外的东西不参与判定', () => {
    expect(hasUnknownLiveMetricVariable('TPS')).toBe(false)
    expect(liveMetricVariablesOf('TPS')).toEqual([])
  })
})

describe('renderLiveMetric 的收尾规则', () => {
  const metrics = computeLiveMetrics([inFlight('pending', 'streaming', 42, 0)], 1000)

  it('空模板与纯空白模板都返回空串（那是「不显示指标」）', () => {
    expect(renderLiveMetric('', metrics)).toBe('')
    expect(renderLiveMetric('   ', metrics)).toBe('')
    expect(renderLiveMetric('\n\t', metrics)).toBe('')
  })

  it('结果首尾去空白，但不动中间的空格', () => {
    expect(renderLiveMetric('  {liveTps} TPS  ', metrics)).toBe('42 TPS')
    expect(renderLiveMetric('{liveTps}   TPS', metrics)).toBe('42   TPS')
  })

  // 菜单栏是系统共享的、窗口角标也只是一条窄带，超长文本会把旁边的状态挤走。
  it('超过上限时直接截断，而不是把撑爆的字符串交给调用方', () => {
    const long = 'x'.repeat(MAX_LIVE_METRIC_LENGTH + 20)
    expect(renderLiveMetric(long, metrics)).toHaveLength(MAX_LIVE_METRIC_LENGTH)
    const exact = 'y'.repeat(MAX_LIVE_METRIC_LENGTH)
    expect(renderLiveMetric(exact, metrics)).toBe(exact)
  })

  // 顺序是「替换 → 去空白 → 截断」，三步都不能换：换一步就会切出不同的结果。
  it('先去空白再截断：前导空白不会把真正的内容挤出上限之外', () => {
    // 若先截断，前 64 个字符全是空格，去完空白剩空串。
    expect(renderLiveMetric(`${' '.repeat(70)}abc`, metrics)).toBe('abc')
  })

  it('先替换再截断：占位符展开后的内容才算进长度', () => {
    const rendered = renderLiveMetric(`{liveTps}${'b'.repeat(70)}`, metrics)
    expect(rendered).toHaveLength(MAX_LIVE_METRIC_LENGTH)
    // 若先截断，这里会是模板原文的 `{liveTps}...`。
    expect(rendered.startsWith('42')).toBe(true)
  })
})
