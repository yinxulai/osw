import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeychainApi } from '@common/keychain'
import { closeDatabase, initDatabase } from '../database'
import { createProvider, getProvider, listProviders } from '@server/database/provider-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { deleteProviderAndSecret, providerRoutes } from './routes/catalog/providers'

function mockResponse() {
  return { setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse
}

let temporaryDirectory: string
let secretStore: KeychainApi

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-provider-'))
  await initDatabase(temporaryDirectory)
  secretStore = {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  }
  configureSecretStore(secretStore)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('provider management', () => {
  it('deletes the stored API key when deleting a provider', async () => {
    const provider = await createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })

    await deleteProviderAndSecret(provider.id)

    expect(await getProvider(provider.id)).toMatchObject({ deletedTime: expect.any(Number) })
    expect(secretStore.delete).toHaveBeenCalledWith('key_reference')
  })

  it('creates a provider without an API key for local or test clusters', async () => {
    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/create', res, {
      name: 'Local Cluster',
    })

    expect(secretStore.set).not.toHaveBeenCalled()
    const providers = await listProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({ name: 'Local Cluster', enabled: true })
  })

  it('stores the API key when one is provided', async () => {
    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/create', res, {
      name: 'OpenAI',
      apiKey: 'sk-test',
    })

    expect(secretStore.set).toHaveBeenCalledTimes(1)
    expect(secretStore.set).toHaveBeenCalledWith(expect.stringMatching(/^key_/), 'sk-test')
  })
})
