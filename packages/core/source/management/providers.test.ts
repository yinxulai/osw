import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '@common/secret-store'
import { closeDatabases, initDatabases } from '../database'
import { createProvider, getProvider, listProviders, createProviderEndpoint } from '@server/database/provider-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { deleteProviderAndSecret, providerRoutes } from './routes/catalog/providers'
import { mockResponse } from './test-support'

let temporaryDirectory: string
let secretStore: SecretStore

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-provider-'))
  await initDatabases(temporaryDirectory)
  secretStore = {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  }
  configureSecretStore(secretStore)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('provider management', () => {
  it('deletes the stored API key when deleting a provider', async () => {
    const provider = await createProvider({
      name: 'Provider',
      apiKeyReference: 'key_reference',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })

    await deleteProviderAndSecret(provider.id)

    expect(await getProvider(provider.id)).toMatchObject({ deletedTime: expect.any(Number) })
    expect(secretStore.delete).toHaveBeenCalledWith('key_reference')
  })

  it('creates a provider without an API key for local or test clusters', async () => {
    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/create', res, {
      name: 'Local Cluster',
    })

    expect(secretStore.set).not.toHaveBeenCalled()
    const providers = await listProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({ name: 'Local Cluster', enabled: true })
  })

  it('stores the API key when one is provided', async () => {
    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/create', res, {
      name: 'OpenAI',
      apiKey: 'sk-test',
    })

    expect(secretStore.set).toHaveBeenCalledTimes(1)
    expect(secretStore.set).toHaveBeenCalledWith(expect.stringMatching(/^key_/), 'sk-test')
  })

  it('reorders providers through the management route', async () => {
    await createProvider({ name: 'Order A', apiKeyReference: 'key_order_a', enabled: true })
    await createProvider({ name: 'Order B', apiKeyReference: 'key_order_b', enabled: true })

    const listRes = mockResponse()
    await providerRoutes.invoke('/api/provider/list', listRes)
    const before = (responseData(listRes).data as { id: string }[]).map(provider => provider.id)
    const reversed = [...before].reverse()

    const reorderRes = mockResponse()
    await providerRoutes.invoke('/api/provider/reorder', reorderRes, { ids: reversed })
    expect((responseData(reorderRes).data as { id: string }[]).map(provider => provider.id)).toEqual(reversed)
    expect((await listProviders()).map(provider => provider.id)).toEqual(reversed)
  })

  it('reads a provider by id and reports a missing one as 404', async () => {
    const provider = await createProvider({ name: 'Readable', apiKeyReference: 'key_readable', enabled: true })

    const found = mockResponse()
    await providerRoutes.invoke('/api/provider/get', found, { id: provider.id })
    expect(responseData(found).data).toMatchObject({ id: provider.id, name: 'Readable' })

    const missing = mockResponse()
    await providerRoutes.invoke('/api/provider/get', missing, { id: 'prov_missing' })
    expect(missing.statusCode).toBe(404)
  })

  it('lists the endpoints declared on a provider', async () => {
    const provider = await createProvider({ name: 'Endpoints', apiKeyReference: 'key_endpoints', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://example.com/v1/chat/completions' })

    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/endpoints', res, { id: provider.id })
    expect(responseData(res).data).toEqual([
      expect.objectContaining({ providerId: provider.id, protocol: 'openai-completions' }),
    ])
  })

  it('merges updates and rotates the API key in place', async () => {
    const provider = await createProvider({ name: 'Before', apiKeyReference: 'key_rotate', timeoutMilliseconds: 10_000, enabled: true })

    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/update', res, {
      id: provider.id,
      name: 'After',
      timeoutMilliseconds: 45_000,
      enabled: false,
      apiKey: 'sk-rotated',
    })

    expect(responseData(res).data).toMatchObject({ id: provider.id, name: 'After', timeoutMilliseconds: 45_000, enabled: false })
    expect(secretStore.set).toHaveBeenCalledWith('key_rotate', 'sk-rotated')
  })

  it('replaces the provider endpoints when the update carries them', async () => {
    const provider = await createProvider({ name: 'Endpoint Update', apiKeyReference: 'key_endpoint_update', enabled: true })

    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/update', res, {
      id: provider.id,
      endpoints: { 'anthropic-messages': 'https://example.com/v1/messages' },
    })

    const endpoints = mockResponse()
    await providerRoutes.invoke('/api/provider/endpoints', endpoints, { id: provider.id })
    expect(responseData(endpoints).data).toEqual([
      expect.objectContaining({ protocol: 'anthropic-messages', url: 'https://example.com/v1/messages' }),
    ])
  })

  it('reports 404 when updating a provider that does not exist', async () => {
    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/update', res, { id: 'prov_missing', name: 'Nope' })
    expect(res.statusCode).toBe(404)
  })

  it('deletes a provider and its secret through the route', async () => {
    const provider = await createProvider({ name: 'Delete Me', apiKeyReference: 'key_delete_me', enabled: true })

    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/delete', res, { id: provider.id })

    expect(responseData(res).data).toEqual({ id: provider.id })
    expect(secretStore.delete).toHaveBeenCalledWith('key_delete_me')
  })

  // 删除只是软删除：默认列表把它藏起来，但 `includeDeleted` 必须能把它拿回来。
  // 统计分析里的供应商名是写入当时的快照，界面上要靠这份全量名单标出「这一家已经删了」。
  it('hides deleted providers by default but returns them with includeDeleted', async () => {
    const provider = await createProvider({ name: 'Deleted Provider', apiKeyReference: 'key_deleted', enabled: true })

    const deleteRes = mockResponse()
    await providerRoutes.invoke('/api/provider/delete', deleteRes, { id: provider.id })

    const activeRes = mockResponse()
    await providerRoutes.invoke('/api/provider/list', activeRes)
    const active = responseData(activeRes).data as Array<{ id: string }>
    expect(active.some(row => row.id === provider.id)).toBe(false)

    const allRes = mockResponse()
    await providerRoutes.invoke('/api/provider/list', allRes, { includeDeleted: true })
    const all = responseData(allRes).data as Array<{ id: string; deletedTime: number | null }>
    expect(all).toEqual(expect.arrayContaining([expect.objectContaining({ id: provider.id })]))
    expect(all.find(row => row.id === provider.id)?.deletedTime).not.toBeNull()
  })

  it('resets a provider health record', async () => {
    const provider = await createProvider({ name: 'Heal Me', apiKeyReference: 'key_heal_me', enabled: true })

    const res = mockResponse()
    await providerRoutes.invoke('/api/provider/reset-health', res, { providerId: provider.id })
    expect(responseData(res).data).toEqual({ providerId: provider.id })
  })
})
