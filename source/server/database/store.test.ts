import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import {
  createUpstreamModel,
  createLogicalModel,
  createProvider,
  getUpstreamModel,
  getLogicalModel,
  getProvider,
  getSettings,
  listUpstreamModels,
  deleteProvider,
  createRequestLog,
  createRequestAttempt,
  updateRequestLogStatus,
  listRequestLogs,
  pruneRequestLogs,
  getProviderStats,
  listAttemptsByRequest,
  listLogicalModels,
  listProviders,
} from './store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-store-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('store row mapping', () => {
  it('uses an environment-specific port only when settings are first created', async () => {
    expect((await getSettings({ listenPort: 19300 })).listenPort).toBe(19300)
    expect((await getSettings()).listenPort).toBe(19300)
  })

  it('maps SQLite integer flags to booleans', async () => {
    const provider = await createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 1_000,
      enabled: false,
      upstreamUrls: '{}',
    })
    const model = await createLogicalModel({ name: 'Model', description: '', enabled: true })
    const upstreamModel = await createUpstreamModel({
      providerId: provider.id,
      upstreamModelId: 'upstream-model',
      endpoints: [
        {
          protocol: 'openai-completions',
          upstreamUrl: 'https://api.example.com/v1/chat/completions',
          customAuthHeader: null,
        },
      ],
      priority: 1,
      enabled: false,
    })

    expect((await getProvider(provider.id))?.enabled).toBe(false)
    expect((await listProviders())[0].enabled).toBe(false)
    expect((await getLogicalModel(model.id))?.enabled).toBe(true)
    expect((await listLogicalModels())[0].enabled).toBe(true)
    expect((await getUpstreamModel(upstreamModel.id))?.enabled).toBe(false)
    expect((await listUpstreamModels())[0].enabled).toBe(false)
  })

  it('round-trips nested raw usage when request metrics are updated', async () => {
    const log = await createRequestLog({
      logicalModelId: 'model',
      protocol: 'openai-responses',
      status: 'failed',
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
    const rawUsage = {
      input_tokens: 1200,
      input_tokens_details: { cached_tokens: 1024 },
      output_tokens: 80,
      output_tokens_details: { reasoning_tokens: 48 },
    }

    await updateRequestLogStatus(log.id, {
      status: 'success',
      totalDurationMilliseconds: 120,
      totalTokens: 1280,
      inputTokens: 1200,
      outputTokens: 80,
      cachedInputTokens: 1024,
      cacheCreationInputTokens: 0,
      promptCacheHit: true,
      rawUsage,
    })

    expect((await listRequestLogs())[0]).toMatchObject({
      id: log.id,
      cachedInputTokens: 1024,
      cacheCreationInputTokens: 0,
      promptCacheHit: true,
      rawUsage,
    })
  })

  it('disables active upstream models when their provider is deleted', async () => {
    const provider = await createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 1_000,
      enabled: true,
      upstreamUrls: '{}',
    })
    await createUpstreamModel({
      providerId: provider.id,
      upstreamModelId: 'upstream-model',
      endpoints: [
        {
          protocol: 'openai-completions',
          upstreamUrl: 'https://api.example.com/v1/chat/completions',
          customAuthHeader: null,
        },
      ],
      priority: 1,
      enabled: true,
    })

    await deleteProvider(provider.id)

    expect((await listUpstreamModels())[0].enabled).toBe(false)
  })

  it('prunes request logs and their attempts beyond the retention count', async () => {
    const provider = await createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 30_000,
      enabled: true,
      upstreamUrls: '{}',
    })
    const logs = await Promise.all([1, 2, 3].map(index => createRequestLog({
      id: `req_retention_${index}`,
      logicalModelId: 'model_default',
      protocol: 'openai-completions',
      status: 'success',
      totalDurationMilliseconds: index,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
    })))
    await Promise.all(logs.map(log => createRequestAttempt({
      requestId: log.id,
      providerId: provider.id,
      upstreamModelId: 'upstream-model',
      attemptIndex: 0,
      status: 'success',
      errorCode: null,
      errorMessage: null,
      durationMilliseconds: 1,
    })))

    await pruneRequestLogs(2)

    const remainingLogs = await listRequestLogs(10)
    expect(remainingLogs).toHaveLength(2)
    const remainingIds = new Set(remainingLogs.map(log => log.id))
    const remainingAttempts = (await Promise.all(logs.map(log => listAttemptsByRequest(log.id))))
      .flat()
      .filter(attempt => remainingIds.has(attempt.requestId))
    expect(remainingAttempts).toHaveLength(2)
    expect((await getProviderStats(0))[0].requests).toBe(2)
  })

  it('attributes failover statistics to the final attempt only', async () => {
    const firstProvider = await createProvider({
      name: 'First',
      apiKeyReference: 'first_key',
      timeoutMilliseconds: 30_000,
      enabled: true,
      upstreamUrls: '{}',
    })
    const secondProvider = await createProvider({
      name: 'Second',
      apiKeyReference: 'second_key',
      timeoutMilliseconds: 30_000,
      enabled: true,
      upstreamUrls: '{}',
    })
    const log = await createRequestLog({
      id: 'req_failover_stats',
      logicalModelId: 'model_default',
      protocol: 'openai-completions',
      status: 'success',
      totalDurationMilliseconds: 10,
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
    await createRequestAttempt({
      requestId: log.id,
      providerId: firstProvider.id,
      upstreamModelId: 'first-model',
      attemptIndex: 0,
      status: 'failed',
      errorCode: 'Status_503',
      errorMessage: 'failed',
      durationMilliseconds: 5,
    })
    await createRequestAttempt({
      requestId: log.id,
      providerId: secondProvider.id,
      upstreamModelId: 'second-model',
      attemptIndex: 1,
      status: 'success',
      errorCode: null,
      errorMessage: null,
      durationMilliseconds: 5,
    })

    const stats = await getProviderStats(0)
    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({ providerId: secondProvider.id, requests: 1, success: 1, failed: 0 })
  })
})
