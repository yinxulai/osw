import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, getConfigDb, initDatabases } from './index'
import { protocolConverters, providerEndpoints, providerModelEndpoints, schedulingPolicies } from './config-schema'
import {
  createProviderModelRoute,
  deleteProviderModelRoute,
  getProviderModel,
  listProviderModelEndpoints,
  updateProviderModelRoute,
} from './model-store'
import { createLogicalModel, deleteSchedulingPolicy, listSchedulingPolicies, upsertSchedulingPolicy } from './logical-model-store'
import { createProvider, createProviderEndpoint, deleteProviderEndpoint, getProviderEndpoint, listProviderEndpoints } from './provider-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-soft-delete-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

/**
 * 断言软删除必须绕开 store：store 的读接口一律过滤 `deletedTime`，
 * 只有直接看表才能证明「行还在，只是被打了标」。
 */
function endpointRows(providerId: string) {
  return getConfigDb().select().from(providerEndpoints).where(eq(providerEndpoints.providerId, providerId)).all()
}

function bindingRows(providerModelId: string) {
  return getConfigDb().select().from(providerModelEndpoints).where(eq(providerModelEndpoints.providerModelId, providerModelId)).all()
}

function converterRows(providerModelEndpointId: string) {
  return getConfigDb().select().from(protocolConverters).where(eq(protocolConverters.providerModelEndpointId, providerModelEndpointId)).all()
}

function schedulingPolicyRows(logicalModelId: string) {
  return getConfigDb().select().from(schedulingPolicies).where(eq(schedulingPolicies.logicalModelId, logicalModelId)).all()
}

type SoftDeletableRow = { enabled: boolean; deletedTime: number | null }

function allSoftDeleted(rows: SoftDeletableRow[]): boolean {
  return rows.length > 0 && rows.every(row => row.deletedTime !== null && !row.enabled)
}

async function createTestProvider(name: string, apiKeyReference: string) {
  return createProvider({ name, apiKeyReference, timeoutMilliseconds: 10_000, enabled: true })
}

/** 建一条「原生 openai-completions 且开启协议转换」的路由，天然带端点、绑定和转换器三层结构。 */
function createRouteWithOpenAiEndpoint(providerId: string, modelName = 'gpt-4o-mini') {
  return createProviderModelRoute({
    providerId,
    modelName,
    priority: 1,
    endpoints: [{
      protocol: 'openai-completions',
      endpointUrl: 'https://example.com/v1/chat/completions',
      customAuthHeader: null,
      protocolConversionEnabled: true,
    }],
  })
}

