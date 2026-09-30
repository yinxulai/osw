import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import {
  createProviderModelEndpoint,
  createProviderModelRoute,
  createProtocolConverter,
  getProviderModel,
  getProviderModelRoute,
  listProviderModelRoutesByProvider,
  listProviderModelsForLogicalModel,
  updateProviderModelEndpoint,
  updateProviderModelRoute,
} from './model-store'
import { createLogicalModel, listSchedulingPolicies, upsertSchedulingPolicy } from './logical-model-store'
import { createProvider, createProviderEndpoint, listProviderEndpoints } from './provider-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-model-store-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
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

    const logicalModel = await createLogicalModel({ modelId: 'model-routing', description: 'route test' })
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

  // 回归：模型与供应商两层都没地址时必须**直接报错**，不能编一个地址顶上——编出来的地址会显示成
  // 「用户自己配的地址」，请求也真的会打到那里去。
  it('refuses to save a model whose protocol has no address anywhere', async () => {
    const provider = await createProvider({
      name: 'Addressless Provider',
      apiKeyReference: 'key_addressless_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })

    await expect(createProviderModelRoute({
      providerId: provider.id,
      modelName: 'addressless-model',
      priority: 1,
      endpoints: [{ protocol: 'openai-responses', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
    })).rejects.toMatchObject({
      code: 'ENDPOINT_URL_MISSING',
      statusCode: 400,
      // 报错要说清「哪个供应商的哪个协议」——那才是用户能照着改的那一步。
      details: { providerName: 'Addressless Provider', protocols: 'OpenAI Responses' },
    })

    // 报错发生在事务里：模型、端点、绑定一个都不该留下。
    expect(await listProviderModelRoutesByProvider(provider.id)).toEqual([])
    expect(await listProviderEndpoints(provider.id)).toEqual([])
  })

  it('falls back to an enabled provider default address when the model carries none', async () => {
    const provider = await createProvider({
      name: 'Fallback Provider',
      apiKeyReference: 'key_fallback_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    await createProviderEndpoint({
      providerId: provider.id,
      protocol: 'openai-responses',
      url: 'https://example.com/v1/responses',
      enabled: true,
    })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'fallback-model',
      priority: 1,
      endpoints: [{ protocol: 'openai-responses', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
    })

    // 绑定上是 `null`（「沿用供应商默认地址」），解析出来的有效地址是供应商那一层的。
    expect((await getProviderModel(route.id))?.endpoints[0]).toMatchObject({ url: null, enabled: true })
    expect((await getProviderModelRoute(route.id))?.endpoints[0]).toMatchObject({ endpointUrl: 'https://example.com/v1/responses' })
  })

  // 校验不能比解析宽松：解析路径（`mapProviderModelRoute`）要求供应商端点 `enabled = true`，
  // 把停用的端点当成可用地址就会存下一个读回来根本没地址的模型。
  it('does not count a disabled provider endpoint as the model address', async () => {
    const provider = await createProvider({
      name: 'Disabled Endpoint Provider',
      apiKeyReference: 'key_disabled_endpoint_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    await createProviderEndpoint({
      providerId: provider.id,
      protocol: 'openai-completions',
      url: 'https://example.com/v1/chat/completions',
      enabled: false,
    })

    await expect(createProviderModelRoute({
      providerId: provider.id,
      modelName: 'disabled-endpoint-model',
      priority: 1,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
    })).rejects.toMatchObject({ code: 'ENDPOINT_URL_MISSING' })
  })

  it('refuses to clear a model address when the provider has no default to fall back to', async () => {
    const provider = await createProvider({
      name: 'Clear Url Provider',
      apiKeyReference: 'key_clear_url_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'clear-url-model',
      priority: 1,
      endpoints: [{ protocol: 'anthropic-messages', endpointUrl: 'https://example.com/anthropic', customAuthHeader: null, protocolConversionEnabled: false }],
    })

    await expect(updateProviderModelRoute(route.id, {
      endpoints: [{ protocol: 'anthropic-messages', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
    })).rejects.toMatchObject({ code: 'ENDPOINT_URL_MISSING' })

    // 保存被整体回滚，原来的绑定一字不动。
    expect((await getProviderModelRoute(route.id))?.endpoints[0]).toMatchObject({ endpointUrl: 'https://example.com/anthropic' })
  })

  it('keeps a model url on the binding instead of promoting it to the provider default', async () => {
    const provider = await createProvider({
      name: 'Custom Url Provider',
      apiKeyReference: 'key_custom_url_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'custom-url-model',
      priority: 1,
      endpoints: [{ protocol: 'anthropic-messages', endpointUrl: 'https://example.com/anthropic', customAuthHeader: null, protocolConversionEnabled: false }],
    })

    // 一个模型的自定义地址不能变成供应商的默认地址：那会悄悄改掉所有同协议绑定的解析结果。
    expect(await listProviderEndpoints(provider.id)).toEqual([
      expect.objectContaining({ protocol: 'anthropic-messages', url: '', enabled: true }),
    ])
    expect((await getProviderModel(route.id))?.endpoints[0]).toMatchObject({ url: 'https://example.com/anthropic' })
    expect((await getProviderModelRoute(route.id))?.endpoints[0]).toMatchObject({ endpointUrl: 'https://example.com/anthropic' })
  })

  // 回归：逻辑模型页开关读写的是 scheduling_policies.enabled，而模型管理开关写的是
  // provider_models.enabled。最初的实现在这里错写了 `enabled: model.enabled`，
  // 于是刷新就把用户关掉的开关又弹开。两个开关必须分别返回。
  it('reports the binding enabled flag, not the provider model flag, for a logical model', async () => {
    const provider = await createProvider({
      name: 'Binding Enabled Provider',
      apiKeyReference: 'key_binding_enabled_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const enabledRoute = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'binding-on',
      priority: 1,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const disabledRoute = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'binding-off',
      priority: 2,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const logicalModel = await createLogicalModel({ modelId: 'binding-enabled' })
    await upsertSchedulingPolicy({ logicalModelId: logicalModel.id, providerModelId: enabledRoute.id, priority: 1, enabled: true })
    await upsertSchedulingPolicy({ logicalModelId: logicalModel.id, providerModelId: disabledRoute.id, priority: 2, enabled: false })

    expect(await listProviderModelsForLogicalModel(logicalModel.id)).toEqual([
      expect.objectContaining({ id: enabledRoute.id, enabled: true, modelEnabled: true, priority: 1 }),
    ])
    expect(await listProviderModelsForLogicalModel(logicalModel.id, false, true)).toEqual([
      expect.objectContaining({ id: enabledRoute.id, enabled: true, modelEnabled: true, priority: 1 }),
      expect.objectContaining({ id: disabledRoute.id, enabled: false, modelEnabled: true, priority: 2 }),
    ])

    // 模型本体被停用后，绑定会级联关闭（见下一个用例），管理接口仍要分别报出两个开关的真实状态。
    await updateProviderModelRoute(enabledRoute.id, { enabled: false })
    expect(await listProviderModelsForLogicalModel(logicalModel.id, false, true)).toEqual([
      expect.objectContaining({ id: enabledRoute.id, enabled: false, modelEnabled: false, priority: 1 }),
      expect.objectContaining({ id: disabledRoute.id, enabled: false, modelEnabled: true, priority: 2 }),
    ])
  })

  // 关闭模型是一个全局开关：它一旦不可用，所有逻辑模型里指向它的调度绑定都该跟着禁用，
  // 否则绑定看起来「开着」，但请求根本不会落到这个模型上。
  it('disables every logical binding when a model is turned off', async () => {
    const provider = await createProvider({
      name: 'Disable Cascade Provider',
      apiKeyReference: 'key_disable_cascade',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'disable-cascade-model',
      priority: 1,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const other = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'disable-cascade-other',
      priority: 2,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const first = await createLogicalModel({ modelId: 'disable-cascade-a' })
    const second = await createLogicalModel({ modelId: 'disable-cascade-b' })
    await upsertSchedulingPolicy({ logicalModelId: first.id, providerModelId: route.id, priority: 1, enabled: true })
    await upsertSchedulingPolicy({ logicalModelId: second.id, providerModelId: route.id, priority: 1, enabled: true })
    await upsertSchedulingPolicy({ logicalModelId: first.id, providerModelId: other.id, priority: 2, enabled: true })

    await updateProviderModelRoute(route.id, { enabled: false })

    // 被关闭的模型，在所有逻辑模型里的绑定都被禁用（行还在，只是不可调度）。
    expect(await listSchedulingPolicies(first.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: route.id, enabled: false, deletedTime: null }),
    ]))
    expect(await listSchedulingPolicies(second.id)).toEqual([
      expect.objectContaining({ providerModelId: route.id, enabled: false }),
    ])
    // 同一个逻辑模型里其它模型的绑定不受影响，也不会被误删。
    expect(await listSchedulingPolicies(first.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: other.id, enabled: true, deletedTime: null }),
    ]))
  })

  it('rejects a duplicate model name inside one provider with a typed 409', async () => {
    const provider = await createProvider({ name: 'Dup Provider', apiKeyReference: 'key_dup', timeoutMilliseconds: 20_000, enabled: true })
    await createProviderModelRoute({ providerId: provider.id, modelName: 'same-name', priority: 0 })

    // 活跃行重名是用户可修正的输入错误：预检就要给出 409 + `DUPLICATE_RESOURCE`，
    // 不能让 `provider_models (providerId, modelName)` 的唯一索引抛成一句 500。
    await expect(createProviderModelRoute({ providerId: provider.id, modelName: 'same-name', priority: 0 }))
      .rejects.toMatchObject({ code: 'DUPLICATE_RESOURCE', statusCode: 409 })

    // 改名撞上已有的活跃行同样要被拦下。
    const renamed = await createProviderModelRoute({ providerId: provider.id, modelName: 'other-name', priority: 0 })
    await expect(updateProviderModelRoute(renamed.id, { modelName: 'same-name' }))
      .rejects.toMatchObject({ code: 'DUPLICATE_RESOURCE', statusCode: 409 })

    // 另一个供应商用同一个名字不受影响：唯一性只在供应商内部成立。
    const another = await createProvider({ name: 'Another Provider', apiKeyReference: 'key_another', timeoutMilliseconds: 20_000, enabled: true })
    await expect(createProviderModelRoute({ providerId: another.id, modelName: 'same-name', priority: 0 }))
      .resolves.toMatchObject({ providerId: another.id, modelName: 'same-name' })
  })

  it('frees a model name again after the previous holder is deleted', async () => {
    const provider = await createProvider({ name: 'Reuse Provider', apiKeyReference: 'key_reuse', timeoutMilliseconds: 20_000, enabled: true })
    const first = await createProviderModelRoute({ providerId: provider.id, modelName: 'reusable', priority: 0 })
    const { deleteProviderModelRoute } = await import('./model-store')
    await deleteProviderModelRoute(first.id)

    // 唯一索引是部分索引（`WHERE deletedTime IS NULL`），软删掉的旧行不该占住名字。
    const second = await createProviderModelRoute({ providerId: provider.id, modelName: 'reusable', priority: 0 })
    expect(second.id).not.toBe(first.id)
    await expect(getProviderModel(second.id)).resolves.toMatchObject({ modelName: 'reusable', deletedTime: null })
  })
})
