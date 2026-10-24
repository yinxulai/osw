import { describe, expect, it } from 'vitest'
import type { RequestLogEntry } from './schemas'
import {
  averageOutputTokensPerCall,
  averageOutputTokensPerSecond,
  cacheHitRate,
  failoverDurationOf,
  firstTokenShareOf,
  formatAverageOutput,
  formatMilliseconds,
  formatOutputSpeed,
  formatTokenCount,
  formatTokenCountParts,
  magnitudeDecimalPlaces,
  millisecondsDisplayParts,
  outputSpeedDecimalPlaces,
  outputSpeedSampleOf,
  outputTokensPerSecond,
  requestOutputTokensPerSecond,
  servingAttemptOf,
  tokensPerSecondFromTotals,
} from './metrics'

interface LogOverrides {
  outputTokens?: number | null
  totalDurationMilliseconds?: number
  ttftMilliseconds?: number | null
  attempts?: Array<{ durationMilliseconds: number; ttftMilliseconds: number | null }>
}

function logOf(overrides: LogOverrides = {}): RequestLogEntry {
  return {
    id: 'req_test',
    apiKeyId: null,
    logicalModelId: 'default',
    clientProtocol: 'openai-responses',
    transport: 'http-stream',
    status: 'success',
    totalDurationMilliseconds: overrides.totalDurationMilliseconds ?? 0,
    totalTokens: null,
    inputTokens: null,
    reasoningTokens: null,
    outputTokens: overrides.outputTokens ?? null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    rawUsage: null,
    ttftMilliseconds: overrides.ttftMilliseconds ?? null,
    createdTime: 0,
    attempts: (overrides.attempts ?? []).map((attempt, index) => ({
      id: `att_test_${index}`,
      attemptIndex: index,
      status: 'success',
      providerId: 'prov_test',
      providerName: 'Provider Test',
      providerModelId: 'model_test',
      providerModelName: 'model-test',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http-stream',
      ttftMilliseconds: attempt.ttftMilliseconds,
      requestRewriteRuleIds: [],
      responseRewriteRuleIds: [],
      errorCode: null,
      errorMessage: null,
      durationMilliseconds: attempt.durationMilliseconds,
      createdTime: 0,
    })),
  }
}

describe('tokens per second', () => {
  it('divides output tokens by the whole attempt duration in seconds', () => {
    expect(tokensPerSecondFromTotals(1500, 1500)).toBe(1000)
    expect(tokensPerSecondFromTotals(120, 5000)).toBe(24)
  })

  it('reports no speed when the duration is not positive', () => {
    // 这不是「极快」，是没有速度。分母趋近 0 除出天文数字，就是这个 bug 的来源。
    expect(tokensPerSecondFromTotals(100, 0)).toBeNull()
    expect(tokensPerSecondFromTotals(100, -400)).toBeNull()
  })

  it('reports no speed when nothing was generated', () => {
    expect(tokensPerSecondFromTotals(0, 5000)).toBeNull()
    expect(tokensPerSecondFromTotals(-1, 5000)).toBeNull()
  })
})

describe('per-attempt output speed', () => {
  it('measures against the whole attempt, first-token wait included', () => {
    // 20 Token / 2000ms = 10：首字延迟不参与速度，只由 TTFT 自己回答。
    expect(outputTokensPerSecond({ outputTokens: 20, attemptDurationMilliseconds: 2000 })).toBeCloseTo(10, 6)
  })

  it('keeps the reasoning tokens in the numerator while keeping the time that produced them in the denominator', () => {
    // 8000ms 思考出 8000 个推理 Token，再用 2000ms 出 200 个正文 Token。
    // 旧口径减掉首字后是 8200 / 2s = 4100 TPS；推理 Token 的时间被挖走了，分子分母不同源。
    expect(outputTokensPerSecond({ outputTokens: 8200, attemptDurationMilliseconds: 10_000 })).toBeCloseTo(820, 6)
  })

  it('does not turn a first token that ate the whole attempt into a huge speed', () => {
    // 427 Token 全部在 483ms 内到达：整段耗时就是正确分母，读成 884 TPS 是这个模型真实的表现，
    // 而不是旧口径里「除以 0ms 得到的天文数字」。
    expect(outputTokensPerSecond({ outputTokens: 427, attemptDurationMilliseconds: 483 })).toBeCloseTo(884.06, 2)
  })

  it('reports no speed when the attempt has no measurable duration', () => {
    expect(outputTokensPerSecond({ outputTokens: 427, attemptDurationMilliseconds: 0 })).toBeNull()
  })

  it('reports no speed when the request has no token count', () => {
    expect(outputTokensPerSecond({ outputTokens: null, attemptDurationMilliseconds: 2000 })).toBeNull()
  })
})

