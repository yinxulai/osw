import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, getDb, initDatabase } from './index'
import {
  countRequestLogs,
  createLogicalModel,
  createProvider,
  createRequestAttempt,
  createRequestLog,
  createUpstreamModel,
  deleteLogicalModel,
  deleteProvider,
  deleteUpstreamModel,
  getLatencyDistribution,
  getFailureReasons,
  getModelStats,
  getProvider,
  getProviderHealth,
  getStatsSummary,
  getProviderStats,
  getRequestTrend,
  getSettings,
  getUpstreamModel,
  listAttemptsByRequest,
  listLogicalModels,
  listProviders,
  listProviderHealth,
  listRequestLogs,
  listUpstreamModelsByProvider,
  onSettingsChanged,
  pruneRequestLogsBefore,
  pruneRequestLogs,
  recordHealthSuccess,
  recordProviderFailure,
  resetProviderHealth,
  updateLogicalModel,
  updateProvider,
  updateRequestLogStatus,
  updateSettings,
  updateUpstreamModel,
} from './store'

let directory: string

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-store-complete-'))
  await initDatabase(directory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const providerInput = (name = 'Provider') => ({ name, apiKeyReference: `${name}-key`, timeoutMilliseconds: 10_000, upstreamUrls: '{"openai-completions":"https://api.example.com/v1"}' })
const logInput = (id?: string) => ({ ...(id ? { id } : {}), logicalModelId: 'auto', protocol: 'openai-completions' as const, upstreamProtocol: null, status: 'pending' as const, totalDurationMilliseconds: 1, totalTokens: null, inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, promptCacheHit: null, rawUsage: null, ttftMilliseconds: null, cacheHit: null })

function oldTimestampLog(id: string, time: number) {
  getDb().$client.prepare('INSERT INTO request_logs (id, logicalModelId, protocol, status, metadata, createdTime) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'auto', 'openai-completions', 'success', null, time)
  getDb().$client.prepare('INSERT INTO request_metrics (requestId, key, value, unit, updatedTime) VALUES (?, ?, ?, ?, ?)').run(id, 'durationMilliseconds', 10, 'milliseconds', time)
}

describe('provider and model CRUD', () => {
  it('creates, updates, lists, soft-deletes, and restores visibility', async () => {
    const provider = await createProvider({ ...providerInput(), description: 'initial', enabled: true })
    expect(await getProvider(provider.id)).toMatchObject({ name: 'Provider', description: 'initial', apiKeyReference: 'Provider-key' })
    const updated = await updateProvider(provider.id, { name: 'Updated', description: 'changed', enabled: false, timeoutMilliseconds: 20_000, upstreamUrls: '{}' })
    expect(updated).toMatchObject({ name: 'Updated', enabled: false, timeoutMilliseconds: 20_000, upstreamUrls: '{}' })
    expect((await listProviders()).map(item => item.id)).toContain(provider.id)
    await deleteProvider(provider.id)
    expect(await getProvider(provider.id)).toMatchObject({ deletedTime: expect.any(Number) })
    expect(await listProviders()).toHaveLength(0)
    expect(await listProviders(true)).toHaveLength(1)
  })

  it('rejects missing provider updates and keeps provider setting conflict updates in place', async () => {
    await expect(updateProvider('prov_missing', { name: 'x' })).rejects.toThrow('provider not found')
    const provider = await createProvider(providerInput())
    await updateProvider(provider.id, { apiKeyReference: 'new-key' })
    const rows = getDb().$client.prepare('SELECT key, value FROM provider_settings WHERE providerId = ? ORDER BY key').all(provider.id) as Array<{ key: string; value: string }>
    expect(rows).toEqual(expect.arrayContaining([{ key: 'security.secretReference', value: 'new-key' }]))
    expect(rows).toHaveLength(3)
  })

  it('handles model defaults, endpoint reuse, optional endpoints, and soft deletion', async () => {
    const provider = await createProvider(providerInput())
    const first = await createUpstreamModel({ providerId: provider.id, upstreamModelId: 'model-a', priority: 7 })
    expect(first).toMatchObject({ endpoints: [], priority: 7, enabled: true })
    const second = await createUpstreamModel({ providerId: provider.id, upstreamModelId: 'model-b', priority: 1, endpoints: [{ protocol: 'openai-completions', upstreamUrl: '', customAuthHeader: null, protocolConversionEnabled: false }] })
    const third = await createUpstreamModel({ providerId: provider.id, upstreamModelId: 'model-c', priority: 2, endpoints: [{ protocol: 'openai-completions', upstreamUrl: 'https://override.example', customAuthHeader: null, protocolConversionEnabled: false }, { protocol: 'anthropic-messages', upstreamUrl: 'https://anthropic.example', customAuthHeader: null, protocolConversionEnabled: true }] })
    expect((await getUpstreamModel(second.id))?.endpoints[0].upstreamUrl).toBe('https://invalid.local')
    expect((await getUpstreamModel(third.id))?.endpoints).toHaveLength(2)
    expect((await listUpstreamModelsByProvider(provider.id)).map(model => model.upstreamModelId)).toEqual(['model-a', 'model-b', 'model-c'])
    await updateUpstreamModel(first.id, { upstreamModelId: 'model-a2', enabled: false })
    expect(await getUpstreamModel(first.id)).toMatchObject({ upstreamModelId: 'model-a2', enabled: false })
    await deleteUpstreamModel(first.id)
    expect((await listUpstreamModelsByProvider(provider.id)).map(model => model.id)).not.toContain(first.id)
    expect((await listUpstreamModelsByProvider(provider.id, true)).map(model => model.id)).toContain(first.id)
    await expect(updateUpstreamModel('model_missing', {})).rejects.toThrow('provider model not found')
  })

  it('supports logical model defaults, updates, soft deletion, and unique-name conflicts', async () => {
    const model = await createLogicalModel({ name: 'logical', description: undefined, enabled: undefined })
    expect(model).toMatchObject({ description: '', enabled: true, deletedTime: null })
    expect(await updateLogicalModel(model.id, { name: 'logical-updated', enabled: false })).toMatchObject({ name: 'logical-updated', enabled: false })
    await deleteLogicalModel(model.id)
    expect(await listLogicalModels()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: model.id })]))
    expect(await listLogicalModels(true)).toEqual(expect.arrayContaining([expect.objectContaining({ id: model.id, deletedTime: expect.any(Number) })]))
    await expect(createLogicalModel({ name: 'auto', description: '', enabled: true })).rejects.toThrow()
  })
})

