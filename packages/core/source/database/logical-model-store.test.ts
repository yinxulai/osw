import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import { createLogicalModel, deleteLogicalModel, getLogicalModel, getLogicalModelByModelId, listLogicalModels, listSchedulingPolicies, mapLogicalModelIdsToRecordIds, reorderLogicalModels, updateLogicalModel, upsertSchedulingPolicy } from './logical-model-store'
import { createProvider } from './provider-store'
import { createProviderModelRoute, updateProviderModelRoute } from './model-store'
import { readRouterGraphSnapshot, saveRouterGraphVersion } from './router-graph-store'
import { readRouteRuleSnapshot, saveRouteRuleSetVersion } from './route-rule-store'
import { createDefaultPolicyGraph } from '@common/router/presets'
import { createRouteRule, ROUTE_RULE_SET_VERSION } from '@common/router/route-rules'
import type { RouteRuleSet } from '@common/router/route-rules'
import type { WorkflowGraph } from '@common/router/types'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-logical-model-store-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

/**
 * 内建默认逻辑模型的**数据记录 id**。
 *
 * 调度绑定、排序、改名、删除这些管理入参走的都是记录 id，而路由运行时用的是模型 id，
 * 这两套钥匙在测试里必须一眼能分开，所以统一从这里取记录 id。
 */
async function defaultRecordId(): Promise<string> {
  const record = await getLogicalModelByModelId('default')
  if (!record) throw new Error('内建默认逻辑模型缺失')
  return record.id
}

/** 一张把固定落点指向 `modelId` 的默认策略图，用来验证改名会改写定义里的结构化引用。 */
function graphWithFixedLanding(modelId: string): WorkflowGraph {
  const base = createDefaultPolicyGraph([{ modelId, enabled: true }])
  return {
    ...base,
    nodes: base.nodes.map(node => node.kind === 'model-select' && node.source === 'fixed'
      ? { ...node, modelIds: [modelId], fallbackModelIds: [] }
      : node),
  }
}

/** 一张固定落点与字面量条件都指向 `modelId` 的规则表。 */
function ruleSetReferencing(modelId: string): RouteRuleSet {
  const rule = createRouteRule([modelId])
  return {
    version: ROUTE_RULE_SET_VERSION,
    rules: [{ ...rule, conditions: [{ ...rule.conditions[0], value: modelId }] }],
    fallbackModelIds: [modelId],
  }
}

