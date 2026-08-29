import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createProvider } from '@server/database/provider-store'
import { createProviderModelRoute } from '@server/database/model-store'
import { relationRoutes } from './routes/relations/relations'

function mockResponse() {
  return { statusCode: 0, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse
}

function responseData(response: ServerResponse): unknown {
  const raw = vi.mocked(response.end).mock.calls[0][0] as string
  return JSON.parse(raw).data
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-relations-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('relation management', () => {
  it('creates and reads provider endpoint, model endpoint, and converter relations', async () => {
    const provider = await createProvider({ name: 'Relations', apiKeyReference: 'key_relations', timeoutMilliseconds: 30_000 })
    const model = await createProviderModelRoute({ providerId: provider.id, modelName: 'relations-model', priority: 0 })
    const endpointResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/create', endpointResponse, {
      providerId: provider.id,
      protocol: 'openai-responses',
      url: 'https://example.com/v1/responses',
    })
    const endpoint = responseData(endpointResponse) as { id: string }
    const bindingResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-model-endpoint/create', bindingResponse, {
      providerModelId: model.id,
      providerEndpointId: endpoint.id,
    })
    const binding = responseData(bindingResponse) as { id: string }
    const converterResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/protocol-converter/create', converterResponse, {
      providerModelEndpointId: binding.id,
      clientProtocol: 'anthropic-messages',
    })
    const converter = responseData(converterResponse) as { id: string; enabled: boolean }
    const listResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/protocol-converter/list', listResponse, {
      providerModelEndpointId: binding.id,
    })

    expect(converter).toMatchObject({ id: expect.stringMatching(/^conv_/), enabled: true })
    expect(responseData(listResponse)).toEqual([expect.objectContaining({ id: converter.id, clientProtocol: 'anthropic-messages' })])
  })
})
