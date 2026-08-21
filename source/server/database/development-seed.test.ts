import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { KeychainApi } from '@common/keychain'
import { closeDatabase, getDb, initDatabase } from './index'
import { seedDevelopmentData } from './development-seed'
import { providerModels, requestUsages } from './schema'
import { createProvider, getRequestLog, listAttemptsByRequest, listLogicalModels, listProviders, listRequestContents, listRequestLogs, listRequestUsages } from './store'

let temporaryDirectory: string
let secretStore: KeychainApi

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-seed-'))
  await initDatabase(temporaryDirectory)
  secretStore = {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  }
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('development seed', () => {
  it('populates an empty development database with representative data', async () => {
    expect(await seedDevelopmentData(secretStore)).toBe(true)

    expect(await listProviders()).toHaveLength(5)
    expect(await listLogicalModels()).toHaveLength(1)
    expect(getDb().select({ id: providerModels.id }).from(providerModels).all()).toHaveLength(10)
    expect(await listRequestLogs()).toHaveLength(30)
    const firstBatchRequests = await listRequestLogs(30, 0)
    const successfulRequest = await getRequestLog(firstBatchRequests.find(request => request.status === 'success')!.id)
    expect(successfulRequest).toEqual(expect.objectContaining({
      totalDurationMilliseconds: expect.any(Number),
      ttftMilliseconds: expect.any(Number),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    }))
    const successfulRequestId = successfulRequest!.id
    expect((await listRequestUsages(successfulRequestId))[0]).toEqual(expect.objectContaining({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    }))
    expect(getDb().select().from(providerModels).all()).toHaveLength(10)
    expect(getDb().select().from(requestUsages).where(eq(requestUsages.requestId, successfulRequestId)).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'estimatedCost', unit: 'USD' }),
    ]))
    expect((await listRequestContents(successfulRequestId))[0]).toEqual(expect.objectContaining({
      captureStatus: 'captured',
      requestMethod: 'POST',
      responseStatus: 200,
      requestBody: expect.stringContaining('messages'),
      responseBody: expect.stringContaining('chat.completion'),
    }))
    const failedRequestId = firstBatchRequests.find(request => request.status === 'failed')!.id
    expect(await listRequestUsages(failedRequestId)).toHaveLength(0)
    expect(await listRequestContents(failedRequestId)).toHaveLength(1)
    expect(await listAttemptsByRequest(failedRequestId)).toHaveLength(2)
    expect(new Set((await listRequestLogs()).map(request => request.protocol))).toEqual(new Set([
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
    expect(await listProviders()).toHaveLength(6)
    expect(secretStore.set).toHaveBeenCalledTimes(5)

    const firstBatchIds = new Set((await listRequestLogs()).map(request => request.id))
    expect(await seedDevelopmentData(secretStore, { allowExisting: true })).toBe(true)
    expect(await listProviders()).toHaveLength(6)
    expect(await listLogicalModels()).toHaveLength(1)
    expect(getDb().select({ id: providerModels.id }).from(providerModels).all()).toHaveLength(10)
    const allRequests = await listRequestLogs(100)
    expect(allRequests).toHaveLength(60)
    const secondBatchRequests = allRequests.filter(request => !firstBatchIds.has(request.id))
    expect(secondBatchRequests).toHaveLength(30)
    const secondBatchSuccess = secondBatchRequests.find(request => request.status === 'success')!
    const secondBatchFailure = secondBatchRequests.find(request => request.status === 'failed')!
    expect(await listRequestUsages(secondBatchSuccess.id)).not.toHaveLength(0)
    expect(await listRequestContents(secondBatchSuccess.id)).toHaveLength(1)
    expect(await listAttemptsByRequest(secondBatchFailure.id)).toHaveLength(2)
    expect(secretStore.set).toHaveBeenCalledTimes(5)
  })
})
