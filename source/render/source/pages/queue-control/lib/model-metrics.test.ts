import { describe, expect, it } from 'vitest'
import type { RequestLogEntry, RequestLogEntryAttempt } from '@common/schemas'
import { calculateQueueModelMetrics, queueModelMetricKey } from './model-metrics'

function attempt(overrides: Partial<RequestLogEntryAttempt> = {}): RequestLogEntryAttempt {
  return {
    id: 'att_test',
    attemptIndex: 0,
    status: 'success',
    providerId: 'prov_primary',
    providerName: 'Primary',
    providerModelId: 'model-a',
    providerModelName: 'model-a',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://example.com/v1/responses',
    httpStatus: 200,
    retryable: false,
    errorCode: null,
    errorMessage: null,
    details: null,
    durationMilliseconds: 2_000,
    createdTime: 1,
    ...overrides,
  }
}

function log(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: 'req_test',
    logicalModelId: 'model_default',
    clientProtocol: 'openai-responses',
    upstreamProtocol: null,
    status: 'success',
    totalDurationMilliseconds: 2_500,
    totalTokens: 120,
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: null,
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
        attempt({ status: 'failed', providerId: 'prov_primary', providerModelId: 'model-a' }),
        attempt({ attemptIndex: 1, providerId: 'prov_backup', providerName: 'Backup', providerModelId: 'model-b', providerModelName: 'model-b' }),
      ],
    })])

    expect(metrics[queueModelMetricKey('prov_backup', 'model-b')]).toEqual({
      sampleCount: 1,
      avgTps: 13.333333333333334,
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
      avgTps: 13.333333333333334,
      avgTtftMilliseconds: 500,
    })
  })
})
