import { describe, expect, it } from 'vitest'
import type { RequestLogEntry, RequestLogEntryAttempt } from '@common/schemas'
import { calculateQueueModelMetrics, queueModelMetricKey } from './model-metrics'

function attempt(overrides: Partial<RequestLogEntryAttempt> = {}): RequestLogEntryAttempt {
  return {
    attemptIndex: 0,
    status: 'success',
    providerId: 'prov_primary',
    providerName: 'Primary',
    upstreamModelId: 'model-a',
    errorCode: null,
    errorMessage: null,
    upstreamRequestId: null,
    errorResponse: null,
    durationMilliseconds: 2_000,
    createdTime: 1,
    ...overrides,
  }
}

function log(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: 'req_test',
    logicalModelId: 'model_default',
    protocol: 'openai-responses',
    upstreamProtocol: null,
    status: 'success',
    totalDurationMilliseconds: 2_500,
    totalTokens: 120,
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    promptCacheHit: null,
    rawUsage: null,
    ttftMilliseconds: 500,
    cacheHit: null,
    createdTime: 1,
    attempts: [attempt()],
    ...overrides,
  }
}

describe('calculateQueueModelMetrics', () => {
  it('attributes metrics to the successful failover target and uses output tokens for TPS', () => {
    const metrics = calculateQueueModelMetrics([log({
      attempts: [
        attempt({ status: 'failed', providerId: 'prov_primary', upstreamModelId: 'model-a' }),
        attempt({ attemptIndex: 1, providerId: 'prov_backup', providerName: 'Backup', upstreamModelId: 'model-b' }),
      ],
    })])

    expect(metrics[queueModelMetricKey('prov_backup', 'model-b')]).toEqual({
      sampleCount: 1,
      avgTps: 10,
      avgTtftMilliseconds: 500,
    })
  })

  it('averages only requests that contain each performance metric', () => {
    const metrics = calculateQueueModelMetrics([
      log({ id: 'req_complete' }),
      log({
        id: 'req_missing',
        outputTokens: null,
        ttftMilliseconds: null,
        totalDurationMilliseconds: 1_000,
      }),
    ])

    expect(metrics[queueModelMetricKey('prov_primary', 'model-a')]).toEqual({
      sampleCount: 2,
      avgTps: 10,
      avgTtftMilliseconds: 500,
    })
  })
})
