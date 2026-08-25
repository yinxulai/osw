import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createProvider, listProviders } from '../database/provider-store'
import { listLogicalModels } from '../database/logical-model-store'
import { listProviderModels } from '../database/model-store'
import type { KeychainApi } from '@common/keychain'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'
import { configRoutes } from './config/routes'

function mockResponse() {
  return { statusCode: 0, setHeader: vi.fn(), end: vi.fn() } as unknown as import('node:http').ServerResponse
}

function responsePayload(response: import('node:http').ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

let temporaryDirectory: string
let secretStore: KeychainApi

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-config-'))
  await initDatabase(temporaryDirectory)
  secretStore = { set: vi.fn(async () => undefined), get: vi.fn(async () => null), delete: vi.fn(async () => undefined) }
  configureSecretStore(secretStore)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('configuration schema', () => {
  it('exports schema version 3 without provider secrets', async () => {
    await createProvider({ name: 'Export Provider', apiKeyReference: 'key_export', timeoutMilliseconds: 30_000 })
    const response = mockResponse()

    await configRoutes.invoke('/api/config/export', response, {})

    const payload = responsePayload(response) as { success: boolean; data: { config: { schemaVersion: number; providers: Array<{ apiKeyPlaceholder: string }> } } }
    expect(payload.success).toBe(true)
    expect(payload.data.config.schemaVersion).toBe(3)
    expect(payload.data.config.providers).toEqual([
      expect.objectContaining({ apiKeyPlaceholder: '***' }),
    ])
  })

  it('rejects the removed version field during import', async () => {
    const response = mockResponse()

    await configRoutes.invoke('/api/config/import', response, {
      config: { version: 3 },
      mode: 'merge',
    })

    expect(response.statusCode).toBe(400)
    expect(responsePayload(response)).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('imports providers, logical models, provider models, and scheduling policies', async () => {
    const response = mockResponse()
    await configRoutes.invoke('/api/config/import', response, {
      mode: 'merge',
      config: {
        schemaVersion: 3,
        exportedAt: Date.now(),
        settings: { listenPort: 9400 },
        providers: [{ id: 'provider-source', name: 'Imported Provider', apiKey: 'secret-value', endpoints: { 'openai-completions': 'https://example.com/v1/chat/completions' } }],
        logicalModels: [{ id: 'logical-source', name: 'Imported Model', description: 'demo' }],
        providerModels: [{ id: 'model-source', providerId: 'provider-source', modelName: 'upstream-model', endpoints: [{ protocol: 'openai-completions', url: 'https://example.com/v1/chat/completions' }] }],
        schedulingPolicies: [{ logicalModelId: 'logical-source', providerModelId: 'model-source', priority: 1 }],
      },
    })

    expect(responsePayload(response)).toMatchObject({ success: true, data: { imported: { providers: 1, logicalModels: 1, providerModels: 1 } } })
    expect(secretStore.set).toHaveBeenCalledWith(expect.any(String), 'secret-value')
    expect(await listProviders()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Imported Provider' })]))
    expect(await listLogicalModels()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Imported Model' })]))
    expect(await listProviderModels()).toEqual(expect.arrayContaining([expect.objectContaining({ modelName: 'upstream-model' })]))
  })

  it('replaces entities omitted from the imported configuration', async () => {
    const oldProviderResponse = mockResponse()
    await configRoutes.invoke('/api/config/import', oldProviderResponse, {
      config: { schemaVersion: 3, exportedAt: Date.now(), providers: [{ name: 'Old Provider' }] },
    })
    const response = mockResponse()
    await configRoutes.invoke('/api/config/import', response, {
      mode: 'replace',
      config: { schemaVersion: 3, exportedAt: Date.now(), providers: [{ name: 'New Provider' }] },
    })

    expect(await listProviders()).toEqual([expect.objectContaining({ name: 'New Provider' })])
  })
})