describe('average output speed', () => {
  it('adds tokens and durations first, then divides once', () => {
    // 两条样本各自的单请求速度是 1000 与 200，算术平均会得到 600。
    // 但快的那条只产出 10 个 Token，慢的那条产出了 5000 个：代价要按 Token 加权。
    const fast = { outputTokens: 10, attemptDurationMilliseconds: 10 }
    const slow = { outputTokens: 5000, attemptDurationMilliseconds: 25_000 }
    expect(outputTokensPerSecond(fast)).toBe(1000)
    expect(outputTokensPerSecond(slow)).toBe(200)
    expect(averageOutputTokensPerSecond([fast, slow])).toBeCloseTo(5010 / 25.01, 6)
  })

  it('skips samples that have no speed of their own, in the numerator and the denominator alike', () => {
    const samples = [
      { outputTokens: 20, attemptDurationMilliseconds: 2000 },
      { outputTokens: null, attemptDurationMilliseconds: 1000 },
      { outputTokens: 300, attemptDurationMilliseconds: 0 },
      { outputTokens: 0, attemptDurationMilliseconds: 1000 },
    ]
    // 只有第一条够格：另外三条的 Token 一个也没进分子，对应的耗时也没进分母。
    expect(averageOutputTokensPerSecond(samples)).toBeCloseTo(10, 6)
  })

  it('reports no speed when no sample qualifies', () => {
    expect(averageOutputTokensPerSecond([])).toBeNull()
    expect(averageOutputTokensPerSecond([{ outputTokens: null, attemptDurationMilliseconds: 1000 }])).toBeNull()
  })
})

describe('request-level output speed', () => {
  it('reads the last attempt, which is the one the client actually got', () => {
    const log = logOf({
      outputTokens: 50,
      totalDurationMilliseconds: 99_999,
      ttftMilliseconds: 11,
      attempts: [
        { durationMilliseconds: 3000, ttftMilliseconds: 900 },
        { durationMilliseconds: 2000, ttftMilliseconds: 200 },
      ],
    })
    expect(servingAttemptOf(log)?.durationMilliseconds).toBe(2000)
    expect(outputSpeedSampleOf(log)).toEqual({ outputTokens: 50, attemptDurationMilliseconds: 2000 })
    // 请求级总耗时含上游重试，不能当分母：是 50 / 2s，不是 50 / 99.999s。
    expect(requestOutputTokensPerSecond(log)).toBeCloseTo(25, 6)
  })

  it('falls back to the request-level numbers when no attempt was recorded', () => {
    const log = logOf({ outputTokens: 40, totalDurationMilliseconds: 2000, ttftMilliseconds: 500 })
    expect(servingAttemptOf(log)).toBeNull()
    expect(outputSpeedSampleOf(log)).toEqual({ outputTokens: 40, attemptDurationMilliseconds: 2000 })
    expect(requestOutputTokensPerSecond(log)).toBeCloseTo(20, 6)
  })
})

