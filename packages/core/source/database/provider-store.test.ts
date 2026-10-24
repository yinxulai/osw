import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import {
  createProvider,
  createProviderEndpoint,
  deleteProvider,
  deleteProviderSetting,
  getProvider,
  getProviderEndpoint,
  getProviderSetting,
  listProviderEndpoints,
  listProviders,
  listProviderSettings,
  reorderProviders,
  replaceProviderEndpoints,
  updateProvider,
  upsertProviderSetting,
} from './provider-store'
import { createProviderModelRoute, getProviderModelRoute, listProviderModelRoutesByProvider } from './model-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-provider-store-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('provider store', () => {
  it('persists provider settings and endpoints using the real sqlite database', async () => {
    const provider = await createProvider({
      name: 'OpenAI',
      apiKeyReference: 'key_openai',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })

    expect(await getProvider(provider.id)).toMatchObject({
      id: provider.id,
      name: 'OpenAI',
      enabled: true,
    })

    expect(await listProviderSettings(provider.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: provider.id, key: 'security.secretReference', value: 'key_openai' }),
      expect.objectContaining({ providerId: provider.id, key: 'connection.timeoutMilliseconds', value: '30000' }),
    ]))

    expect(await getProviderSetting(provider.id, 'security.secretReference')).toMatchObject({
      providerId: provider.id,
      key: 'security.secretReference',
      value: 'key_openai',
    })

    await upsertProviderSetting({
      providerId: provider.id,
      key: 'custom.label',
      value: 'primary',
      valueType: 'string',
    })

    expect(await getProviderSetting(provider.id, 'custom.label')).toMatchObject({
      value: 'primary',
      valueType: 'string',
    })

    const endpoint = await createProviderEndpoint({
      providerId: provider.id,
      protocol: 'openai-completions',
      url: 'https://api.openai.com/v1/chat/completions',
      enabled: true,
    })

    expect(await getProviderEndpoint(endpoint.id)).toMatchObject({
      providerId: provider.id,
      protocol: 'openai-completions',
      url: 'https://api.openai.com/v1/chat/completions',
    })

    await replaceProviderEndpoints(provider.id, {
      'openai-completions': 'https://api.openai.com/v1/chat/completions',
      'openai-responses': 'https://api.openai.com/v1/responses',
    })

    expect((await listProviderEndpoints(provider.id)).map(entry => entry.protocol).sort()).toEqual([
      'openai-completions',
      'openai-responses',
    ])

    await deleteProviderSetting(provider.id, 'custom.label')
    expect(await getProviderSetting(provider.id, 'custom.label')).toBeUndefined()
  })

  it('keeps an addressless protocol carrier endpoint when provider endpoints are replaced', async () => {
    const provider = await createProvider({
      name: 'Carrier Provider',
      apiKeyReference: 'key_carrier_provider',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })
    // 只有协议、没有地址的载体行（模型绑定协议的落脚点，见 `./model-store.ts`）。
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-responses', url: '', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'anthropic-messages', url: 'https://api.example.com/anthropic', enabled: true })

    // 用户只填了一个协议就保存：没提到的行被停用（地址是用户填过的可见状态），
    // 但载体行不在「全集」的管辖范围内——停用它会让模型侧的绑定凭空消失。
    await replaceProviderEndpoints(provider.id, { 'openai-completions': 'https://api.example.com/v1' })

    expect((await listProviderEndpoints(provider.id)).map(({ protocol, url, enabled }) => ({ protocol, url, enabled }))).toEqual([
      { protocol: 'anthropic-messages', url: 'https://api.example.com/anthropic', enabled: false },
      { protocol: 'openai-completions', url: 'https://api.example.com/v1', enabled: true },
      { protocol: 'openai-responses', url: '', enabled: true },
    ])
  })

  it('refuses to drop a provider address that models still fall back to', async () => {
    const provider = await createProvider({
      name: 'Address In Use',
      apiKeyReference: 'key_address_in_use',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })
    await replaceProviderEndpoints(provider.id, { 'openai-completions': 'https://api.example.com/v1' })
    // 模型自己没写地址 ⇒ 它的上游地址就是供应商这一层的地址。
    await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'gpt-4o-mini',
      priority: 1,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
    })

    // 用户以为只是「把供应商地址清掉」，实际会连带撤掉那个模型的地址。
    await expect(replaceProviderEndpoints(provider.id, {})).rejects.toMatchObject({
      code: 'ENDPOINT_URL_IN_USE',
      statusCode: 400,
      details: { providerName: 'Address In Use', protocols: 'OpenAI Completions', count: 1, models: 'gpt-4o-mini' },
    })

    // 事务回滚：地址还在，模型仍然可用。
    expect(await listProviderEndpoints(provider.id)).toEqual([
      expect.objectContaining({ protocol: 'openai-completions', url: 'https://api.example.com/v1', enabled: true }),
    ])
    expect((await getProviderModelRoute((await listProviderModelRoutesByProvider(provider.id))[0].id))!.endpoints).toEqual([
      expect.objectContaining({ protocol: 'openai-completions', endpointUrl: 'https://api.example.com/v1' }),
    ])
  })

  it('refuses to drop a provider protocol that models are still attached to', async () => {
    const provider = await createProvider({
      name: 'Protocol In Use',
      apiKeyReference: 'key_protocol_in_use',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })
    await replaceProviderEndpoints(provider.id, { 'openai-completions': 'https://api.example.com/v1' })
    // 模型自带地址，也不用供应商的默认值——但端点的 `enabled` 是协议级开关，
    // 撤掉供应商这一行照样会让模型读不出这个协议（`mapProviderModelRoute` 要求端点 enabled）。
    await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'gpt-4o-mini',
      priority: 1,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://api.example.com/v1/custom', customAuthHeader: null, protocolConversionEnabled: false }],
    })

    await expect(replaceProviderEndpoints(provider.id, {})).rejects.toMatchObject({
      code: 'ENDPOINT_URL_IN_USE',
      statusCode: 400,
      details: { providerName: 'Protocol In Use', protocols: 'OpenAI Completions', count: 1, models: 'gpt-4o-mini' },
    })

    // 事务回滚：地址与模型绑定都没被改动。
    expect(await listProviderEndpoints(provider.id)).toEqual([
      expect.objectContaining({ protocol: 'openai-completions', url: 'https://api.example.com/v1', enabled: true }),
    ])
    expect((await getProviderModelRoute((await listProviderModelRoutesByProvider(provider.id))[0].id))!.endpoints).toEqual([
      expect.objectContaining({ endpointUrl: 'https://api.example.com/v1/custom' }),
    ])
  })

  it('soft-deletes providers and keeps deleted rows available when requested', async () => {
    const provider = await createProvider({
      name: 'Soft Deleted',
      apiKeyReference: 'key_soft_delete',
      timeoutMilliseconds: 10_000,
      enabled: true,
    })

    await updateProvider(provider.id, { enabled: false, description: 'disabled before delete' })
    await deleteProvider(provider.id)

    expect(await getProvider(provider.id)).toMatchObject({
      id: provider.id,
      enabled: false,
      deletedTime: expect.any(Number),
    })
    expect((await listProviders()).map(item => item.id)).not.toContain(provider.id)
    expect((await listProviders(true)).map(item => item.id)).toContain(provider.id)
  })

  it('refuses to update a deleted provider and keeps its stored settings', async () => {
    const provider = await createProvider({
      name: 'OpenAI',
      apiKeyReference: 'key_deleted_update',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })
    await deleteProvider(provider.id)

    await expect(updateProvider(provider.id, { name: 'Renamed', timeoutMilliseconds: 1000 })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      statusCode: 404,
    })
    expect(await getProvider(provider.id)).toMatchObject({
      name: 'OpenAI',
      timeoutMilliseconds: 30_000,
      deletedTime: expect.any(Number),
    })
  })

  it('persists the dragged provider order across reads and appends later creations', async () => {
    const alpha = await createProvider({ name: 'Alpha', apiKeyReference: 'key_alpha', enabled: true })
    const beta = await createProvider({ name: 'Beta', apiKeyReference: 'key_beta', enabled: true })
    const before = (await listProviders()).map(provider => provider.id)
    expect(before.slice(-2)).toEqual([alpha.id, beta.id])

    const reversed = [...before].reverse()
    await reorderProviders(reversed)
    expect((await listProviders()).map(provider => provider.id)).toEqual(reversed)

    // 拖过序之后再新建，新供应商排在末尾而不是插进已排好的序列里。
    const gamma = await createProvider({ name: 'Gamma', apiKeyReference: 'key_gamma', enabled: true })
    expect((await listProviders()).map(provider => provider.id)).toEqual([...reversed, gamma.id])
  })
})
