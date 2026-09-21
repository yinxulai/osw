import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDatabases, getDataDb, initDatabases } from './index'
import { createRequestAttempt, createRequestLog, recordAttemptUsage } from './request-log-store'
import { requestAttempts, requestLogs } from './data-schema'
import { getLatencyDistribution, getModelStats } from './analytics-store'

const EMPTY_USAGE = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null }

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-analytics-store-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

// TTFT 是「一次上游尝试」的事实，所以样本必须落在 request_attempts 上。
async function createLog(totalDurationMilliseconds = 1): Promise<string> {
  const log = await createRequestLog({
    logicalModelId: 'model_default',
    clientProtocol: 'openai-responses',
    transport: 'http',
    status: 'success',
    totalDurationMilliseconds,
  })
  return log.id
}

/** 构造一条带 TTFT 的尝试记录——TTFT 是尝试级事实，因此必须落在尝试行上。 */
type AttemptWithTtftInput = {
  requestId: string
  ttftMilliseconds: number
  providerId?: string
  attemptIndex?: number
}

async function createAttemptWithTtft(input: AttemptWithTtftInput): Promise<void> {
  await createRequestAttempt({
    requestId: input.requestId,
    providerId: input.providerId ?? 'prov_latency',
    providerModelId: 'model_default',
    providerName: 'latency-provider',
    providerModelName: 'model_default',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://example.com/v1/responses',
    status: 'success',
    httpStatus: 200,
    retryable: false,
    upstreamTransport: 'http',
    attemptIndex: input.attemptIndex ?? 0,
    durationMilliseconds: 1,
    ttftMilliseconds: input.ttftMilliseconds,
  })
}

async function createLogWithTtft(ttftMilliseconds: number, totalDurationMilliseconds = 1): Promise<void> {
  await createAttemptWithTtft({ requestId: await createLog(totalDurationMilliseconds), ttftMilliseconds })
}

describe('getLatencyDistribution', () => {
  // 桶宽由窗口 p95 推出，所以有一半断言在盯「档位怎么切」：这是这张图唯一会变的东西。
  it('groups near-neighbour TTFT samples into a single bucket and fills empty bins with zero', async () => {
    // 100ms 与 120ms 在感知上同属「首字很快」，不应被拆成两个桶。
    await createLogWithTtft(100)
    await createLogWithTtft(120)

    expect(await getLatencyDistribution(0, 6)).toEqual([
      { range: '< 25ms', count: 0 },
      { range: '25ms-50ms', count: 0 },
      { range: '50ms-75ms', count: 0 },
      { range: '75ms-100ms', count: 0 },
      { range: '100ms-125ms', count: 2 },
    ])
  })

  it('assigns samples sitting exactly on an edge to the higher bucket', async () => {
    for (const ttft of [49, 50, 99, 100, 199, 200, 5000]) {
      await createLogWithTtft(ttft)
    }

    // 7 个样本的 p95 是 200ms：50ms 一档，慢尾（5s）只占最后一个开口桶。
    expect(await getLatencyDistribution(0, 6)).toEqual([
      { range: '< 50ms', count: 1 },
      { range: '50ms-100ms', count: 2 },
      { range: '100ms-150ms', count: 1 },
      { range: '150ms-200ms', count: 1 },
      { range: '200ms-250ms', count: 1 },
      { range: '>= 250ms', count: 1 },
    ])
  })

  it('keeps the bin count within the target for the range', async () => {
    for (let index = 0; index < 40; index++) {
      await createLogWithTtft(100 + index * 250)
    }

    const buckets = await getLatencyDistribution(0, 6)
    expect(buckets.length).toBeLessThanOrEqual(6)
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(40)
    // 最右边那一段永远是真实样本：p95 之上留的余量不该以两根空柱收尾。
    expect(buckets[buckets.length - 1].count).toBeGreaterThan(0)
  })

  it('buckets by TTFT rather than by total duration', async () => {
    // 总耗时 8s 但首字很快：必须落在 TTFT 的早档，而不是「>= 5s」。
    await createLogWithTtft(120, 8_000)

    const nonEmpty = (await getLatencyDistribution(0, 6)).filter(bucket => bucket.count > 0)
    expect(nonEmpty).toEqual([{ range: '100ms-150ms', count: 1 }])
  })

  it('returns an empty distribution when no request carries a TTFT sample', async () => {
    await createRequestLog({
      logicalModelId: 'model_default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 10,
    })

    expect(await getLatencyDistribution(0, 6)).toEqual([])
  })

  it('excludes samples created before the requested time window', async () => {
    await createLogWithTtft(120)
    await createLogWithTtft(120)
    const staleId = getDataDb().select({ id: requestLogs.id }).from(requestLogs).all()[0].id
    getDataDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(100, staleId)

    const nonEmpty = (await getLatencyDistribution(1_000, 6)).filter(bucket => bucket.count > 0)
    expect(nonEmpty).toEqual([{ range: '100ms-150ms', count: 1 }])
  })

  it('attributes each TTFT sample to the provider that actually produced it', async () => {
    // 一次转移请求尝试过两个提供方，样本必须各归各家，而不是同时计入两家。
    const requestId = await createLog()
    await createAttemptWithTtft({ requestId, ttftMilliseconds: 120, providerId: 'prov_first', attemptIndex: 0 })
    await createAttemptWithTtft({ requestId, ttftMilliseconds: 300, providerId: 'prov_second', attemptIndex: 1 })

    expect((await getLatencyDistribution(0, 6, 'prov_first')).filter(bucket => bucket.count > 0)).toEqual([{ range: '100ms-150ms', count: 1 }])
    expect((await getLatencyDistribution(0, 6, 'prov_second')).filter(bucket => bucket.count > 0)).toEqual([{ range: '300ms-400ms', count: 1 }])
  })
})