describe('milliseconds display', () => {
  it('writes milliseconds below a second and seconds above it', () => {
    expect(formatMilliseconds(0)).toBe('0ms')
    expect(formatMilliseconds(999)).toBe('999ms')
    expect(formatMilliseconds(1000)).toBe('1.0s')
    expect(formatMilliseconds(1250)).toBe('1.3s')
    expect(formatMilliseconds(2000)).toBe('2.0s')
  })

  it('writes a dash, not a zero, when there is no sample', () => {
    expect(formatMilliseconds(null)).toBe('—')
    expect(formatMilliseconds(undefined)).toBe('—')
    expect(formatMilliseconds(Number.NaN)).toBe('—')
  })

  it('hands animations the same split between unit and decimals', () => {
    expect(millisecondsDisplayParts(999)).toEqual({ value: 999, decimalPlaces: 0, unit: 'ms' })
    expect(millisecondsDisplayParts(1000)).toEqual({ value: 1, decimalPlaces: 1, unit: 's' })
    expect(millisecondsDisplayParts(1250)).toEqual({ value: 1.25, decimalPlaces: 1, unit: 's' })
  })
})

describe('output speed display', () => {
  it('keeps one decimal below ten and rounds above it', () => {
    expect(formatOutputSpeed(9.6)).toBe('9.6')
    expect(formatOutputSpeed(10)).toBe('10')
    expect(formatOutputSpeed(24)).toBe('24')
    expect(formatOutputSpeed(24.4)).toBe('24')
  })

  it('writes a dash when there is no speed', () => {
    expect(formatOutputSpeed(null)).toBe('—')
    expect(formatOutputSpeed(undefined)).toBe('—')
    expect(formatOutputSpeed(Number.NaN)).toBe('—')
  })

  it('exposes the decimal rule so animated numbers match the text', () => {
    expect(outputSpeedDecimalPlaces(9.6)).toBe(1)
    expect(outputSpeedDecimalPlaces(10)).toBe(0)
  })
})

describe('token count display', () => {
  it('leaves four-digit counts alone and compacts from five digits up', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(1)).toBe('1')
    expect(formatTokenCount(999)).toBe('999')
    // 阈值取 10000：`9.7k` 与 `9700` 一样长，但前者多一次心算。
    expect(formatTokenCount(9_700)).toBe('9700')
    expect(formatTokenCount(9_999)).toBe('9999')
    expect(formatTokenCount(10_000)).toBe('10.0k')
    expect(formatTokenCount(12_345)).toBe('12.3k')
  })

  it('counts in thousands, not in binary units', () => {
    // Token 是数的，不是存储量：这里没有 `formatBytes` 的 1024 换算。
    expect(formatTokenCount(1024)).toBe('1024')
    expect(formatTokenCount(102_400)).toBe('102.4k')
  })

  it('splits value from suffix so the suffix can be styled apart', () => {
    expect(formatTokenCountParts(9700)).toEqual({ value: '9700', suffix: '' })
    expect(formatTokenCountParts(12_345)).toEqual({ value: '12.3', suffix: 'k' })
  })

  it('writes a dash, not a zero, when the upstream reported no usage', () => {
    expect(formatTokenCount(null)).toBe('—')
    expect(formatTokenCount(undefined)).toBe('—')
    expect(formatTokenCount(Number.NaN)).toBe('—')
    expect(formatTokenCountParts(null)).toBeNull()
  })
})

describe('average output per call', () => {
  it('divides total output tokens by the call count', () => {
    expect(averageOutputTokensPerCall(3400, 10)).toBeCloseTo(340, 6)
    expect(averageOutputTokensPerCall(0, 10)).toBe(0)
  })

  it('returns null instead of zero when there were no calls', () => {
    expect(averageOutputTokensPerCall(500, 0)).toBeNull()
  })

  it('serves both calibers: window totals and one model row', () => {
    // 请求级：分子是全部输出之和、分母是全部请求（不区分成功与否），两者同一批样本。
    expect(averageOutputTokensPerCall(800, 10)).toBeCloseTo(80, 6)
    // 模型行：分子只含成功调用的输出，分母就必须是成功调用数。
    expect(averageOutputTokensPerCall(800, 8)).toBeCloseTo(100, 6)
  })

  it('keeps one decimal below ten and rounds above it', () => {
    expect(formatAverageOutput(8.34)).toBe('8.3')
    expect(formatAverageOutput(80.34)).toBe('80')
  })

  it('writes a dash, not a zero, when there is no sample', () => {
    expect(formatAverageOutput(null)).toBe('—')
    expect(formatAverageOutput(undefined)).toBe('—')
    expect(formatAverageOutput(Number.NaN)).toBe('—')
  })

  it('shares the magnitude rule with the output speed', () => {
    expect(magnitudeDecimalPlaces(9.9)).toBe(1)
    expect(magnitudeDecimalPlaces(10)).toBe(0)
    expect(magnitudeDecimalPlaces(1_200)).toBe(0)
  })
})