describe('health and settings', () => {
  it('records threshold, exponential capped failures, success, reset, and missing rows safely', async () => {
    const provider = await createProvider(providerInput())
    expect(await getProviderHealth(provider.id)).toMatchObject({ consecutiveFailures: 0, cooldownUntilTime: null })
    await recordProviderFailure(provider.id, 2, 10, 15)
    expect(await getProviderHealth(provider.id)).toMatchObject({ consecutiveFailures: 1, cooldownUntilTime: null })
    await recordProviderFailure(provider.id, 2, 10, 15)
    const health = await getProviderHealth(provider.id)
    expect(health).toMatchObject({ consecutiveFailures: 2, cooldownUntilTime: expect.any(Number) })
    await recordProviderFailure(provider.id, 2, 10, 15)
    expect((await getProviderHealth(provider.id))!.cooldownUntilTime! - health!.cooldownUntilTime!).toBeGreaterThanOrEqual(0)
    await recordHealthSuccess(provider.id)
    expect(await getProviderHealth(provider.id)).toMatchObject({ consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: expect.any(Number) })
    await resetProviderHealth(provider.id)
    expect(await getProviderHealth(provider.id)).toMatchObject({ consecutiveFailures: 0, lastSuccessTime: null, lastFailureTime: null })
    await recordProviderFailure('prov_missing', 1, 1, 1)
    expect(await listProviderHealth()).toHaveLength(1)
  })

  it('uses defaults, persists all optional values, skips undefined, and notifies listeners', async () => {
    expect(await getSettings({ listenPort: 19000 })).toMatchObject({ listenPort: 19000, listenHost: '127.0.0.1', autoLaunch: false })
    const listener = vi.fn()
    const unsubscribe = onSettingsChanged(listener)
    await updateSettings({ listenHost: '0.0.0.0', listenPort: 19001, captureRequestContent: true, logRetentionDays: null, autoLaunch: true, cooldownBaseSeconds: undefined })
    expect(await getSettings()).toMatchObject({ listenHost: '0.0.0.0', listenPort: 19001, captureRequestContent: true, logRetentionDays: null, autoLaunch: true })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    await updateSettings({ listenPort: 19002 })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('request logs and analytics', () => {
  it('creates, updates metrics/usages, filters, counts, and orders attempts', async () => {
    const provider = await createProvider(providerInput())
    const log = await createRequestLog({ ...logInput('req_crud'), status: 'failed', totalTokens: 3 })
    const attempt1 = await createRequestAttempt({ requestId: log.id, providerId: provider.id, upstreamModelId: 'a', attemptIndex: 1, status: 'failed', errorCode: 'TIMEOUT', errorMessage: 'timeout', upstreamRequestId: 'u1', errorResponse: '{"x":1}', durationMilliseconds: 20 })
    await createRequestAttempt({ requestId: log.id, providerId: provider.id, upstreamModelId: 'a', attemptIndex: 0, status: 'success', durationMilliseconds: 10 })
    await updateRequestLogStatus(log.id, { status: 'success', totalDurationMilliseconds: 42, totalTokens: 8, inputTokens: 5, outputTokens: 3, ttftMilliseconds: 7, promptCacheHit: false, cacheHit: true })
    expect(await listAttemptsByRequest(log.id)).toEqual([expect.objectContaining({ attemptIndex: 0 }), expect.objectContaining({ id: attempt1.id, attemptIndex: 1, errorResponse: '{"x":1}' })])
    expect(await listRequestLogs(10, 0, { providerId: provider.id, protocol: 'openai-completions', status: 'success' })).toEqual([expect.objectContaining({ totalDurationMilliseconds: 42, totalTokens: 8, inputTokens: 5, outputTokens: 3, promptCacheHit: false, cacheHit: true })])
    expect(await countRequestLogs({ providerId: provider.id })).toBe(1)
    expect(await countRequestLogs({ status: 'cancelled' })).toBe(0)
  })

  it('supports empty and invalid prune inputs and removes old dependent rows', async () => {
    const provider = await createProvider(providerInput())
    const oldId = 'req_old', newId = 'req_new'
    oldTimestampLog(oldId, Date.now() - 3 * 24 * 60 * 60 * 1000)
    await createRequestAttempt({ requestId: oldId, providerId: provider.id, upstreamModelId: 'old', attemptIndex: 0, status: 'failed', durationMilliseconds: 1 })
    await createRequestLog({ ...logInput(newId), status: 'success' })
    await pruneRequestLogs(0, 0)
    expect(await countRequestLogs()).toBe(2)
    expect(await pruneRequestLogsBefore(3)).toBe(1)
    expect(await countRequestLogs()).toBe(1)
    expect(await pruneRequestLogsBefore(0)).toBe(0)
    await pruneRequestLogs(1, 1)
    expect(await countRequestLogs()).toBe(1)
  })

  it('returns empty statistics and covers trends, latency buckets, model stats, and failure categories', async () => {
    expect(await getStatsSummary(Date.now())).toEqual({ totalRequests: 0, successCount: 0, failedCount: 0, successRate: 0, avgLatencyMs: 0, totalTokens: 0 })
    expect(await getRequestTrend(Date.now(), 3)).toHaveLength(3)
    expect(await getLatencyDistribution(Date.now())).toHaveLength(5)
    const provider = await createProvider({ ...providerInput('Stats'), name: 'Stats' })
    const log = await createRequestLog({ ...logInput('req_stats'), status: 'failed', totalDurationMilliseconds: 6000, totalTokens: null })
    await createRequestAttempt({ requestId: log.id, providerId: provider.id, upstreamModelId: 'stats-model', attemptIndex: 0, status: 'failed', errorCode: 'AUTH_401', durationMilliseconds: 6000 })
    await updateRequestLogStatus(log.id, { totalTokens: 10 })
    expect(await getStatsSummary(0)).toMatchObject({ totalRequests: 1, failedCount: 1, totalTokens: 10, avgLatencyMs: 6000 })
    expect(await getModelStats(0, 0)).toHaveLength(0)
    expect(await getModelStats(0)).toEqual([expect.objectContaining({ upstreamModelId: 'stats-model', requests: 1, avgLatencyMs: 0 })])
    expect(await getFailureReasons(0)).toEqual([{ reason: '认证失败', count: 1 }])
    expect(await getProviderStats(0)).toEqual([expect.objectContaining({ providerName: 'Stats', failed: 1 })])
    const buckets = await getLatencyDistribution(0)
    expect(buckets.find(bucket => bucket.range === '> 5s')?.count).toBe(1)
  })
})