describe('getModelStats', () => {
  interface RankedAttemptInput {
    providerId: string
    providerName: string
    status?: 'success' | 'failed'
    durationMilliseconds?: number
    ttftMilliseconds?: number | null
  }

  /** 造一条归属确定的尝试，以便控制排行榜里的「同一模型、不同提供方快照」。 */
  async function createRankedAttempt(input: RankedAttemptInput): Promise<string> {
    const requestId = await createLog()
    await createRequestAttempt({
      requestId,
      providerId: input.providerId,
      providerModelId: 'model_ranking',
      providerName: input.providerName,
      providerModelName: 'ranking-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      status: input.status ?? 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      durationMilliseconds: input.durationMilliseconds ?? 10,
      ttftMilliseconds: input.ttftMilliseconds ?? null,
    })
    return requestId
  }

  function attemptIdOf(requestId: string): string {
    return getDataDb().select({ id: requestAttempts.id }).from(requestAttempts).where(eq(requestAttempts.requestId, requestId)).all()[0].id
  }

  it('keeps one row per upstream model even when older attempts carry a stale provider snapshot', async () => {
    // 一个 providerModelId 只属于一个提供方：旧快照代表的是同一个模型的不同时期，
    // 而不是排行榜上的两个模型（否则同一个模型会占掉两个 TOP 名额）。
    await createRankedAttempt({ providerId: 'prov_stale', providerName: '旧提供方' })
    await createRankedAttempt({ providerId: 'prov_current', providerName: '现提供方' })

    const stats = await getModelStats(0)
    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({ providerModelId: 'model_ranking', attempts: 2 })
  })

  it('describes the model with the provider snapshot of its latest attempt', async () => {
    // 模型名与提供方必须来自同一条记录：不能出现「A 家的 id 配 B 家的名字」。
    await createRankedAttempt({ providerId: 'prov_current', providerName: '现提供方' })
    const staleRequestId = await createRankedAttempt({ providerId: 'prov_stale', providerName: '旧提供方' })
    const staleAttemptId = getDataDb().select({ id: requestAttempts.id }).from(requestAttempts).where(eq(requestAttempts.requestId, staleRequestId)).all()[0].id
    getDataDb().$client.prepare('UPDATE request_attempts SET createdTime = ? WHERE id = ?').run(1, staleAttemptId)

    expect(await getModelStats(0)).toEqual([
      expect.objectContaining({ providerId: 'prov_current', providerName: '现提供方', providerModelName: 'ranking-model', attempts: 2 }),
    ])
  })

  it('orders the ranking deterministically when attempt counts tie', async () => {
    await createRankedAttempt({ providerId: 'prov_a', providerName: 'A' })
    const otherRequestId = await createLog()
    await createRequestAttempt({
      requestId: otherRequestId,
      providerId: 'prov_b',
      providerModelId: 'model_ranking_b',
      providerName: 'B',
      providerModelName: 'ranking-model-b',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      durationMilliseconds: 10,
    })

    const first = await getModelStats(0)
    const second = await getModelStats(0)
    expect(first.map(stat => stat.providerModelId)).toEqual(['model_ranking', 'model_ranking_b'])
    expect(second.map(stat => stat.providerModelId)).toEqual(first.map(stat => stat.providerModelId))
  })

  it('measures speed over the whole attempt duration, and keeps numerator and denominator on the same samples', async () => {
    // 四条尝试里只有前两条能算出速度：
    // 1) 2000ms 耗时、500ms 首字 → 分母是整段 2000ms（首字等待不扣），20 Token；
    // 2) 800ms 耗时、800ms 首字 → 旧口径会把分母扣成 0 再除出天文数字，现在分母就是 800ms，24 Token；
    // 3) 没有输出 Token → 没有分子，耗时也不进分母；
    // 4) 失败的尝试 → 没有完整输出，整个样本都不该参与。
    const normalId = await createRankedAttempt({ providerId: 'prov_speed', providerName: '速度提供方', durationMilliseconds: 2000, ttftMilliseconds: 500 })
    const waitedId = await createRankedAttempt({ providerId: 'prov_speed', providerName: '速度提供方', durationMilliseconds: 800, ttftMilliseconds: 800 })
    const emptyId = await createRankedAttempt({ providerId: 'prov_speed', providerName: '速度提供方', durationMilliseconds: 600 })
    const failedId = await createRankedAttempt({ providerId: 'prov_speed', providerName: '速度提供方', status: 'failed', durationMilliseconds: 3000 })
    await recordAttemptUsage({ attemptId: attemptIdOf(normalId), servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20 })
    await recordAttemptUsage({ attemptId: attemptIdOf(waitedId), servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 24 })
    await recordAttemptUsage({ attemptId: attemptIdOf(emptyId), servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: null })
    await recordAttemptUsage({ attemptId: attemptIdOf(failedId), servesRequest: false, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 999 })

    const [stats] = await getModelStats(0)
    // 分母是 2000 + 800，不是扣首字之后的 1500 + 0，也不是四次尝试相加。
    expect(stats.speedOutputTokens).toBe(44)
    expect(stats.speedDurationMs).toBe(2800)
  })
})
