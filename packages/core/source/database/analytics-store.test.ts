import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDatabases, getDataDb, initDatabases } from './index'
import { createRequestAttempt, createRequestLog, recordAttemptUsage } from './request-log-store'
import { requestAttempts, requestLogs } from './data-schema'
import { createProvider, deleteProvider, listProviders } from './provider-store'
import { createProviderModelRoute, deleteProviderModelRoute, listProviderModelRoutes } from './model-store'
import { getLatencyDistribution, getModelStats, getProviderStat, getProviderStats } from './analytics-store'

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

/**
 * 统计查询读的是**尝试行上的快照**（`providerId` / `providerName` / `providerModelId` /
 * `providerModelName`），它们是在请求发生时写下的，不是对配置表的一次实时 join。
 *
 * 这一组用例把这句话变成可执行的事实：配置行软删除之后，同样的查询必须给出同样的数字。
 * 删配置只该让一个供应商 / 模型退出「可被调度」的名单，不该让观测页面上已经发生过的历史
 * 跟着蒸发——用户删掉一个不用的供应商，恰恰还要回头核对它以前花了多少。
 */
describe('analytics is unaffected by deleted configuration', () => {
  interface DeletedFixture {
    requestId: string
    attemptId: string
    providerId: string
    providerName: string
    providerModelId: string
    providerModelName: string
  }

  /** 造一条「配置 + 一次成功尝试 + 用量」的完整事实，返回值用于删除后比对。 */
  async function createAttributedTraffic(): Promise<DeletedFixture> {
    const provider = await createProvider({ name: '要删掉的供应商', apiKeyReference: 'key_deleted_analytics', timeoutMilliseconds: 30_000, enabled: true })
    const model = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'deleted-model',
      priority: 1,
      endpoints: [{ protocol: 'openai-responses', endpointUrl: 'https://example.com/v1/responses', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const requestId = await createLog()
    const attempt = await createAttemptOrThrow({
      requestId,
      providerId: provider.id,
      providerModelId: model.id,
      providerName: provider.name,
      providerModelName: model.modelName,
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      durationMilliseconds: 1,
      ttftMilliseconds: 120,
    })
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20, cachedInputTokens: 25 })
    return { requestId, attemptId: attempt.id, providerId: provider.id, providerName: provider.name, providerModelId: model.id, providerModelName: model.modelName }
  }

  /** 同一请求的同一次序号只能落一行，冲突时 store 返回 `null`。 */
  async function createAttemptOrThrow(input: Parameters<typeof createRequestAttempt>[0]) {
    const attempt = await createRequestAttempt(input)
    if (!attempt) throw new Error('expected attempt to be created')
    return attempt
  }

  it('keeps provider and model statistics intact after the provider row is soft-deleted', async () => {
    const fixture = await createAttributedTraffic()
    const before = {
      providerStats: await getProviderStats(0),
      providerStat: await getProviderStat(fixture.providerId, 0),
      modelStats: await getModelStats(0),
    }

    await deleteProvider(fixture.providerId)

    // 配置侧：确实删掉了（活跃列表里没有，行还在表里）。
    expect((await listProviders()).map(provider => provider.id)).not.toContain(fixture.providerId)
    expect(await listProviderModelRoutes(false)).toEqual([])
    // 观测侧：三项统计一字不差。
    expect(await getProviderStats(0)).toEqual(before.providerStats)
    expect(await getProviderStat(fixture.providerId, 0)).toEqual(before.providerStat)
    expect(await getModelStats(0)).toEqual(before.modelStats)
    // 连名字都还在：它们来自尝试行的快照，不来自那张被删掉的配置行。
    expect(await getProviderStat(fixture.providerId, 0)).toEqual(expect.objectContaining({ providerName: fixture.providerName, attempts: 1, success: 1 }))
    expect(await getModelStats(0)).toEqual([expect.objectContaining({ providerModelId: fixture.providerModelId, providerModelName: fixture.providerModelName, providerId: fixture.providerId, providerName: fixture.providerName })])
  })

  it('keeps provider and model statistics intact after only the provider model row is soft-deleted', async () => {
    const fixture = await createAttributedTraffic()
    const before = { providerStats: await getProviderStats(0), modelStats: await getModelStats(0) }

    // 只删模型、保留供应商：两条统计路径的独立性分别被钉住。
    await deleteProviderModelRoute(fixture.providerModelId)

    expect(await listProviderModelRoutes(false)).toEqual([])
    expect(await listProviders()).toEqual([expect.objectContaining({ id: fixture.providerId })])
    expect(await getProviderStats(0)).toEqual(before.providerStats)
    expect(await getModelStats(0)).toEqual(before.modelStats)
  })

  it('still reports deleted providers in the per-provider latency distribution', async () => {
    const fixture = await createAttributedTraffic()
    const before = await getLatencyDistribution(0, 6, fixture.providerId)

    await deleteProvider(fixture.providerId)

    expect(await getLatencyDistribution(0, 6, fixture.providerId)).toEqual(before)
    // 120ms 的样本仍然落在 `100ms-150ms` 那一档：分布本身没变，只是别的档为 0。
    expect((await getLatencyDistribution(0, 6, fixture.providerId)).filter(bucket => bucket.count > 0)).toEqual([
      expect.objectContaining({ range: '100ms-150ms', count: 1 }),
    ])
  })

  it('groups deleted and surviving configuration together in the same ranking', async () => {
    // 同一批尝试里既有活跃供应商、也有已删除供应商：分组键是快照列，两者都该在榜上。
    const deleted = await createAttributedTraffic()
    const survivingProvider = await createProvider({ name: '还在的供应商', apiKeyReference: 'key_surviving_analytics', timeoutMilliseconds: 30_000, enabled: true })
    const survivingModel = await createProviderModelRoute({ providerId: survivingProvider.id, modelName: 'surviving-model', priority: 1, endpoints: [] })
    const requestId = await createLog()
    const attempt = await createAttemptOrThrow({
      requestId,
      providerId: survivingProvider.id,
      providerModelId: survivingModel.id,
      providerName: survivingProvider.name,
      providerModelName: survivingModel.modelName,
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      durationMilliseconds: 1,
    })
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 10, outputTokens: 10 })

    await deleteProvider(deleted.providerId)

    const stats = await getProviderStats(0)
    expect(stats.map(stat => stat.providerId)).toEqual(expect.arrayContaining([deleted.providerId, survivingProvider.id]))
    expect(stats).toHaveLength(2)
    // `providerModelId` 由 `createProviderModelRoute` 生成，这里只需要它出现在榜上。
    expect((await getModelStats(0)).map(stat => stat.providerModelId)).toEqual(expect.arrayContaining([deleted.providerModelId, survivingModel.id]))
  })

  it('keeps the deleted record visible to the raw attempt snapshot it wrote', async () => {
    // 反证：观测库里那条尝试行仍在，且它的快照列就是统计读的东西——删配置不会回头改历史行。
    const fixture = await createAttributedTraffic()

    await deleteProvider(fixture.providerId)

    expect(getDataDb().select().from(requestAttempts).where(eq(requestAttempts.id, fixture.attemptId)).get()).toEqual(expect.objectContaining({
      providerId: fixture.providerId,
      providerName: fixture.providerName,
      providerModelId: fixture.providerModelId,
      providerModelName: fixture.providerModelName,
    }))
  })
})
