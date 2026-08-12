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

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-store-'))
  initDatabase(temporaryDirectory)
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('store row mapping', () => {
  it('maps SQLite integer flags to booleans', () => {
    const provider = createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 1_000,
      enabled: false,
    })
    const model = createLogicalModel({ name: 'Model', description: '', enabled: true })
    const binding = createBinding({
      logicalModelId: model.id,
      providerId: provider.id,
      protocol: 'openai',
      upstreamUrl: 'https://api.example.com/v1/chat/completions',
      upstreamModelId: 'upstream-model',
      priority: 1,
      enabled: false,
      customAuthHeader: null,
    })

    expect(getProvider(provider.id)?.enabled).toBe(false)
    expect(listProviders()[0].enabled).toBe(false)
    expect(getLogicalModel(model.id)?.enabled).toBe(true)
    expect(listLogicalModels()[0].enabled).toBe(true)
    expect(getBinding(binding.id)?.enabled).toBe(false)
    expect(listBindingsByModel(model.id)[0].enabled).toBe(false)
  })

  it('disables active bindings when their provider is deleted', () => {
    const provider = createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 1_000,
      enabled: true,
    })
    const model = createLogicalModel({ name: 'Model', description: '', enabled: true })
    createBinding({
      logicalModelId: model.id,
      providerId: provider.id,
      protocol: 'openai',
      upstreamUrl: 'https://api.example.com/v1/chat/completions',
      upstreamModelId: 'upstream-model',
      priority: 1,
      enabled: true,
      customAuthHeader: null,
    })

    deleteProvider(provider.id)

    expect(listBindingsByModel(model.id)[0].enabled).toBe(false)
  })
})
