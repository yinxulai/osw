import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createRequestLog, createRequestAttempt } from '../database/request-log-store'
import { createProvider } from '../database/provider-store'
import { analyticsRoutes } from './analytics'

function mockResponse() {
  return { statusCode: 0, headersSent: false, writableEnded: false, setHeader: vi.fn(), end: vi.fn() } as unknown as import('node:http').ServerResponse
}

function responseData(response: import('node:http').ServerResponse): Record<string, unknown> {
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
    expect(payload.data.latencyDistribution).toHaveLength(5)
    expect(payload.data.latencyDistribution.every(bucket => bucket.count === 0 && bucket.percent === 0)).toBe(true)
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

    await createRequestAttempt({
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
      details: null,
    })
    await createRequestAttempt({
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
      details: null,
    })

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
  })
})
