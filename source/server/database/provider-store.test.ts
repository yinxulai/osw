import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import {
  createProvider,
  createProviderEndpoint,
  deleteProvider,
  deleteProviderSetting,
  getProvider,
  getProviderEndpoint,
  getProviderSetting,
  listProviderEndpoints,
  listProviders,
  listProviderSettings,
  replaceProviderEndpoints,
  updateProvider,
  upsertProviderSetting,
} from './provider-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-provider-store-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('provider store', () => {
  it('persists provider settings and endpoints using the real sqlite database', async () => {
    const provider = await createProvider({
      name: 'OpenAI',
      apiKeyReference: 'key_openai',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })

    expect(await getProvider(provider.id)).toMatchObject({
      id: provider.id,
      name: 'OpenAI',
      enabled: true,
    })

    expect(await listProviderSettings(provider.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: provider.id, key: 'security.secretReference', value: 'key_openai' }),
      expect.objectContaining({ providerId: provider.id, key: 'connection.timeoutMilliseconds', value: '30000' }),
    ]))

    expect(await getProviderSetting(provider.id, 'security.secretReference')).toMatchObject({
      providerId: provider.id,
      key: 'security.secretReference',
      value: 'key_openai',
    })

    await upsertProviderSetting({
      providerId: provider.id,
      key: 'custom.label',
      value: 'primary',
      valueType: 'string',
    })

    expect(await getProviderSetting(provider.id, 'custom.label')).toMatchObject({
      value: 'primary',
      valueType: 'string',
    })

    const endpoint = await createProviderEndpoint({
      providerId: provider.id,
      protocol: 'openai-completions',
      url: 'https://api.openai.com/v1/chat/completions',
      enabled: true,
    })

    expect(await getProviderEndpoint(endpoint.id)).toMatchObject({
      providerId: provider.id,
      protocol: 'openai-completions',
      url: 'https://api.openai.com/v1/chat/completions',
    })

    await replaceProviderEndpoints(provider.id, {
      'openai-completions': 'https://api.openai.com/v1/chat/completions',
      'openai-responses': 'https://api.openai.com/v1/responses',
    })

    expect((await listProviderEndpoints(provider.id)).map(entry => entry.protocol).sort()).toEqual([
      'openai-completions',
      'openai-responses',
    ])

    await deleteProviderSetting(provider.id, 'custom.label')
    expect(await getProviderSetting(provider.id, 'custom.label')).toBeUndefined()
  })

  it('soft-deletes providers and keeps deleted rows available when requested', async () => {
    const provider = await createProvider({
      name: 'Soft Deleted',
      apiKeyReference: 'key_soft_delete',
      timeoutMilliseconds: 10_000,
      enabled: true,
    })

    await updateProvider(provider.id, { enabled: false, description: 'disabled before delete' })
    await deleteProvider(provider.id)

    expect(await getProvider(provider.id)).toMatchObject({
      id: provider.id,
      enabled: false,
      deletedTime: expect.any(Number),
    })
    expect((await listProviders()).map(item => item.id)).not.toContain(provider.id)
    expect((await listProviders(true)).map(item => item.id)).toContain(provider.id)
  })
})
