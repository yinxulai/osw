import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { SecretStore } from '@common/secret-store'
import { closeDatabases, getConfigDb, getDataDb, initDatabases } from './index'
import { seedDevelopmentData } from './development-seed'
import { providerModels, providers } from './config-schema'
import { requestUsages } from './data-schema'
import { createProvider, listProviders } from './provider-store'
import { listLogicalModels } from './logical-model-store'
import { getAttemptUsage, getRequestLog, getRequestUsage, listAttemptContents, listAttemptsByRequest, listRequestContents, listRequestLogs } from './request-log-store'

let temporaryDirectory: string
let secretStore: SecretStore

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-seed-'))
  await initDatabases(temporaryDirectory)
  secretStore = {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  }
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('development seed', () => {
  it('populates an empty development database with representative data', async () => {
    expect(await seedDevelopmentData(secretStore)).toBe(true)

    expect(await listProviders()).toHaveLength(4)
    expect((await listProviders()).map(provider => provider.name)).toEqual(expect.arrayContaining(['OpenAI', 'Anthropic', 'Volcengine Ark', 'DeepSeek']))
    expect((await listProviders()).every(provider => !provider.name.includes('开发示例'))).toBe(true)
    expect(await listLogicalModels()).toHaveLength(1)
    // 已删除的供应商 / 模型不进活跃列表，但行确实在表里（`deletedTime` 非空即为证据）。
    expect(await listProviders(true)).toHaveLength(5)
    const retiredProviderRows = getConfigDb().select().from(providers).where(eq(providers.id, 'prov_dev_retired')).all()
    expect(retiredProviderRows).toEqual([expect.objectContaining({ name: 'Retired Demo Provider', enabled: false, deletedTime: expect.any(Number) })])
    const providerModelRows = getConfigDb().select().from(providerModels).all()
    expect(providerModelRows).toHaveLength(8)
    expect(providerModelRows.filter(row => row.deletedTime !== null)).toEqual([
      expect.objectContaining({ id: 'model_dev_provider_8', providerId: 'prov_dev_retired', modelName: 'retired-demo-model', enabled: false }),
    ])
    expect(await listRequestLogs(200)).toHaveLength(120)
    const firstBatchRequests = await listRequestLogs(120, 0)
    const successfulRequest = await getRequestLog(firstBatchRequests.find(request => request.status === 'success')!.id)
    expect(successfulRequest).toEqual(expect.objectContaining({
      totalDurationMilliseconds: expect.any(Number),
      ttftMilliseconds: expect.any(Number),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    }))
    const successfulRequestId = successfulRequest!.id
    expect(await getRequestUsage(successfulRequestId)).toEqual(expect.objectContaining({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
      rawUsage: expect.objectContaining({
        prompt_tokens: expect.any(Number),
        completion_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
      }),
    }))
    expect(getConfigDb().select().from(providerModels).all()).toHaveLength(8)
    // 数值用量表里只有可求和的 token 类条目，原始报文另占一行 `raw`。
    const usageRows = getDataDb().select().from(requestUsages).where(eq(requestUsages.requestId, successfulRequestId)).all()
    expect(usageRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'inputTokens', value: expect.any(Number), rawValue: null }),
      expect.objectContaining({ type: 'raw', value: null, rawValue: expect.stringContaining('prompt_tokens') }),
    ]))
    // `totalTokens` 是派生值，不再单独存一行。
    expect(usageRows.some(row => row.type === 'totalTokens')).toBe(false)
    expect((await listRequestContents(successfulRequestId))[0]).toEqual(expect.objectContaining({
      requestMethod: 'POST',
      responseStatus: 200,
      requestBody: expect.stringContaining('messages'),
      responseBody: expect.stringContaining('chat.completion'),
    }))
    const failedRequestId = firstBatchRequests.find(request => request.status === 'failed')!.id
    expect(await getRequestUsage(failedRequestId)).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null })
    expect(await listRequestContents(failedRequestId)).toHaveLength(1)
    expect(await listAttemptContents(failedRequestId)).toHaveLength(1)
    expect(await listAttemptsByRequest(failedRequestId)).toHaveLength(2)
    const failedAttempts = await listAttemptsByRequest(failedRequestId)
    // 事实（TTFT、规则、原始 usage）与是否采集正文无关，总是写入。
    expect(failedAttempts.every(attempt => attempt.requestRewriteRuleIds.length === 0)).toBe(true)
    // 上游形态是尝试级事实：没等到响应的那次尝试无从判断，成功那次总有个确定值。
    expect(failedAttempts.find(attempt => attempt.status === 'failed')?.upstreamTransport).toBeNull()
    expect(['http', 'http-stream']).toContain(failedAttempts.find(attempt => attempt.status === 'success')?.upstreamTransport)
    const successfulAttempt = (await listAttemptsByRequest(successfulRequestId))[0]
    expect(await getAttemptUsage(successfulAttempt.id)).toEqual(expect.objectContaining({ totalTokens: expect.any(Number) }))
    expect(new Set((await listRequestLogs()).map(request => request.clientProtocol))).toEqual(new Set([
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
    ]))
    expect(secretStore.set).toHaveBeenCalledTimes(5)
  })

  it('does not modify a database that already has configuration', async () => {
    await createProvider({
      name: 'Existing provider',
      apiKeyReference: 'key_existing',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })

    expect(await seedDevelopmentData(secretStore)).toBe(false)
    expect((await listProviders()).map(provider => provider.name)).toEqual(['Existing provider'])
    expect(secretStore.set).not.toHaveBeenCalled()
  })

  it('fills missing fixtures without overwriting existing configuration', async () => {
    await createProvider({
      name: 'Existing provider',
      apiKeyReference: 'key_existing',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })

    expect(await seedDevelopmentData(secretStore, { allowExisting: true })).toBe(true)
    expect((await listProviders()).map(provider => provider.name)).toContain('Existing provider')
    expect(await listProviders()).toHaveLength(5)
    expect(secretStore.set).toHaveBeenCalledTimes(5)

    const firstBatchIds = new Set((await listRequestLogs(200)).map(request => request.id))
    expect(await seedDevelopmentData(secretStore, { allowExisting: true })).toBe(true)
    expect(await listProviders()).toHaveLength(5)
    expect(await listLogicalModels()).toHaveLength(1)
    expect(getConfigDb().select({ id: providerModels.id }).from(providerModels).all()).toHaveLength(8)
    const allRequests = await listRequestLogs(300)
    expect(allRequests).toHaveLength(240)
    const secondBatchRequests = allRequests.filter(request => !firstBatchIds.has(request.id))
    expect(secondBatchRequests).toHaveLength(120)
    const secondBatchSuccess = secondBatchRequests.find(request => request.status === 'success')!
    const secondBatchFailure = secondBatchRequests.find(request => request.status === 'failed')!
    expect((await getRequestUsage(secondBatchSuccess.id)).totalTokens).not.toBeNull()
    expect(await listRequestContents(secondBatchSuccess.id)).toHaveLength(1)
    expect(await listAttemptsByRequest(secondBatchFailure.id)).toHaveLength(2)
    expect(secretStore.set).toHaveBeenCalledTimes(5)
  })
})
