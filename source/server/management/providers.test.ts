import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeychainApi } from '@common/keychain'
import { closeDatabase, initDatabase } from '../database'
import { createProvider, getProvider } from '../database/store'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'
import { deleteProviderAndSecret } from './providers'

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
      upstreamUrls: '{}',
    })

    await deleteProviderAndSecret(provider.id)

    expect(await getProvider(provider.id)).toMatchObject({ deletedTime: expect.any(Number) })
    expect(secretStore.delete).toHaveBeenCalledWith('key_reference')
  })
})
