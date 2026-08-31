import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeychainApi } from '@common/keychain'
import { closeDatabase, initDatabase } from '@server/database'
import { listProviders } from '@server/database/provider-store'
import { listProviderModelRoutesByProvider } from '@server/database/model-store'
import { listSchedulingPolicies } from '@server/database/logical-model-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'

const requestHttpBuffered = vi.fn()

vi.mock('@server/infrastructure/network/core-network', () => ({
  coreNetworkClient: {
    requestHttpBuffered: (...args: unknown[]) => requestHttpBuffered(...args),
  },
}))

import {
  findManagedProvider,
  removeManagedProvider,
  syncFreeModelSource,
} from './sync-engine'

const SOURCE_KEY = 'openrouter-free'

function mockModelsResponse(ids: string[]) {
  requestHttpBuffered.mockResolvedValue({
    statusCode: 200,
    headers: {},
    body: JSON.stringify({
      data: ids.map(id => ({ id, name: id, pricing: { prompt: '0', completion: '0' } })),
    }),
  })
}

let temporaryDirectory: string
const secrets = new Map<string, string>()

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-free-models-'))
  await initDatabase(temporaryDirectory)
  secrets.clear()
  const secretStore: KeychainApi = {
    set: vi.fn(async (reference: string, value: string) => { secrets.set(reference, value) }),
    get: vi.fn(async (reference: string) => secrets.get(reference) ?? null),
    delete: vi.fn(async (reference: string) => { secrets.delete(reference) }),
  }
  configureSecretStore(secretStore)
  requestHttpBuffered.mockReset()
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('syncFreeModelSource (generic engine)', () => {
  it('creates a managed provider, models and scheduling policies on first sync', async () => {
    mockModelsResponse(['model-a:free', 'model-b:free'])

    const result = await syncFreeModelSource(SOURCE_KEY)

    expect(result.added).toBe(2)
    expect(result.removed).toBe(0)
    expect(result.total).toBe(2)

    const managed = await findManagedProvider(SOURCE_KEY)
    expect(managed).not.toBeNull()
    expect(managed!.name).toBe('OpenRouter 免费')

    const routes = await listProviderModelRoutesByProvider(managed!.id, false)
    expect(routes.map(route => route.modelName).sort()).toEqual(['model-a:free', 'model-b:free'])

    const policies = await listSchedulingPolicies('default')
    expect(policies).toHaveLength(2)
    expect(policies.every(policy => policy.enabled)).toBe(true)
  })

  it('diffs on subsequent sync: adds new models and removes vanished ones', async () => {
    mockModelsResponse(['model-a:free', 'model-b:free'])
    await syncFreeModelSource(SOURCE_KEY)
    const managed = await findManagedProvider(SOURCE_KEY)

    mockModelsResponse(['model-b:free', 'model-c:free'])
    const result = await syncFreeModelSource(SOURCE_KEY)

    expect(result.added).toBe(1)
    expect(result.removed).toBe(1)
    expect(result.total).toBe(2)

    const routes = await listProviderModelRoutesByProvider(managed!.id, false)
    expect(routes.map(route => route.modelName).sort()).toEqual(['model-b:free', 'model-c:free'])

    const policies = await listSchedulingPolicies('default')
    expect(policies.map(policy => policy.providerModelId).sort())
      .toEqual(routes.map(route => route.id).sort())
  })

  it('removes the managed provider and its models when the source is disabled', async () => {
    mockModelsResponse(['model-a:free'])
    await syncFreeModelSource(SOURCE_KEY)
    const managed = await findManagedProvider(SOURCE_KEY)
    expect(managed).not.toBeNull()

    await removeManagedProvider(SOURCE_KEY)

    expect(await findManagedProvider(SOURCE_KEY)).toBeNull()
    const providers = await listProviders(false)
    expect(providers.some(provider => provider.id === managed!.id)).toBe(false)
    expect(await listSchedulingPolicies('default')).toHaveLength(0)
  })

  it('throws and records an error state when the upstream fetch fails', async () => {
    requestHttpBuffered.mockResolvedValue({ statusCode: 401, headers: {}, body: '{}' })

    await expect(syncFreeModelSource(SOURCE_KEY)).rejects.toThrow(/认证|API Key/)

    const managed = await findManagedProvider(SOURCE_KEY)
    expect(managed).not.toBeNull()
    // 失败后 provider 已创建但没有模型
    expect(await listProviderModelRoutesByProvider(managed!.id, false)).toHaveLength(0)
  })

  it('rejects concurrent syncs of the same source', async () => {
    mockModelsResponse(['model-a:free'])
    // 让第一次调用挂起，触发并发保护
    let release: () => void = () => undefined
    requestHttpBuffered.mockReturnValueOnce(new Promise(resolve => {
      release = () => resolve({ statusCode: 200, headers: {}, body: JSON.stringify({ data: [] }) })
    }))

    const first = syncFreeModelSource(SOURCE_KEY)
    await expect(syncFreeModelSource(SOURCE_KEY)).rejects.toThrow('正在同步中')
    release()
    await first
  })
})
