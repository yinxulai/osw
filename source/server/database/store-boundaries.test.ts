import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import { createProvider } from './provider-store'
import { getFailureReasons, getStatsSummary } from './analytics-store'
import {
  createRequestAttempt,
  createRequestLog,
  getRequestLog,
  listRequestUsages,
  replaceRequestUsage,
  updateRequestLogStatus,
} from './request-log-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-store-boundaries-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('request log persistence boundaries', () => {
  it('persists all initial token and metric fields when creating a request log', async () => {
    const log = await createRequestLog({
      id: 'req_initial_metrics',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-responses',
      upstreamProtocol: 'openai-completions',
      status: 'success',
      totalDurationMilliseconds: 120,
      totalTokens: 1280,
      inputTokens: 1200,
      outputTokens: 80,
      cachedInputTokens: 1024,
      cacheCreationInputTokens: 16,
      promptCacheHit: true,
      rawUsage: { input_tokens: 1200, output_tokens: 80 },
      ttftMilliseconds: 35,
      cacheHit: false,
    })

    expect(await getRequestLog(log.id)).toMatchObject({
      id: log.id,
      totalDurationMilliseconds: 120,
      totalTokens: 1280,
      inputTokens: 1200,
      outputTokens: 80,
      cachedInputTokens: 1024,
      cacheCreationInputTokens: 16,
      promptCacheHit: true,
      rawUsage: { input_tokens: 1200, output_tokens: 80 },
      ttftMilliseconds: 35,
      cacheHit: false,
    })
  })

  it('replaces one usage scope without changing another and clears nullable values', async () => {
    const log = await createRequestLog({
      id: 'req_usage_boundaries',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-completions',
      upstreamProtocol: null,
      status: 'success',
      totalDurationMilliseconds: 1,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
    })
    const provider = await createProvider({ name: 'Usage Provider', apiKeyReference: 'usage-key', timeoutMilliseconds: 1000 })
    const attempt = await createRequestAttempt({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_usage',
      providerName: provider.name,
      providerModelName: 'usage-model',
      upstreamProtocol: 'openai-completions',
      upstreamRequestId: null,
      url: 'https://example.com/v1/chat/completions',
      httpStatus: 200,
      retryable: false,
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 1,
    })

    await replaceRequestUsage({ requestId: log.id, attemptId: null, inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: null, cacheCreationInputTokens: null, rawUsage: null })
    await replaceRequestUsage({ requestId: log.id, attemptId: attempt.id, inputTokens: 4, outputTokens: 1, totalTokens: 5, cachedInputTokens: null, cacheCreationInputTokens: null, rawUsage: null })
    await replaceRequestUsage({ requestId: log.id, attemptId: attempt.id, inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, rawUsage: null })

    expect(await listRequestUsages(log.id)).toEqual([
      expect.objectContaining({ requestId: log.id, attemptId: null, inputTokens: 10, outputTokens: 2, totalTokens: 12 }),
    ])
  })

  it('preserves request usage when updating status without usage fields', async () => {
    const log = await createRequestLog({
      id: 'req_usage_status_update',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-responses',
      upstreamProtocol: null,
      status: 'pending',
      totalDurationMilliseconds: 0,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
    })

    await replaceRequestUsage({
      requestId: log.id,
      attemptId: null,
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      cachedInputTokens: 2,
      cacheCreationInputTokens: null,
      rawUsage: { input_tokens: 12, output_tokens: 4 },
    })
    await updateRequestLogStatus(log.id, { status: 'success', totalDurationMilliseconds: 25 })

    expect(await getRequestLog(log.id)).toMatchObject({
      status: 'success',
      rawUsage: { input_tokens: 12, output_tokens: 4 },
      inputTokens: 12,
      outputTokens: 4,
    })
  })
})

describe('analytics boundaries', () => {
  it('uses the time boundary and final attempt when classifying failures', async () => {
    const provider = await createProvider({ name: 'Analytics Provider', apiKeyReference: 'analytics-key', timeoutMilliseconds: 1000 })
    const inWindow = await createRequestLog({
      id: 'req_in_window',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-completions',
      upstreamProtocol: null,
      status: 'failed',
      totalDurationMilliseconds: 20,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
    })
    const outsideWindow = await createRequestLog({
      id: 'req_outside_window',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-completions',
      upstreamProtocol: null,
      status: 'failed',
      totalDurationMilliseconds: 20,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
    })
    const oldTime = Date.now() - 10_000
    const outsideRow = await getRequestLog(outsideWindow.id)
    expect(outsideRow).toBeTruthy()
    const database = (await import('./index')).getDb()
    database.$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(oldTime, outsideWindow.id)

    await createRequestAttempt({ requestId: inWindow.id, providerId: provider.id, providerModelId: 'model_a', providerName: provider.name, providerModelName: 'model-a', upstreamProtocol: 'openai-completions', upstreamRequestId: null, url: 'https://example.com/a', httpStatus: 503, retryable: true, attemptIndex: 0, status: 'failed', errorCode: 'Status_503', durationMilliseconds: 5 })
    await createRequestAttempt({ requestId: inWindow.id, providerId: provider.id, providerModelId: 'model_b', providerName: provider.name, providerModelName: 'model-b', upstreamProtocol: 'openai-completions', upstreamRequestId: null, url: 'https://example.com/b', httpStatus: 401, retryable: false, attemptIndex: 1, status: 'failed', errorCode: 'AUTH_401', durationMilliseconds: 15 })
    await createRequestAttempt({ requestId: outsideWindow.id, providerId: provider.id, providerModelId: 'model_old', providerName: provider.name, providerModelName: 'model-old', upstreamProtocol: 'openai-completions', upstreamRequestId: null, url: 'https://example.com/old', httpStatus: 504, retryable: true, attemptIndex: 0, status: 'failed', errorCode: 'TIMEOUT', durationMilliseconds: 20 })

    const since = (await getRequestLog(inWindow.id))!.createdTime
    expect(await getStatsSummary(since)).toMatchObject({ totalRequests: 1, failedCount: 1 })
    expect(await getFailureReasons(since)).toEqual([{ reason: '认证失败', count: 1 }])
  })
})
