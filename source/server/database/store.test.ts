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
  listUpstreamModelsByLogicalModel,
  deleteProvider,
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
      logicalModelId: model.id,
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
    expect((await listUpstreamModelsByLogicalModel(model.id))[0].enabled).toBe(false)
  })

  it('disables active upstream models when their provider is deleted', async () => {
    const provider = await createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 1_000,
      enabled: true,
      upstreamUrls: '{}',
    })
    const model = await createLogicalModel({ name: 'Model', description: '', enabled: true })
    await createUpstreamModel({
      logicalModelId: model.id,
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

    expect((await listUpstreamModelsByLogicalModel(model.id))[0].enabled).toBe(false)
  })
})
