import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import {
  getProviderHealth,
  getProviderModelHealth,
  listProviderHealth,
  listProviderModelHealth,
  recordHealthSuccess,
  recordProviderFailure,
  recordProviderModelFailure,
  recordProviderModelHealthSuccess,
  resetProviderHealth,
  resetProviderModelHealth,
} from './health-store'
import { createProvider } from './provider-store'
import { createProviderModelRoute } from './model-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-health-store-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('health store', () => {
  it('records provider health changes and cooldown thresholds through the real database', async () => {
    const provider = await createProvider({
      name: 'Health Provider',
      apiKeyReference: 'key_health_provider',
      timeoutMilliseconds: 15_000,
      enabled: true,
    })

    expect(await getProviderHealth(provider.id)).toMatchObject({
      providerId: provider.id,
      consecutiveFailures: 0,
    })

    await recordProviderFailure(provider.id, 3, 10, 60)
    await recordProviderFailure(provider.id, 3, 10, 60)
    await recordProviderFailure(provider.id, 3, 10, 60)

    const failureState = await getProviderHealth(provider.id)
    expect(failureState).toMatchObject({
      providerId: provider.id,
      consecutiveFailures: 3,
      cooldownUntilTime: expect.any(Number),
    })
    expect(await listProviderHealth()).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: provider.id, consecutiveFailures: 3 }),
    ]))

    await recordHealthSuccess(provider.id)
    const successState = await getProviderHealth(provider.id)
    expect(successState).toMatchObject({
      providerId: provider.id,
      consecutiveFailures: 0,
      lastSuccessTime: expect.any(Number),
    })

    await resetProviderHealth(provider.id)
    expect(await getProviderHealth(provider.id)).toMatchObject({
      providerId: provider.id,
      consecutiveFailures: 0,
      cooldownUntilTime: null,
      lastSuccessTime: null,
      lastFailureTime: null,
    })
  })

  it('records provider model health transitions and cooldowns with the real database', async () => {
    const provider = await createProvider({
      name: 'Health Model Provider',
      apiKeyReference: 'key_model_health',
      timeoutMilliseconds: 15_000,
      enabled: true,
    })
    const model = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'model-health',
      priority: 1,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: false,
      }],
    })

    const initial = await getProviderModelHealth(model.id)
    expect(initial).toMatchObject({ providerModelId: model.id, consecutiveFailures: 0 })

    await recordProviderModelFailure(model.id, 2, 5, 30)
    await recordProviderModelFailure(model.id, 2, 5, 30)
    const failed = await getProviderModelHealth(model.id)
    expect(failed).toMatchObject({
      providerModelId: model.id,
      consecutiveFailures: 2,
      cooldownUntilTime: expect.any(Number),
    })

    await recordProviderModelHealthSuccess(model.id)
    expect(await getProviderModelHealth(model.id)).toMatchObject({
      providerModelId: model.id,
      consecutiveFailures: 0,
      lastSuccessTime: expect.any(Number),
    })

    expect(await listProviderModelHealth()).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: model.id, consecutiveFailures: 0 }),
    ]))

    await resetProviderModelHealth(model.id)
    expect(await getProviderModelHealth(model.id)).toMatchObject({
      providerModelId: model.id,
      consecutiveFailures: 0,
      cooldownUntilTime: null,
      lastSuccessTime: null,
      lastFailureTime: null,
    })
  })
})
