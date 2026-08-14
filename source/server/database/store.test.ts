import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import {
  createBinding,
  createLogicalModel,
  createProvider,
  getBinding,
  getLogicalModel,
  getProvider,
  listBindingsByModel,
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
  it('maps SQLite integer flags to booleans', async () => {
    const provider = await createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 1_000,
      enabled: false,
      upstreamUrls: '{}',
    })
    const model = await createLogicalModel({ name: 'Model', description: '', enabled: true })
    const binding = await createBinding({
      logicalModelId: model.id,
      providerId: provider.id,
      protocol: 'openai-completions',
      upstreamUrl: 'https://api.example.com/v1/chat/completions',
      upstreamModelId: 'upstream-model',
      priority: 1,
      enabled: false,
      customAuthHeader: null,
    })

    expect((await getProvider(provider.id))?.enabled).toBe(false)
    expect((await listProviders())[0].enabled).toBe(false)
    expect((await getLogicalModel(model.id))?.enabled).toBe(true)
    expect((await listLogicalModels())[0].enabled).toBe(true)
    expect((await getBinding(binding.id))?.enabled).toBe(false)
    expect((await listBindingsByModel(model.id))[0].enabled).toBe(false)
  })

  it('disables active bindings when their provider is deleted', async () => {
    const provider = await createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 1_000,
      enabled: true,
      upstreamUrls: '{}',
    })
    const model = await createLogicalModel({ name: 'Model', description: '', enabled: true })
    await createBinding({
      logicalModelId: model.id,
      providerId: provider.id,
      protocol: 'openai-completions',
      upstreamUrl: 'https://api.example.com/v1/chat/completions',
      upstreamModelId: 'upstream-model',
      priority: 1,
      enabled: true,
      customAuthHeader: null,
    })

    await deleteProvider(provider.id)

    expect((await listBindingsByModel(model.id))[0].enabled).toBe(false)
  })
})