describe('logical model store', () => {
  it('creates and updates logical models with real database persistence', async () => {
    const created = await createLogicalModel({ modelId: 'production', description: 'prod routing', enabled: true })

    // 记录 id 由存储层生成，调用方给不了 —— 界面上能表达的只有模型 id。
    expect(created.id).toMatch(/^lm_/)
    expect(await listLogicalModels()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, modelId: 'production' }),
    ]))

    const updated = await updateLogicalModel(created.id, { modelId: 'production-v2', description: 'updated', enabled: false })
    expect(updated).toMatchObject({
      id: created.id,
      modelId: 'production-v2',
      description: 'updated',
      enabled: false,
    })
    // 改名只动第二把钥匙：记录 id 是外键锚点，必须一动不动。
    expect(await getLogicalModel(created.id)).toMatchObject({ id: created.id, modelId: 'production-v2' })
  })

  it('rejects a duplicate active model id with a typed error instead of leaking a 500', async () => {
    await createLogicalModel({ modelId: 'production' })

    await expect(createLogicalModel({ modelId: 'production' })).rejects.toMatchObject({
      code: 'DUPLICATE_RESOURCE',
      details: { modelId: 'production' },
    })
  })

  it('renames a model id by rewriting the route definitions that reference it', async () => {
    const created = await createLogicalModel({ modelId: 'fast', description: '' })
    await saveRouterGraphVersion(graphWithFixedLanding('fast'), 'v1', '')
    await saveRouteRuleSetVersion(ruleSetReferencing('fast'), 'v1', '')

    await updateLogicalModel(created.id, { modelId: 'fast-v2' })

    // 落点是定义里的结构化引用：改名必须把它们一起搬走，否则路由会静默退化成兜底。
    const graphAfter = await readRouterGraphSnapshot()
    const landings = graphAfter?.graph.nodes
      .flatMap(node => (node.kind === 'model-select' && node.source === 'fixed' ? node.modelIds : []))
    expect(landings).toEqual(['fast-v2'])

    // 字面量条件里的固定值同样按 id 指向它，也要跟着改。
    const rulesAfter = await readRouteRuleSnapshot()
    expect(rulesAfter?.ruleSet.fallbackModelIds).toEqual(['fast-v2'])
    expect(rulesAfter?.ruleSet.rules[0].landing.logicalModelIds).toEqual(['fast-v2'])
    expect(rulesAfter?.ruleSet.rules[0].conditions[0].value).toBe('fast-v2')
  })

  it('soft deletes by tombstoning the model id so the name is free again while the record id survives', async () => {
    const created = await createLogicalModel({ modelId: 'retired', description: '' })

    await deleteLogicalModel(created.id)

    // 记录 id 不动：调度绑定的外键指着它，一行都不用搬。
    const deleted = await getLogicalModel(created.id)
    expect(deleted?.id).toBe(created.id)
    expect(deleted?.deletedTime).toEqual(expect.any(Number))
    expect(deleted?.modelId).not.toBe('retired')
    // 模型 id 被改写成墓碑，原名字立刻可以重新使用，不会再撞上「已存在」。
    expect(await getLogicalModelByModelId('retired')).toBeUndefined()
    const reused = await createLogicalModel({ modelId: 'retired', description: '' })
    expect(reused.id).not.toBe(created.id)
  })

  it('refuses to delete or rename the built-in default logical model', async () => {
    const recordId = await defaultRecordId()

    await expect(deleteLogicalModel(recordId)).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' })
    await expect(updateLogicalModel(recordId, { modelId: 'renamed-default' })).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' })
  })

  it('maps model ids to record ids, ignoring unknown and retired ones', async () => {
    const mapped = await createLogicalModel({ modelId: 'mapped', description: '' })
    const retired = await createLogicalModel({ modelId: 'gone', description: '' })
    await deleteLogicalModel(retired.id)

    const byModelId = await mapLogicalModelIdsToRecordIds(['mapped', 'gone', 'never-existed'])

    expect(byModelId.get('mapped')).toBe(mapped.id)
    expect(byModelId.has('gone')).toBe(false)
    expect(byModelId.has('never-existed')).toBe(false)
  })

  it('manages scheduling policies with the actual sqlite schema', async () => {
    const provider = await createProvider({
      name: 'Scheduling Provider',
      apiKeyReference: 'key_scheduler',
      timeoutMilliseconds: 15_000,
      enabled: true,
    })
    const model = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'scheduler-model',
      priority: 10,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: false,
      }],
    })

    const logicalModelRecordId = await defaultRecordId()
    const policy = await upsertSchedulingPolicy({
      logicalModelId: logicalModelRecordId,
      providerModelId: model.id,
      priority: 3,
      weight: 80,
      enabled: true,
    })

    expect(policy).toMatchObject({
      logicalModelId: logicalModelRecordId,
      providerModelId: model.id,
      priority: 3,
      weight: 80,
      enabled: true,
    })

    expect(await listSchedulingPolicies(logicalModelRecordId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: model.id, priority: 3, weight: 80 }),
    ]))

    // 关开关只传 enabled：优先级和权重必须留在原处。拖排序只传 priority：不得把 enabled 打开。
    await upsertSchedulingPolicy({ logicalModelId: logicalModelRecordId, providerModelId: model.id, enabled: false })
    expect(await listSchedulingPolicies(logicalModelRecordId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: model.id, priority: 3, weight: 80, enabled: false }),
    ]))
    await upsertSchedulingPolicy({ logicalModelId: logicalModelRecordId, providerModelId: model.id, priority: 5 })
    expect(await listSchedulingPolicies(logicalModelRecordId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: model.id, priority: 5, weight: 80, enabled: false }),
    ]))
  })

  // issue #14：模型本体被停用时，不允许再从逻辑模型里把它打开——
  // 打开也永远不会被调度（`getAvailableModels` 要求模型本体也是启用的），
  // 界面上的「已启用」只是一句谎话。
  it('refuses to enable a binding whose provider model is disabled', async () => {
    const provider = await createProvider({
      name: 'Disabled Model Provider',
      apiKeyReference: 'key_disabled_model_provider',
      timeoutMilliseconds: 15_000,
      enabled: true,
    })
    const model = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'switched-off-model',
      priority: 1,
      enabled: false,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: false,
      }],
    })

    // 关着加进来是允许的：绑定可以先存在，等模型本体启用后再打开。
    const logicalModelRecordId = await defaultRecordId()
    expect(await upsertSchedulingPolicy({ logicalModelId: logicalModelRecordId, providerModelId: model.id, priority: 1, enabled: false }))
      .toMatchObject({ enabled: false })

    await expect(upsertSchedulingPolicy({ logicalModelId: logicalModelRecordId, providerModelId: model.id, priority: 1, enabled: true }))
      .rejects.toMatchObject({
        code: 'PROVIDER_MODEL_DISABLED',
        statusCode: 400,
        details: { modelName: 'switched-off-model' },
      })

    // 被拒绝之后绑定仍旧是关着的，不能留下半个打开的状态。
    expect(await listSchedulingPolicies(logicalModelRecordId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: model.id, enabled: false }),
    ]))

    // 模型本体重新启用后，同一个绑定可以被打开。
    await updateProviderModelRoute(model.id, { enabled: true })
    expect(await upsertSchedulingPolicy({ logicalModelId: logicalModelRecordId, providerModelId: model.id, priority: 1, enabled: true }))
      .toMatchObject({ enabled: true })
  })

  it('persists the dragged logical model order across reads', async () => {
    const alpha = await createLogicalModel({ modelId: 'alpha', description: '' })
    const beta = await createLogicalModel({ modelId: 'beta', description: '' })

    const before = (await listLogicalModels()).map(model => model.id)
    const reversed = [...before].reverse()
    await reorderLogicalModels(reversed)

    // 排序键是记录 id；模型 id 只是跟着记录行一起动。
    expect((await listLogicalModels()).map(model => model.id)).toEqual(reversed)
    expect(new Set([alpha.id, beta.id]).size).toBe(2)
  })
})
