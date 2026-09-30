import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import {
  countProviderModelsUsingRule,
  createRequestRewriteRule,
  deleteRequestRewriteRule,
  getRequestRewriteRule,
  listProviderModelRequestRewriteRules,
  listRequestRewriteRules,
  listRulesForProviderModel,
  replaceProviderModelRequestRewriteRuleBindings,
  updateRequestRewriteRule,
} from './request-rewrite-rule-store'
import { createProvider } from './provider-store'
import { createProviderModelRoute } from './model-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-mod-rule-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

type RuleInput = Parameters<typeof createRequestRewriteRule>[0]

function makeRule(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    name: 'Inject x-trace-id',
    description: 'add request trace id',
    enabled: true,
    scope: 'global',
    schemaVersion: 1,
    source: 'user',
    match: {
      clientProtocols: ['openai-completions'],
      upstreamProtocols: ['openai-completions'],
    },
    actions: [{
      stage: 'request',
      type: 'header-set',
      name: 'x-trace-id',
      value: 'trace-123',
    }],
    testCases: [{
      id: 'tc-1',
      name: 'header injection',
      stage: 'request',
      body: '{"messages":[]}',
      headers: '{"content-type":"application/json"}',
      clientProtocol: 'openai-completions',
      upstreamProtocol: 'openai-completions',
      transport: 'http',
    }],
    ...overrides,
  }
}

describe('request rewrite rule store', () => {
  it('creates, lists, and updates request rewrite rules while preserving testCases round-trips', async () => {
    const created = await createRequestRewriteRule(makeRule())

    expect(created.testCases).toHaveLength(1)
    expect(created.testCases[0]).toMatchObject({ id: 'tc-1', name: 'header injection' })

    const readBack = await getRequestRewriteRule(created.id)
    expect(readBack).toMatchObject({
      id: created.id,
      name: 'Inject x-trace-id',
      scope: 'global',
    })
    expect(readBack?.testCases).toEqual(created.testCases)

    const updated = await updateRequestRewriteRule(created.id, {
      enabled: false,
      testCases: [{
        ...created.testCases[0],
        name: 'updated case',
      }],
    })
    expect(updated.enabled).toBe(false)
    expect(updated.testCases[0].name).toBe('updated case')

    const rules = await listRequestRewriteRules()
    expect(rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, enabled: false }),
    ]))
  })

  it('binds rules to provider models, counts usages, and removes them safely', async () => {
    const provider = await createProvider({
      name: 'Rule Provider',
      apiKeyReference: 'key_rule_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const providerModel = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'rule-model',
      priority: 1,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: false,
      }],
    })

    const globalRule = await createRequestRewriteRule(makeRule({ name: 'global rule', scope: 'global' }))
    const boundRule = await createRequestRewriteRule(makeRule({ name: 'model rule', scope: 'model' }))

    const bindings = await replaceProviderModelRequestRewriteRuleBindings(providerModel.id, [
      { ruleId: globalRule.id, priority: 10, enabled: true },
      { ruleId: boundRule.id, priority: 20, enabled: true },
    ])
    expect(bindings).toHaveLength(2)
    expect(await countProviderModelsUsingRule(globalRule.id)).toBe(1)
    expect(await listProviderModelRequestRewriteRules(providerModel.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: providerModel.id, ruleId: globalRule.id, priority: 10 }),
      expect.objectContaining({ providerModelId: providerModel.id, ruleId: boundRule.id, priority: 20 }),
    ]))

    const rulesForModel = await listRulesForProviderModel(providerModel.id)
    expect(rulesForModel).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: globalRule.id }),
      expect.objectContaining({ id: boundRule.id }),
    ]))

    await expect(replaceProviderModelRequestRewriteRuleBindings(providerModel.id, [
      { ruleId: globalRule.id, priority: 5, enabled: true },
      { ruleId: globalRule.id, priority: 10, enabled: true },
    ])).rejects.toMatchObject({ code: 'DUPLICATE_RESOURCE', statusCode: 409 })

    // 优先级重复会撞上 `(providerModelId, priority)` 的部分唯一索引；预检先把它拦成 409，
    // 而不是让 SQLite 的裸约束冲突冒成 500。
    await expect(replaceProviderModelRequestRewriteRuleBindings(providerModel.id, [
      { ruleId: globalRule.id, priority: 7, enabled: true },
      { ruleId: boundRule.id, priority: 7, enabled: true },
    ])).rejects.toMatchObject({ code: 'DUPLICATE_RESOURCE', statusCode: 409 })

    const deleted = await deleteRequestRewriteRule(boundRule.id)
    expect(deleted).toMatchObject({ id: boundRule.id, affectedProviderModelCount: 1 })
    expect(await getRequestRewriteRule(boundRule.id)).toMatchObject({ deletedTime: expect.any(Number) })
    expect(await listProviderModelRequestRewriteRules(providerModel.id)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: boundRule.id }),
    ]))

    await replaceProviderModelRequestRewriteRuleBindings(providerModel.id, [])
    expect(await listProviderModelRequestRewriteRules(providerModel.id)).toEqual([])
    expect(await countProviderModelsUsingRule(globalRule.id)).toBe(0)
  })

  it('rebinds another rule at the priority freed by a removed binding', async () => {
    const provider = await createProvider({
      name: 'Rebind Provider',
      apiKeyReference: 'key_rebind_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const providerModel = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'rebind-model',
      priority: 1,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: false,
      }],
    })
    const first = await createRequestRewriteRule(makeRule({ name: 'first rule', scope: 'model' }))
    const second = await createRequestRewriteRule(makeRule({ name: 'second rule', scope: 'model' }))

    await replaceProviderModelRequestRewriteRuleBindings(providerModel.id, [
      { ruleId: first.id, priority: 10, enabled: true },
    ])
    // 换绑最常见的路径：先移除规则 A（绑定只是被软删除），再把规则 B 放到它空出的
    // priority 上。唯一性由部分索引 `..._priority_active` 表达，它只约束未删除的行，
    // 所以这一步必须被允许。
    await deleteRequestRewriteRule(first.id)

    const rebound = await replaceProviderModelRequestRewriteRuleBindings(providerModel.id, [
      { ruleId: second.id, priority: 10, enabled: true },
    ])

    expect(rebound).toEqual([
      expect.objectContaining({ ruleId: second.id, priority: 10, enabled: true }),
    ])
  })
})
