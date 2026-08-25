import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import {
  createProviderModelEndpoint,
  createProviderModelRoute,
  createProtocolConverter,
  getProviderModel,
  listProviderModelRoutesByProvider,
  listProviderModelsForLogicalModel,
  updateProviderModelEndpoint,
} from './model-store'
import { createLogicalModel, upsertSchedulingPolicy } from './logical-model-store'
import { createProvider, createProviderEndpoint } from './provider-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-model-store-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('model store', () => {
  it('creates provider model routes, endpoints and protocol converters through the real database', async () => {
    const provider = await createProvider({
      name: 'Model Provider',
      apiKeyReference: 'key_model_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'gpt-4o-mini',
      priority: 5,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: true,
      }],
    })

    const persisted = await getProviderModel(route.id)
    expect(persisted).toMatchObject({
      id: route.id,
      providerId: provider.id,
      modelName: 'gpt-4o-mini',
      enabled: true,
    })
    expect(persisted?.endpoints[0]).toMatchObject({
      protocol: 'openai-completions',
      providerModelId: route.id,
      enabled: true,
    })
    expect(persisted?.endpoints[0].conversions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientProtocol: 'openai-responses' }),
      ]),
    )

    const extraEndpoint = await createProviderModelEndpoint({
      providerModelId: route.id,
      providerEndpointId: (await createProviderEndpoint({
        providerId: provider.id,
        protocol: 'openai-responses',
        url: 'https://example.com/v1/responses',
        enabled: true,
      })).id,
      url: 'https://example.com/custom',
      enabled: true,
    })

    await updateProviderModelEndpoint(extraEndpoint.id, { url: 'https://example.com/custom-updated', enabled: true })
    const updatedEndpoint = await getProviderModel(route.id)
    expect(updatedEndpoint?.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: extraEndpoint.id, url: 'https://example.com/custom-updated', enabled: true }),
    ]))

    const converter = await createProtocolConverter({
      providerModelEndpointId: extraEndpoint.id,
      clientProtocol: 'openai-responses',
      enabled: true,
    })
    expect(converter).toMatchObject({ providerModelEndpointId: extraEndpoint.id, clientProtocol: 'openai-responses', enabled: true })

    const logicalModel = await createLogicalModel({ name: 'model-routing', description: 'route test' })
    await upsertSchedulingPolicy({
      logicalModelId: logicalModel.id,
      providerModelId: route.id,
      priority: 1,
      weight: 40,
      enabled: true,
    })

    expect(await listProviderModelsForLogicalModel(logicalModel.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: route.id, modelName: 'gpt-4o-mini', priority: 1 }),
    ]))
    expect(await listProviderModelRoutesByProvider(provider.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: route.id, modelName: 'gpt-4o-mini' }),
    ]))
  })
})
