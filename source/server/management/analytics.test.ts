import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createRequestLog, createRequestAttempt, replaceRequestUsage } from '@server/database/request-log-store'
import { createProvider } from '@server/database/provider-store'
import { analyticsRoutes } from './routes/observability/analytics'

function mockResponse() {
  return { statusCode: 0, headersSent: false, writableEnded: false, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse
}

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-analytics-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
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

  it('returns summary, trend, provider stats and failure reasons for a time range', async () => {
    const provider = await createProvider({ name: 'Analytics Provider', apiKeyReference: 'key_analytics', timeoutMilliseconds: 30_000, enabled: true })
    const successLog = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      upstreamProtocol: 'openai-responses',
      status: 'success',
      totalDurationMilliseconds: 1500,
      totalTokens: 120,
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      promptCacheHit: false,
      rawUsage: null,
      ttftMilliseconds: 100,
      cacheHit: false,
    })
    const failedLog = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      upstreamProtocol: 'openai-responses',
      status: 'failed',
      totalDurationMilliseconds: 2200,
      totalTokens: 40,
      inputTokens: 30,
      outputTokens: 10,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      promptCacheHit: false,
      rawUsage: null,
      ttftMilliseconds: 120,
      cacheHit: false,
    })

    const successAttempt = await createRequestAttempt({
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
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 1500,
      errorCode: null,
      errorMessage: null,
    })
    const failedAttempt = await createRequestAttempt({
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
      attemptIndex: 0,
      status: 'failed',
      durationMilliseconds: 2200,
      errorCode: 'RateLimit_429',
      errorMessage: 'rate limited',
    })
    await replaceRequestUsage({ requestId: successLog.id, attemptId: successAttempt.id, inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, cacheCreationInputTokens: 0, rawUsage: null })
    await replaceRequestUsage({ requestId: failedLog.id, attemptId: failedAttempt.id, inputTokens: 30, outputTokens: 10, totalTokens: 40, cachedInputTokens: 0, cacheCreationInputTokens: 0, rawUsage: null })

    const res = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', res, { range: '7d' })

    const payload = responseData(res) as {
      success: boolean
      data: {
        summary: { totalRequests: number; failedCount: number }
        providerStats: Array<{ providerId: string; percent: number }>
        modelStats: Array<{ providerModelName: string; successRate: number }>
        failureReasons: Array<{ reason: string; count: number }>
      }
    }

    expect(payload.success).toBe(true)
    expect(payload.data.summary.totalRequests).toBeGreaterThanOrEqual(2)
    expect(payload.data.summary.failedCount).toBeGreaterThanOrEqual(1)
    expect(payload.data.providerStats).toEqual(expect.arrayContaining([expect.objectContaining({ providerId: provider.id })]))
    expect(payload.data.modelStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelName: 'provider-success' }),
      expect.objectContaining({ providerModelName: 'provider-failed' }),
    ]))
    expect(payload.data.failureReasons).toEqual(expect.arrayContaining([expect.objectContaining({ reason: '限流 (429)' })]))

    const detailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', detailRes, { providerId: provider.id, range: '7d' })
    const detailPayload = responseData(detailRes) as {
      success: boolean
      data: {
        summary: { requests: number; success: number; failed: number; totalTokens: number }
        requestTrend: Array<{ success: number; failed: number; avgLatencyMs: number }>
        tokenTrend: Array<{ inputTokens: number; outputTokens: number }>
        models: Array<{ providerModelName: string }>
        latencyDistribution: Array<{ range: string; count: number; percent: number }>
        failureReasons: Array<{ reason: string; count: number; percent: number }>
      }
    }
    expect(detailPayload.success).toBe(true)
    expect(detailPayload.data.summary).toEqual(expect.objectContaining({ requests: 2, success: 1, failed: 1, totalTokens: 160 }))
    expect(detailPayload.data.requestTrend.reduce((total, point) => total + point.success + point.failed, 0)).toBe(2)
    expect(detailPayload.data.tokenTrend.reduce((total, point) => total + point.inputTokens + point.outputTokens, 0)).toBe(160)
    expect(detailPayload.data.latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(2)
    expect(detailPayload.data.latencyDistribution).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: 1, percent: expect.any(Number) }),
      expect.objectContaining({ count: 1, percent: expect.any(Number) }),
    ]))
    expect(detailPayload.data.failureReasons).toEqual([expect.objectContaining({ reason: '限流 (429)', count: 1, percent: 100 })])
    expect(detailPayload.data.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelName: 'provider-success' }),
      expect.objectContaining({ providerModelName: 'provider-failed' }),
    ]))
  })

  it('returns 15-minute intraday trend for the today range', async () => {
    await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      upstreamProtocol: 'openai-responses',
      status: 'success',
      totalDurationMilliseconds: 1500,
      totalTokens: 120,
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      promptCacheHit: false,
      rawUsage: null,
      ttftMilliseconds: 100,
      cacheHit: false,
    })

    const res = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', res, { range: 'today' })

    const payload = responseData(res) as { data: { trend: Array<{ label: string; inputTokens: number }> }; success: boolean }

    expect(payload.success).toBe(true)
    expect(payload.data.trend.length).toBeGreaterThanOrEqual(1)
    expect(payload.data.trend.length).toBeLessThanOrEqual(96)
    expect(payload.data.trend[0].label).toMatch(/^\d{2}:\d{2}$/)
    expect(payload.data.trend.every(point => ['00', '15', '30', '45'].includes(point.label.slice(-2)))).toBe(true)
    expect(payload.data.trend.reduce((total, point) => total + point.inputTokens, 0)).toBe(100)
  })

  it('attributes retries and usage to each provider attempt', async () => {
    const firstProvider = await createProvider({ name: 'First Provider', apiKeyReference: 'key_first', timeoutMilliseconds: 30_000, enabled: true })
    const secondProvider = await createProvider({ name: 'Second Provider', apiKeyReference: 'key_second', timeoutMilliseconds: 30_000, enabled: true })
    const log = await createRequestLog({
      logicalModelId: 'default', clientProtocol: 'openai-responses', upstreamProtocol: 'openai-responses', status: 'success',
      totalDurationMilliseconds: 30, totalTokens: 12, inputTokens: 10, outputTokens: 2, cachedInputTokens: 0,
      cacheCreationInputTokens: 0, promptCacheHit: false, rawUsage: null, ttftMilliseconds: 10, cacheHit: false,
    })
    const failedAttempt = await createRequestAttempt({
      requestId: log.id, providerId: firstProvider.id, providerModelId: 'model_first', providerName: firstProvider.name,
      providerModelName: 'first-model', upstreamProtocol: 'openai-responses', upstreamRequestId: null,
      url: 'https://first.example.com', httpStatus: 503, retryable: true, attemptIndex: 0, status: 'failed',
      durationMilliseconds: 10, errorCode: 'Status_503', errorMessage: 'unavailable',
    })
    const successAttempt = await createRequestAttempt({
      requestId: log.id, providerId: secondProvider.id, providerModelId: 'model_second', providerName: secondProvider.name,
      providerModelName: 'second-model', upstreamProtocol: 'openai-responses', upstreamRequestId: null,
      url: 'https://second.example.com', httpStatus: 200, retryable: false, attemptIndex: 1, status: 'success',
      durationMilliseconds: 20, errorCode: null, errorMessage: null,
    })
    await replaceRequestUsage({ requestId: log.id, attemptId: failedAttempt.id, inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, rawUsage: null })
    await replaceRequestUsage({ requestId: log.id, attemptId: successAttempt.id, inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 0, cacheCreationInputTokens: 0, rawUsage: null })

    const summaryRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', summaryRes, { range: '7d' })
    const summary = responseData(summaryRes) as { data: { providerStats: Array<{ providerId: string; requests: number; percent: number }> } }
    expect(summary.data.providerStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: firstProvider.id, requests: 1, percent: 50 }),
      expect.objectContaining({ providerId: secondProvider.id, requests: 1, percent: 50 }),
    ]))

    const firstDetailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', firstDetailRes, { providerId: firstProvider.id, range: '7d' })
    const firstDetail = responseData(firstDetailRes) as { data: { summary: { requests: number; success: number; failed: number; avgLatencyMs: number; totalTokens: number }; models: Array<{ providerModelId: string; success: number; avgLatencyMs: number }>; latencyDistribution: Array<{ count: number }>; failureReasons: Array<{ reason: string }> } }
    expect(firstDetail.data.summary).toEqual(expect.objectContaining({ requests: 1, success: 0, failed: 1, avgLatencyMs: 0, totalTokens: 0 }))
    expect(firstDetail.data.models).toEqual([expect.objectContaining({ providerModelId: 'model_first', success: 0, avgLatencyMs: 0 })])
    expect(firstDetail.data.latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(1)
    expect(firstDetail.data.failureReasons).toEqual([])

    const secondDetailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', secondDetailRes, { providerId: secondProvider.id, range: '7d' })
    const secondDetail = responseData(secondDetailRes) as { data: { summary: { requests: number; success: number; totalTokens: number }; models: Array<{ providerModelId: string }>; latencyDistribution: Array<{ count: number }>; failureReasons: Array<{ reason: string }> } }
    expect(secondDetail.data.summary).toEqual(expect.objectContaining({ requests: 1, success: 1, totalTokens: 12 }))
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
      upstreamProtocol: 'openai-responses',
      status: 'success',
      totalDurationMilliseconds: 8_000,
      totalTokens: 10,
      inputTokens: 5,
      outputTokens: 5,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      promptCacheHit: false,
      rawUsage: null,
      ttftMilliseconds: 120,
      cacheHit: false,
    })
    await createRequestAttempt({
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
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 8_000,
    })

    const res = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', res, { range: '7d' })

    const payload = responseData(res) as { data: { latencyDistribution: Array<{ count: number }> }; success: boolean }

    expect(payload.success).toBe(true)
    expect(payload.data.latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(1)
  })
})
