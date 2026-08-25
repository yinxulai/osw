import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import { createLogicalModel, deleteLogicalModel, listLogicalModels, listSchedulingPolicies, updateLogicalModel, upsertSchedulingPolicy } from './logical-model-store'
import { createProvider } from './provider-store'
import { createProviderModelRoute } from './model-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-logical-model-store-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('logical model store', () => {
  it('creates and updates logical models with real database persistence', async () => {
    const created = await createLogicalModel({ name: 'production', description: 'prod routing', enabled: true })

    expect(await listLogicalModels()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, name: 'production' }),
    ]))

    const updated = await updateLogicalModel(created.id, { name: 'production-v2', description: 'updated', enabled: false })
    expect(updated).toMatchObject({
      id: created.id,
      name: 'production-v2',
      description: 'updated',
      enabled: false,
    })
  })

  it('manages scheduling policies with the actual sqlite schema', async () => {
    const provider = await createProvider({
      name: 'Scheduling Provider',
      apiKeyReference: 'key_scheduler',
      timeoutMilliseconds: 15_000,
      enabled: true,
    })
    const model = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'scheduler-model',
      priority: 10,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: false,
      }],
    })

    const policy = await upsertSchedulingPolicy({
      logicalModelId: 'default',
      providerModelId: model.id,
      priority: 3,
      weight: 80,
      enabled: true,
    })

    expect(policy).toMatchObject({
      logicalModelId: 'default',
      providerModelId: model.id,
      priority: 3,
      weight: 80,
      enabled: true,
    })

    expect(await listSchedulingPolicies('default')).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: model.id, priority: 3, weight: 80 }),
    ]))

    await deleteLogicalModel('default')
    expect(await listLogicalModels(true)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'default', deletedTime: expect.any(Number) }),
    ]))
  })
})