describe('soft deletion', () => {
  it('soft-deletes endpoints together with their bindings and protocol converters', async () => {
    const provider = await createTestProvider('Endpoint Soft Delete', 'key_endpoint_soft_delete')
    const route = await createRouteWithOpenAiEndpoint(provider.id)
    const binding = (await getProviderModel(route.id))!.endpoints[0]
    expect(binding.conversions.length).toBeGreaterThan(0)

    await deleteProviderEndpoint(binding.providerEndpointId)

    expect(await getProviderEndpoint(binding.providerEndpointId)).toBeUndefined()
    expect(await listProviderEndpoints(provider.id)).toEqual([])
    expect(await listProviderModelEndpoints(route.id)).toEqual([])
    expect((await getProviderModel(route.id))!.endpoints).toEqual([])

    expect(endpointRows(provider.id)).toEqual([
      expect.objectContaining({ id: binding.providerEndpointId, enabled: false, deletedTime: expect.any(Number) }),
    ])
    expect(bindingRows(route.id)).toEqual([
      expect.objectContaining({ id: binding.id, enabled: false, deletedTime: expect.any(Number) }),
    ])
    expect(allSoftDeleted(converterRows(binding.id))).toBe(true)

    // 「同一供应商同协议只留一条活跃端点」由 store 保证（不做成唯一索引），因此删除后
    // 可以再配同协议端点；再次配上的那一行就是原来那一行被复活。
    const recreated = await createProviderEndpoint({
      providerId: provider.id,
      protocol: 'openai-completions',
      url: 'https://example.com/v1/retry',
      enabled: true,
    })
    expect(await listProviderEndpoints(provider.id)).toEqual([expect.objectContaining({ id: recreated.id })])
    // 同一协议再加回来是在**原来那一行上复活**（id 不变、地址与开关重新盖上），不是插一行新的：
    // 删掉再加回来不该在表里留下一条看不见的历史行，而老行下面的绑定也重新连回同一个 id。
    expect(recreated.id).toBe(binding.providerEndpointId)
    expect(endpointRows(provider.id)).toEqual([
      expect.objectContaining({ id: binding.providerEndpointId, enabled: true, deletedTime: null }),
    ])
  })

  it('reuses binding rows when a route is re-saved and only soft-deletes what was removed', async () => {
    const provider = await createTestProvider('Route Reuse', 'key_route_reuse')
    const route = await createRouteWithOpenAiEndpoint(provider.id)
    const initial = (await getProviderModel(route.id))!.endpoints[0]
    const initialConverterIds = initial.conversions.map(converter => converter.id).sort()

    await updateProviderModelRoute(route.id, {
      endpoints: [
        { protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions', customAuthHeader: null, protocolConversionEnabled: true },
        { protocol: 'openai-responses', endpointUrl: 'https://example.com/v1/responses', customAuthHeader: null, protocolConversionEnabled: false },
      ],
    })

    const afterAdd = (await getProviderModel(route.id))!
    expect(afterAdd.endpoints).toHaveLength(2)
    const retained = afterAdd.endpoints.find(endpoint => endpoint.protocol === 'openai-completions')!
    expect(retained.id).toBe(initial.id)
    expect(retained.conversions.map(converter => converter.id).sort()).toEqual(initialConverterIds)
    expect(bindingRows(route.id).filter(row => row.deletedTime === null)).toHaveLength(2)

    await updateProviderModelRoute(route.id, {
      endpoints: [
        { protocol: 'openai-responses', endpointUrl: 'https://example.com/v1/responses', customAuthHeader: null, protocolConversionEnabled: false },
      ],
    })

    const afterRemove = (await getProviderModel(route.id))!
    expect(afterRemove.endpoints.map(endpoint => endpoint.protocol)).toEqual(['openai-responses'])
    const rows = bindingRows(route.id)
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.id === initial.id)).toMatchObject({ enabled: false, deletedTime: expect.any(Number) })
    expect(allSoftDeleted(converterRows(initial.id))).toBe(true)
    // 端点行本身留着：用户填过的地址不该因为一次路由编辑就从库里消失。
    expect(endpointRows(provider.id)).toHaveLength(2)
  })

  it('cascades model deletion into bindings, converters and scheduling policies', async () => {
    const provider = await createTestProvider('Model Cascade', 'key_model_cascade')
    const logicalModel = await createLogicalModel({ modelId: 'cascade-model', description: 'cascade test' })
    const route = await createRouteWithOpenAiEndpoint(provider.id, 'cascade-model')
    await upsertSchedulingPolicy({ logicalModelId: logicalModel.id, providerModelId: route.id, priority: 1, weight: 50, enabled: true })
    const binding = (await getProviderModel(route.id))!.endpoints[0]

    await deleteProviderModelRoute(route.id)

    // `getProviderModel` 按 id 取行、不过滤 `deletedTime`（和 `getProvider` 一致），
    // 所以这里断言的是「行被打标且挂载物已不可见」，而不是「查不到」。
    expect(await getProviderModel(route.id)).toMatchObject({ id: route.id, enabled: false, deletedTime: expect.any(Number), endpoints: [] })
    expect(await listProviderModelEndpoints(route.id)).toEqual([])
    expect(await listSchedulingPolicies(logicalModel.id)).toEqual([])

    expect(bindingRows(route.id)).toEqual([
      expect.objectContaining({ id: binding.id, enabled: false, deletedTime: expect.any(Number) }),
    ])
    expect(allSoftDeleted(converterRows(binding.id))).toBe(true)
    expect(schedulingPolicyRows(logicalModel.id)).toEqual([
      expect.objectContaining({ providerModelId: route.id, enabled: false, deletedTime: expect.any(Number) }),
    ])

    // 主键不含 deletedTime，所以「重新把模型加回逻辑模型」是同一行复活，而不是插一条新策略。
    // 模型行上一步已被级联停用，而禁用状态的模型不允许再打开绑定（见 issue #14），
    // 所以复活绑定之前先把模型本体复活并启用。
    await updateProviderModelRoute(route.id, { enabled: true, deletedTime: null })
    await upsertSchedulingPolicy({ logicalModelId: logicalModel.id, providerModelId: route.id, priority: 1, weight: 50, enabled: true })
    expect(schedulingPolicyRows(logicalModel.id)).toHaveLength(1)
    expect(await listSchedulingPolicies(logicalModel.id)).toEqual([
      expect.objectContaining({ providerModelId: route.id, deletedTime: null }),
    ])
  })

  it('keeps scheduling policy rows when a model is removed from a logical model', async () => {
    const provider = await createTestProvider('Policy Soft Delete', 'key_policy_soft_delete')
    const logicalModel = await createLogicalModel({ modelId: 'policy-model', description: 'policy test' })
    const route = await createRouteWithOpenAiEndpoint(provider.id, 'policy-model')
    await upsertSchedulingPolicy({ logicalModelId: logicalModel.id, providerModelId: route.id, priority: 1, weight: 50, enabled: true })

    await deleteSchedulingPolicy(logicalModel.id, route.id)

    expect(await listSchedulingPolicies(logicalModel.id)).toEqual([])
    expect(schedulingPolicyRows(logicalModel.id)).toEqual([
      expect.objectContaining({ providerModelId: route.id, enabled: false, deletedTime: expect.any(Number) }),
    ])

    const restored = await upsertSchedulingPolicy({ logicalModelId: logicalModel.id, providerModelId: route.id, priority: 2, weight: 30, enabled: true })
    expect(restored).toMatchObject({ priority: 2, weight: 30, deletedTime: null })
    expect(schedulingPolicyRows(logicalModel.id)).toHaveLength(1)
  })
})
