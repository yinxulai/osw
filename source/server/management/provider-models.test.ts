import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createProvider } from '../database/provider-store'
import { createLogicalModel } from '../database/logical-model-store'
import { providerModelRoutes } from './provider-models'

function mockResponse() {
  return { statusCode: 0, headersSent: false, writableEnded: false, setHeader: vi.fn(), end: vi.fn() } as unknown as import('node:http').ServerResponse
}

function responseData(response: import('node:http').ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-provider-models-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('provider model routes', () => {
  it('creates a model and updates its scheduling policy', async () => {
    const provider = await createProvider({ name: 'Provider Model Provider', apiKeyReference: 'key_provider_model', timeoutMilliseconds: 15_000, enabled: true })
    const logicalModel = await createLogicalModel({ name: 'routing-model', description: 'route tests' })

    const createRes = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/create', createRes, {
      providerId: provider.id,
      modelName: 'super-fast-model',
      logicalModelId: logicalModel.id,
      priority: 7,
      endpoints: [{ protocol: 'openai-responses', endpointUrl: 'https://example.com/v1/responses', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const created = responseData(createRes).data as { id: string }
    expect(created.id).toMatch(/^model_/)

    const listPoliciesRes = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/list', listPoliciesRes, { logicalModelId: logicalModel.id })
    expect(responseData(listPoliciesRes).data).toEqual(expect.arrayContaining([expect.objectContaining({ providerModelId: created.id, logicalModelId: logicalModel.id, priority: 7 })]))

    const updateRes = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/update', updateRes, {
      logicalModelId: logicalModel.id,
      providerModelId: created.id,
      priority: 11,
      weight: 80,
      enabled: true,
    })
    expect(responseData(updateRes).data).toMatchObject({ logicalModelId: logicalModel.id, providerModelId: created.id, priority: 11, weight: 80 })

    const deleteRes = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/delete', deleteRes, { logicalModelId: logicalModel.id, providerModelId: created.id })
    expect(responseData(deleteRes).data).toMatchObject({ logicalModelId: logicalModel.id, providerModelId: created.id })
  })
})
