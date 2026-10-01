import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DAY_MILLISECONDS, TREND_MAX_BUCKETS, resolveAnalyticsBuckets } from '@common/analytics-buckets'
import { closeDatabases, initDatabases } from '../database'
import { createRequestLog, createRequestAttempt, recordAttemptUsage } from '@server/database/request-log-store'
import { createProvider, deleteProvider } from '@server/database/provider-store'
import { createProviderModelRoute, deleteProviderModelRoute } from '@server/database/model-store'
import { analyticsRoutes } from './routes/observability/analytics'
import { mockResponse } from './test-support'

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

const HOUR_MILLISECONDS = 60 * 60 * 1000

/** 只取热力图那一段：格数与格宽是这里的断言对象。 */
interface HeatPayload {
  heatIntervalMs: number
  heat: Array<{ label: string; requests: number; success: number; failed: number; totalTokens: number }>
}

/** 同一请求的同一次序号只能落一行，冲突时 store 返回 `null`。 */
async function createAttemptOrThrow(input: Parameters<typeof createRequestAttempt>[0]) {
  const attempt = await createRequestAttempt(input)
  if (!attempt) throw new Error('expected attempt to be created')
  return attempt
}

/** 用量字段的「都不知道」形状，用于只关心部分字段的用例。 */
const EMPTY_USAGE = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null }

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-analytics-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('analytics route', () => {
  it('uses the default range and returns zero percentages when there is no data', async () => {
    const res = mockResponse()

    await analyticsRoutes.invoke('/api/analytics/summary', res, {})

    const payload = responseData(res) as {
      success: boolean
      data: {
        providerStats: Array<{ percent: number }>
        latencyDistribution: Array<{ count: number; percent: number }>
        failureReasons: Array<{ percent: number }>
      }
    }

    expect(payload.success).toBe(true)
    expect(payload.data.providerStats).toEqual([])
    expect(payload.data.latencyDistribution).toEqual([])
    expect(payload.data.failureReasons).toEqual([])
  })

  it('rejects an unsupported analytics range', async () => {
    const res = mockResponse()

    await expect(analyticsRoutes.invoke('/api/analytics/summary', res, { range: '90d' })).rejects.toThrow()
    expect(res.end).not.toHaveBeenCalled()
  })

  it('用量分布按查询范围分桶：格数按完整时长规划、空格补零', async () => {
    const provider = await createProvider({ name: 'Heat Provider', apiKeyReference: 'key_heat', timeoutMilliseconds: 30_000, enabled: true })
    const log = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 1500,
    })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_heat',
      providerName: provider.name,
      providerModelName: 'heat-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/heat',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 1500,
    })
    // 请求级用量由服务该请求的尝试镜像过来；热力图读的就是请求级这张表。
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, cacheCreationInputTokens: 0 })

    const todayRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', todayRes, { range: 'today' })
    const monthRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', monthRes, { range: '30d' })

    const today = responseData(todayRes) as { success: boolean; data: HeatPayload }
    const month = responseData(monthRes) as { success: boolean; data: HeatPayload }

    expect(today.success).toBe(true)
    expect(month.success).toBe(true)
    // 格数与格宽都只由范围决定，与「此刻」是几点无关：今日恒为整天的 144 格（10 分钟一格），
    // 近 30 天恒为 181 格（4 小时一格，首尾各占一个不完整的格）。
    expect(today.data.heatIntervalMs).toBe(10 * 60_000)
    expect(today.data.heat.length).toBe(144)
    expect(month.data.heatIntervalMs).toBe(4 * HOUR_MILLISECONDS)
    expect(month.data.heat.length).toBe(181)
    // 唯一的请求落在最后一个格里（窗口的终点就是此刻），其余全是零值格。
    expect(month.data.heat[month.data.heat.length - 1]).toMatchObject({ requests: 1, success: 1, failed: 0, totalTokens: 120 })
    expect(month.data.heat.slice(0, -1).every(bucket => bucket.requests === 0 && bucket.success === 0 && bucket.failed === 0 && bucket.totalTokens === 0)).toBe(true)
  })

  it('returns summary, trend, provider stats and failure reasons for a time range', async () => {
    const provider = await createProvider({ name: 'Analytics Provider', apiKeyReference: 'key_analytics', timeoutMilliseconds: 30_000, enabled: true })
    const successLog = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 1500,
    })
    const failedLog = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'failed',
      totalDurationMilliseconds: 2200,
    })

    const successAttempt = await createAttemptOrThrow({
      requestId: successLog.id,
      providerId: provider.id,
      providerModelId: 'model_success',
      providerName: provider.name,
      providerModelName: 'provider-success',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: 'upstream_success',
      url: 'https://example.com/success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 1500,
      ttftMilliseconds: 150,
      errorCode: null,
      errorMessage: null,
    })
    const failedAttempt = await createAttemptOrThrow({
      requestId: failedLog.id,
      providerId: provider.id,
      providerModelId: 'model_failed',
      providerName: provider.name,
      providerModelName: 'provider-failed',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: 'upstream_failed',
      url: 'https://example.com/failed',
      httpStatus: 429,
      retryable: true,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'failed',
      durationMilliseconds: 2200,
      ttftMilliseconds: 150,
      errorCode: 'RateLimit_429',
      errorMessage: 'rate limited',
    })
    // 服务该请求的尝试把用量镜像到请求级；失败的尝试只在尝试级留下自己的数字。
    await recordAttemptUsage({ attemptId: successAttempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20, cachedInputTokens: 25, cacheCreationInputTokens: 0 })
    await recordAttemptUsage({ attemptId: failedAttempt.id, servesRequest: false, ...EMPTY_USAGE, inputTokens: 30, outputTokens: 10, cachedInputTokens: 0, cacheCreationInputTokens: 0 })

    const res = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', res, { range: '7d' })

    const budget = resolveAnalyticsBuckets('7d')
    const payload = responseData(res) as {
      success: boolean
      data: {
        summary: { totalRequests: number; failedCount: number; inputTokens: number; outputTokens: number; totalTokens: number; cacheHitRate: number | null }
        trendIntervalMs: number
        providerStats: Array<{ providerId: string; percent: number }>
        modelStats: Array<{ providerModelName: string; successRate: number; avgTps: number | null; avgOutputTokens: number | null; cacheHitRate: number | null }>
        failureReasons: Array<{ reason: string; count: number }>
      }
    }

    expect(payload.success).toBe(true)
    // 粒度由查询范围推导后显式回传，前端不再自己猜一个固定值。
    expect(payload.data.trendIntervalMs).toBe(budget.trendIntervalMs)
    expect(payload.data.summary.totalRequests).toBeGreaterThanOrEqual(2)
    expect(payload.data.summary.failedCount).toBeGreaterThanOrEqual(1)
    // 平均输出的分子分母必须同源：失败尝试只在尝试级留下数字，请求级用量只有成功那一次
    // 镜像过来的 100 输入 / 20 输出，所以卡片的两个总量与它们的合计都要对得上。
    expect(payload.data.summary).toMatchObject({ inputTokens: 100, outputTokens: 20, totalTokens: 120 })
    // 命中率 = 请求级缓存读取 ÷ 请求级输入总量 = 25 / 100；失败的尝试只在尝试级留数字，不进这两项。
    expect(payload.data.summary.cacheHitRate).toBeCloseTo(0.25, 6)
    expect(payload.data.providerStats).toEqual(expect.arrayContaining([expect.objectContaining({ providerId: provider.id })]))
    // 速度的分母是整段尝试耗时 1500ms，首字等待不扣：20 / 1.5 = 13.33…；
    // 失败的尝试不参与速度——它没有完整输出，也就没有可比的产出速率。
    expect(payload.data.modelStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelName: 'provider-success', avgTps: 20 / 1.5, cacheHitRate: 0.25 }),
      expect.objectContaining({ providerModelName: 'provider-failed', avgTps: null, cacheHitRate: null }),
    ]))
    // 平均输出的分母是成功调用数（1），不是全部尝试数（1 成功 + 1 失败）；
    // 没有成功调用的模型没有可报的平均值，写 null 而不是 0。
    expect(payload.data.modelStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelName: 'provider-success', avgOutputTokens: 20 }),
      expect.objectContaining({ providerModelName: 'provider-failed', avgOutputTokens: null }),
    ]))
    expect(payload.data.failureReasons).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'RATE_LIMITED' })]))

    const detailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', detailRes, { providerId: provider.id, range: '7d' })
    const detailPayload = responseData(detailRes) as {
      success: boolean
      data: {
        summary: { attempts: number; success: number; failed: number; cacheHitRate: number | null; totalTokens: number }
        trendIntervalMs: number
        requestTrend: Array<{ success: number; failed: number; avgLatencyMs: number }>
        tokenTrend: Array<{ inputTokens: number; outputTokens: number }>
        models: Array<{ providerModelName: string }>
        latencyDistribution: Array<{ range: string; count: number; percent: number }>
        failureReasons: Array<{ reason: string; count: number; percent: number }>
      }
    }
    expect(detailPayload.success).toBe(true)
    expect(detailPayload.data.trendIntervalMs).toBe(budget.trendIntervalMs)
    expect(detailPayload.data.summary).toEqual(expect.objectContaining({ attempts: 2, success: 1, failed: 1, cacheHitRate: 0.25, totalTokens: 160 }))
    expect(detailPayload.data.requestTrend.reduce((total, point) => total + point.success + point.failed, 0)).toBe(2)
    expect(detailPayload.data.tokenTrend.reduce((total, point) => total + point.inputTokens + point.outputTokens, 0)).toBe(160)
    // 首字分布只统计成功的尝试，与模型表的 `avgTtftMs` 同一口径；
    // 空档会一并返回，所以只盯有样本的那一格。
    expect(detailPayload.data.latencyDistribution.filter(bucket => bucket.count > 0)).toEqual([
      expect.objectContaining({ count: 1, percent: 100 }),
    ])
    expect(detailPayload.data.failureReasons).toEqual([expect.objectContaining({ reason: 'RATE_LIMITED', count: 1, percent: 100 })])
    expect(detailPayload.data.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelName: 'provider-success' }),
      expect.objectContaining({ providerModelName: 'provider-failed' }),
    ]))
  })

  it('derives the intraday trend granularity from the query range', async () => {
    const provider = await createProvider({ name: 'Intraday Provider', apiKeyReference: 'key_intraday', timeoutMilliseconds: 30_000, enabled: true })
    const log = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 1500,
    })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_intraday',
      providerName: provider.name,
      providerModelName: 'intraday-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/intraday',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 1500,
    })
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, cacheCreationInputTokens: 0 })

    const res = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', res, { range: 'today' })

    const buckets = resolveAnalyticsBuckets('today')
    const payload = responseData(res) as { data: { trend: Array<{ label: string; inputTokens: number }>; trendIntervalMs: number }; success: boolean }

    expect(payload.success).toBe(true)
    // 区间必须是整天能整除的分钟数，否则跨天时增位会错位。
    expect(payload.data.trendIntervalMs).toBe(buckets.trendIntervalMs)
    expect(DAY_MILLISECONDS % payload.data.trendIntervalMs).toBe(0)
    // 桶数就是「本地零点到现在」铺满的槽位，且不超出可视上限。
    expect(payload.data.trend.length).toBe(buckets.trendBucketCount)
    expect(payload.data.trend.length).toBeLessThanOrEqual(TREND_MAX_BUCKETS)
    // 标签带日期，前端据此自己判断要不要在刻度上写「月/日」。
    expect(payload.data.trend.every(point => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(point.label))).toBe(true)
    expect(payload.data.trend[0].label.endsWith('00:00')).toBe(true)
    expect(payload.data.trend.reduce((total, point) => total + point.inputTokens, 0)).toBe(100)
  })

  it('attributes retries and usage to each provider attempt', async () => {
    const firstProvider = await createProvider({ name: 'First Provider', apiKeyReference: 'key_first', timeoutMilliseconds: 30_000, enabled: true })
    const secondProvider = await createProvider({ name: 'Second Provider', apiKeyReference: 'key_second', timeoutMilliseconds: 30_000, enabled: true })
    const log = await createRequestLog({
      logicalModelId: 'default', clientProtocol: 'openai-responses', transport: 'http', status: 'success',
      totalDurationMilliseconds: 30,
    })
    const failedAttempt = await createAttemptOrThrow({
      requestId: log.id, providerId: firstProvider.id, providerModelId: 'model_first', providerName: firstProvider.name,
      providerModelName: 'first-model', upstreamProtocol: 'openai-responses', upstreamRequestId: null,
      url: 'https://first.example.com', httpStatus: 503, retryable: true, upstreamTransport: 'http', attemptIndex: 0, status: 'failed',
      durationMilliseconds: 10, ttftMilliseconds: 10, errorCode: 'Status_503', errorMessage: 'unavailable',
    })
    const successAttempt = await createAttemptOrThrow({
      requestId: log.id, providerId: secondProvider.id, providerModelId: 'model_second', providerName: secondProvider.name,
      providerModelName: 'second-model', upstreamProtocol: 'openai-responses', upstreamRequestId: null,
      url: 'https://second.example.com', httpStatus: 200, retryable: false, upstreamTransport: 'http', attemptIndex: 1, status: 'success',
      durationMilliseconds: 20, ttftMilliseconds: 10, errorCode: null, errorMessage: null,
    })
    await recordAttemptUsage({ attemptId: failedAttempt.id, servesRequest: false, ...EMPTY_USAGE })
    await recordAttemptUsage({ attemptId: successAttempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, cacheCreationInputTokens: 0 })

    const summaryRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', summaryRes, { range: '7d' })
    const summary = responseData(summaryRes) as { data: { providerStats: Array<{ providerId: string; attempts: number; percent: number }> } }
    expect(summary.data.providerStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: firstProvider.id, attempts: 1, percent: 50 }),
      expect.objectContaining({ providerId: secondProvider.id, attempts: 1, percent: 50 }),
    ]))

    const firstDetailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', firstDetailRes, { providerId: firstProvider.id, range: '7d' })
    const firstDetail = responseData(firstDetailRes) as { data: { summary: { attempts: number; success: number; failed: number; cacheHitRate: number | null; totalTokens: number }; models: Array<{ providerModelId: string; success: number; cacheHitRate: number | null }>; latencyDistribution: Array<{ count: number }>; failureReasons: Array<{ reason: string }> } }
    // 两次尝试都是「没有输出的失败」，没有任何输入 Token，命中率因此是 null 而不是 0。
    expect(firstDetail.data.summary).toEqual(expect.objectContaining({ attempts: 1, success: 0, failed: 1, cacheHitRate: null, totalTokens: 0 }))
    expect(firstDetail.data.models).toEqual([expect.objectContaining({ providerModelId: 'model_first', success: 0, cacheHitRate: null })])
    expect(firstDetail.data.latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(1)
    expect(firstDetail.data.failureReasons).toEqual([])

    const secondDetailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', secondDetailRes, { providerId: secondProvider.id, range: '7d' })
    const secondDetail = responseData(secondDetailRes) as { data: { summary: { attempts: number; success: number; totalTokens: number }; models: Array<{ providerModelId: string }>; latencyDistribution: Array<{ count: number }>; failureReasons: Array<{ reason: string }> } }
    expect(secondDetail.data.summary).toEqual(expect.objectContaining({ attempts: 1, success: 1, totalTokens: 12 }))
    expect(secondDetail.data.models).toEqual([expect.objectContaining({ providerModelId: 'model_second' })])
    expect(secondDetail.data.latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(1)
    expect(secondDetail.data.failureReasons).toEqual([])
  })

  it('rejects provider detail when the provider has no data in range', async () => {
    const res = mockResponse()

    await analyticsRoutes.invoke('/api/analytics/provider-detail', res, { providerId: 'prov_missing', range: '7d' })

    const payload = responseData(res) as { success: boolean; errorCode: string }
    expect(payload.success).toBe(false)
    expect(payload.errorCode).toBe('RESOURCE_NOT_FOUND')
    expect(res.statusCode).toBe(404)
  })

  it('buckets latency distribution by TTFT instead of total duration', async () => {
    const provider = await createProvider({ name: 'TTFT Provider', apiKeyReference: 'key_ttft', timeoutMilliseconds: 30_000, enabled: true })
    const shortTtftLongDuration = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 8_000,
    })
    await createAttemptOrThrow({
      requestId: shortTtftLongDuration.id,
      providerId: provider.id,
      providerModelId: 'model_ttft',
      providerName: provider.name,
      providerModelName: 'ttft-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: 'upstream_ttft',
      url: 'https://example.com/ttft',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 8_000,
      ttftMilliseconds: 120,
    })

    const res = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', res, { range: '7d' })

    const payload = responseData(res) as { data: { latencyDistribution: Array<{ range: string; count: number }> }; success: boolean }

    expect(payload.success).toBe(true)
    // 120ms 的 TTFT 必须落在 100ms 之后的那一档里；如果按 8s 总耗时分桶会落到「>= 5s」。
    // 档宽 10ms：预算留到 16 档之后，同一个 p95 会一路收到最细的一档，至少要切出十档才好看形状。
    // 前面几格是为直方图形状补的零，尾部全空的档则被裁掉。
    expect(payload.data.latencyDistribution.map(bucket => bucket.range)).toEqual([
      '< 10ms', '10ms-20ms', '20ms-30ms', '30ms-40ms', '40ms-50ms', '50ms-60ms', '60ms-70ms',
      '70ms-80ms', '80ms-90ms', '90ms-100ms', '100ms-110ms', '110ms-120ms', '120ms-130ms',
    ])
    expect(payload.data.latencyDistribution.at(-1)).toEqual(expect.objectContaining({ range: '120ms-130ms', count: 1 }))
  })

  it('keeps reporting deleted providers and models through the summary and detail endpoints', async () => {
    // 统计读的是尝试行上的快照列：删掉一条配置只该让它退出「可被调度」的名单，
    // 不该让观测页面上已经发生过的历史跟着消失。这里走完整的 HTTP 路由，验一遍端到端契约。
    const provider = await createProvider({ name: '要删掉的供应商', apiKeyReference: 'key_deleted_route', timeoutMilliseconds: 30_000, enabled: true })
    const model = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'deleted-route-model',
      priority: 1,
      endpoints: [{ protocol: 'openai-responses', endpointUrl: 'https://example.com/v1/responses', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const log = await createRequestLog({ logicalModelId: 'default', clientProtocol: 'openai-responses', transport: 'http', status: 'success', totalDurationMilliseconds: 1500 })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: model.id,
      providerName: provider.name,
      providerModelName: model.modelName,
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 1500,
      ttftMilliseconds: 120,
    })
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20, cachedInputTokens: 25, cacheCreationInputTokens: 0 })

    await deleteProviderModelRoute(model.id)
    await deleteProvider(provider.id)

    const summaryRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', summaryRes, { range: '7d' })
    const summary = responseData(summaryRes) as {
      success: boolean
      data: {
        providerStats: Array<{ providerId: string; providerName: string; attempts: number; percent: number }>
        modelStats: Array<{ providerModelId: string; providerModelName: string; providerId: string; providerName: string }>
      }
    }
    expect(summary.success).toBe(true)
    expect(summary.data.providerStats).toEqual([
      expect.objectContaining({ providerId: provider.id, providerName: provider.name, attempts: 1, percent: 100 }),
    ])
    expect(summary.data.modelStats).toEqual([
      expect.objectContaining({ providerModelId: model.id, providerModelName: model.modelName, providerId: provider.id, providerName: provider.name }),
    ])

    // 详情页按 providerId 取数，配置已删也照样能打开，名字来自快照而不是配置表。
    const detailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', detailRes, { providerId: provider.id, range: '7d' })
    const detail = responseData(detailRes) as {
      success: boolean
      data: {
        summary: { providerName: string; attempts: number; success: number; failed: number; cacheHitRate: number | null; totalTokens: number }
        models: Array<{ providerModelId: string; providerModelName: string }>
      }
    }
    expect(detail.success).toBe(true)
    expect(detail.data.summary).toEqual(expect.objectContaining({ providerName: provider.name, attempts: 1, success: 1, failed: 0, cacheHitRate: 0.25, totalTokens: 120 }))
    expect(detail.data.models).toEqual([expect.objectContaining({ providerModelId: model.id, providerModelName: model.modelName })])
  })
})