describe('cache hit rate', () => {
  it('divides cached input tokens by the total input tokens', () => {
    expect(cacheHitRate(300, 1000)).toBeCloseTo(0.3, 6)
  })

  it('returns zero when input was read but nothing was cached', () => {
    expect(cacheHitRate(0, 1000)).toBe(0)
  })

  it('returns null instead of zero when there was no input', () => {
    expect(cacheHitRate(0, 0)).toBeNull()
  })
})

// 「等第一个字」占整条请求的比重：与速度分别堵住时间轴的两端。
describe('first token share', () => {
  it('divides the first-token wait by the request total duration', () => {
    const log = logOf({ totalDurationMilliseconds: 2_000, ttftMilliseconds: 500 })

    expect(firstTokenShareOf(log)).toBeCloseTo(0.25, 6)
  })

  it('uses the request total duration, not the serving attempt duration', () => {
    // 客户端等的是整条链路：尝试只占 1000ms，前面还有被放弃的那段也在等。
    const log = logOf({
      totalDurationMilliseconds: 4_000,
      ttftMilliseconds: 1_000,
      attempts: [{ durationMilliseconds: 1_000, ttftMilliseconds: 1_000 }],
    })

    expect(firstTokenShareOf(log)).toBeCloseTo(0.25, 6)
  })

  it('returns null when there is no first-token sample', () => {
    expect(firstTokenShareOf(logOf({ totalDurationMilliseconds: 1_000 }))).toBeNull()
  })

  it('returns null when the request has no measurable duration', () => {
    expect(firstTokenShareOf(logOf({ totalDurationMilliseconds: 0, ttftMilliseconds: 0 }))).toBeNull()
  })

  it('returns null rather than a share above one when the wait exceeds the total', () => {
    // 两侧计时起点不同会造出这种测量边界；它不能写成一个超过 100% 的比值。
    const log = logOf({ totalDurationMilliseconds: 800, ttftMilliseconds: 900 })

    expect(firstTokenShareOf(log)).toBeNull()
  })

  it('reports a genuinely immediate first token as zero', () => {
    const log = logOf({ totalDurationMilliseconds: 2_000, ttftMilliseconds: 0 })

    expect(firstTokenShareOf(log)).toBe(0)
  })
})

// 被放弃的尝试吃掉的时间：同一个总耗时，「上游慢」与「重试在救」是两回事。
describe('failover duration', () => {
  it('sums the attempts that were abandoned before delivery', () => {
    const log = logOf({
      totalDurationMilliseconds: 8_000,
      attempts: [
        { durationMilliseconds: 2_500, ttftMilliseconds: null },
        { durationMilliseconds: 3_500, ttftMilliseconds: null },
        { durationMilliseconds: 2_000, ttftMilliseconds: 120 },
      ],
    })

    // 只有前两条是被放弃的；服务请求的最后一条不属于「重试」。
    expect(failoverDurationOf(log)).toBe(6_000)
  })

  it('returns zero when the first attempt delivered', () => {
    const log = logOf({
      totalDurationMilliseconds: 1_200,
      attempts: [{ durationMilliseconds: 1_000, ttftMilliseconds: 120 }],
    })

    // 零不是「没测到」：一次就通是真实的测得零。
    expect(failoverDurationOf(log)).toBe(0)
  })

  it('returns null when the request never reached an attempt', () => {
    expect(failoverDurationOf(logOf({ totalDurationMilliseconds: 5 }))).toBeNull()
  })
})
