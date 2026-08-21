import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import {
  createProvider,
  createRequestAttempt,
  createRequestLog,
  getFailureReasons,
  getRequestLog,
  getStatsSummary,
  listRequestUsages,
  replaceRequestUsage,
} from './store'

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
      protocol: 'openai-responses',
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
      protocol: 'openai-completions',
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
      providerProtocol: 'openai-completions',
      providerRequestId: null,
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
})

describe('analytics boundaries', () => {
  it('uses the time boundary and final attempt when classifying failures', async () => {
    const provider = await createProvider({ name: 'Analytics Provider', apiKeyReference: 'analytics-key', timeoutMilliseconds: 1000 })
    const inWindow = await createRequestLog({
      id: 'req_in_window',
      logicalModelId: 'model_default',
      protocol: 'openai-completions',
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
      protocol: 'openai-completions',
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

    await createRequestAttempt({ requestId: inWindow.id, providerId: provider.id, providerModelId: 'model_a', providerName: provider.name, providerModelName: 'model-a', providerProtocol: 'openai-completions', providerRequestId: null, url: 'https://example.com/a', httpStatus: 503, retryable: true, attemptIndex: 0, status: 'failed', errorCode: 'Status_503', durationMilliseconds: 5 })
    await createRequestAttempt({ requestId: inWindow.id, providerId: provider.id, providerModelId: 'model_b', providerName: provider.name, providerModelName: 'model-b', providerProtocol: 'openai-completions', providerRequestId: null, url: 'https://example.com/b', httpStatus: 401, retryable: false, attemptIndex: 1, status: 'failed', errorCode: 'AUTH_401', durationMilliseconds: 15 })
    await createRequestAttempt({ requestId: outsideWindow.id, providerId: provider.id, providerModelId: 'model_old', providerName: provider.name, providerModelName: 'model-old', providerProtocol: 'openai-completions', providerRequestId: null, url: 'https://example.com/old', httpStatus: 504, retryable: true, attemptIndex: 0, status: 'failed', errorCode: 'TIMEOUT', durationMilliseconds: 20 })

    const since = (await getRequestLog(inWindow.id))!.createdTime
    expect(await getStatsSummary(since)).toMatchObject({ totalRequests: 1, failedCount: 1 })
    expect(await getFailureReasons(since)).toEqual([{ reason: '认证失败', count: 1 }])
  })
})
