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
  listProviderModels,
  listProviderModelRoutesByProvider,
  listProviderModelsForLogicalModel,
  listProviderModelsForLogicalModels,
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

  it('allows duplicate model names inside one provider — identity is the record id', async () => {
    const provider = await createProvider({ name: 'Dup Provider', apiKeyReference: 'key_dup', timeoutMilliseconds: 20_000, enabled: true })
    const first = await createProviderModelRoute({ providerId: provider.id, modelName: 'same-name', priority: 0 })

    // 同一供应商下同一个模型名接两个区域、两套密钥是正常用法：两条记录各自绑自己的端点，
    // 靠记录 id 区分而不是靠名字，所以这里不该有任何冲突。
    const second = await createProviderModelRoute({ providerId: provider.id, modelName: 'same-name', priority: 0 })
    expect(second.id).not.toBe(first.id)
    expect(second).toMatchObject({ providerId: provider.id, modelName: 'same-name' })

    const listed = await listProviderModels()
    expect(listed.filter(model => model.providerId === provider.id && model.modelName === 'same-name')).toHaveLength(2)

    // 改名也一样：改成一个已经被同供应商另一条记录用着的名字是允许的。
    await expect(updateProviderModelRoute(second.id, { modelName: 'same-name' }))
      .resolves.toMatchObject({ id: second.id, modelName: 'same-name' })
  })

  it('keeps two same-named models as two rows across a delete and a re-create', async () => {
    const provider = await createProvider({ name: 'Reuse Provider', apiKeyReference: 'key_reuse', timeoutMilliseconds: 20_000, enabled: true })
    const first = await createProviderModelRoute({ providerId: provider.id, modelName: 'reusable', priority: 0 })
    const { deleteProviderModelRoute } = await import('./model-store')
    await deleteProviderModelRoute(first.id)

    const second = await createProviderModelRoute({ providerId: provider.id, modelName: 'reusable', priority: 0 })
    expect(second.id).not.toBe(first.id)
    await expect(getProviderModel(second.id)).resolves.toMatchObject({ modelName: 'reusable', deletedTime: null })
    // 删掉的那一行还在表里（软删除），只是不再出现于可用模型列表。
    await expect(getProviderModel(first.id)).resolves.toMatchObject({ deletedTime: expect.any(Number) })
  })

  describe('listProviderModelsForLogicalModels 批量读取', () => {
    /**
     * 一次典型的三落点场景：A 有两条可用绑定，B 只有一条且绑定被关掉，C 谁都没绑。
     *
     * 返回 Map 而不是扁平数组，因为调用方已经拿着「落点顺序」；这里要一并验的是
     * **键就是传进来的记录 id**，以及「没绑定的落点根本不作为键出现」（而不是给个空数组）。
     */
    async function seedThreeLandings() {
      const provider = await createProvider({ name: 'Batch Provider', apiKeyReference: 'key_batch', timeoutMilliseconds: 20_000, enabled: true })
      const fast = await createProviderModelRoute({
        providerId: provider.id,
        modelName: 'fast',
        priority: 2,
        endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions', customAuthHeader: null, protocolConversionEnabled: false }],
      })
      const slow = await createProviderModelRoute({
        providerId: provider.id,
        modelName: 'slow',
        priority: 1,
        endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions', customAuthHeader: null, protocolConversionEnabled: false }],
      })
      const a = await createLogicalModel({ modelId: 'batch-a' })
      const b = await createLogicalModel({ modelId: 'batch-b' })
      const c = await createLogicalModel({ modelId: 'batch-c' })
      // 故意先插 priority 大的：结果必须按 priority 排，不是按插入顺序。
      await upsertSchedulingPolicy({ logicalModelId: a.id, providerModelId: fast.id, priority: 2, enabled: true })
      await upsertSchedulingPolicy({ logicalModelId: a.id, providerModelId: slow.id, priority: 1, enabled: true })
      await upsertSchedulingPolicy({ logicalModelId: b.id, providerModelId: fast.id, priority: 1, enabled: false })
      return { a, b, c, fast, slow }
    }

    it('按落点分组并按优先级排序，未绑定的落点不出现在 Map 里', async () => {
      const { a, b, c, fast, slow } = await seedThreeLandings()
      const grouped = await listProviderModelsForLogicalModels([a.id, b.id, c.id])

      expect([...grouped.keys()]).toEqual([a.id])
      expect(grouped.get(a.id)?.map(model => model.id)).toEqual([slow.id, fast.id])
      expect(grouped.get(a.id)?.map(model => model.priority)).toEqual([1, 2])
      // 绑定被关掉 → 默认视图里不出现；C 谁都没绑 → 不占一个键。
      expect(grouped.has(b.id)).toBe(false)
      expect(grouped.has(c.id)).toBe(false)
    })

    // 两个开关是正交的：`includeDisabled` 放开绑定与模型开关，`includeDeleted` 才放开软删除的行。
    it('includeDisabled 放开被关掉的绑定，但仍分别报出两个开关的真实值', async () => {
      const { a, b, fast } = await seedThreeLandings()
      const grouped = await listProviderModelsForLogicalModels([a.id, b.id], false, true)

      // 键的顺序来自查询（按 logicalModelId 升序），不是入参顺序：入参在这里只用来限定范围。
      expect([...grouped.keys()].sort()).toEqual([a.id, b.id].sort())
      expect(grouped.get(b.id)).toEqual([expect.objectContaining({ id: fast.id, enabled: false, modelEnabled: true })])
    })

    /**
     * 软删除一个模型时，`deleteProviderModelRoute` 会把挂在它下面的调度策略**一起打标**，
     * 而批量读取的 join 条件带 `isNull(schedulingPolicies.deletedTime)`：
     * 那条绑定行根本不会回到结果集里，所以 `includeDeleted` 也找不回它。
     *
     * 这是有意的——includeDeleted 管的是「模型本体的 deletedTime」，
     * 而不是「把已经拆掉的绑定重新算进来」。
     */
    it('模型本体被软删除后，它的绑定不再出现在批量读取里（includeDeleted 也拿不回来）', async () => {
      const { a, slow, fast } = await seedThreeLandings()
      const { deleteProviderModelRoute } = await import('./model-store')
      await deleteProviderModelRoute(slow.id)

      const defaults = await listProviderModelsForLogicalModels([a.id])
      expect(defaults.get(a.id)?.map(model => model.id)).not.toContain(slow.id)

      // 只放开 includeDeleted：模型行虽然还在，但 `enabled: false`，依旧被 includeDisabled 挡住。
      const deletedOnly = await listProviderModelsForLogicalModels([a.id], true)
      expect(deletedOnly.get(a.id)?.map(model => model.id)).toEqual([fast.id])

      // 两个开关都放开，被删的那个依然不在：绑定行本身已经打标，join 就不匹配了。
      const allOpen = await listProviderModelsForLogicalModels([a.id], true, true)
      expect(allOpen.get(a.id)?.map(model => model.id)).toEqual([fast.id])
    })

    // 空数组直接短路：这是调用方「一个落点都没有」的常见形态，不该往数据库发一句 `in ()`。
    it('传空数组时立刻返回空 Map', async () => {
      await seedThreeLandings()
      const grouped = await listProviderModelsForLogicalModels([])
      expect(grouped.size).toBe(0)
    })

    it('重复的落点 id 不会把同一批绑定算两遍', async () => {
      const { a, slow, fast } = await seedThreeLandings()
      const grouped = await listProviderModelsForLogicalModels([a.id, a.id])
      expect(grouped.get(a.id)?.map(model => model.id)).toEqual([slow.id, fast.id])
    })

    // 缓存键把「哪些落点 + 两个开关」都编码进去了：不同的组合各存一份，不能互相串。
    it('不同落点组合与不同开关各存一份缓存，不会串值', async () => {
      const { a, b, fast } = await seedThreeLandings()

      const onlyA = await listProviderModelsForLogicalModels([a.id])
      const withB = await listProviderModelsForLogicalModels([a.id, b.id], false, true)
      const aAgain = await listProviderModelsForLogicalModels([a.id])

      expect(onlyA.has(b.id)).toBe(false)
      expect(withB.get(b.id)).toEqual([expect.objectContaining({ id: fast.id })])
      // 再读一次 A 不该被上一步那份「带 B」的结果污染。
      expect([...aAgain.keys()]).toEqual([a.id])
      expect(aAgain.get(a.id)).toEqual(onlyA.get(a.id))
    })

    // 缓存必须跟着配置写入失效，否则逻辑模型页打开着的时候改绑定，规划层还会按旧绑定发请求。
    it('改绑定后缓存立刻失效，批量读取要反映新顺序', async () => {
      const { a, slow, fast } = await seedThreeLandings()
      expect((await listProviderModelsForLogicalModels([a.id])).get(a.id)?.map(model => model.id)).toEqual([slow.id, fast.id])

      // 把 fast 提到 slow 前面。
      await upsertSchedulingPolicy({ logicalModelId: a.id, providerModelId: fast.id, priority: 0 })

      expect((await listProviderModelsForLogicalModels([a.id])).get(a.id)?.map(model => model.id)).toEqual([fast.id, slow.id])
    })
  })
})
