import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { SecretStore } from '@common/secret-store'
import { closeDatabases, getConfigDb, getDataDb, initDatabases } from './index'
import { seedDevelopmentData } from './development-seed'
import { providerModels, providerModelRequestRewriteRules, providers, requestRewriteRules } from './config-schema'
import { requestUsages } from './data-schema'
import { createProvider, listProviders } from './provider-store'
import { listLogicalModels } from './logical-model-store'
import { listProviderModelRequestRewriteRules, listRequestRewriteRules } from './request-rewrite-rule-store'
import { getAttemptUsage, getRequestLog, getRequestUsage, listAttemptContents, listAttemptsByRequest, listRequestContents, listRequestLogs } from './request-log-store'
import { PRESET_CONDITIONAL_SCRIPT_CODE } from '@common/rewrite-script-samples'

let temporaryDirectory: string
let secretStore: SecretStore

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-seed-'))
  await initDatabases(temporaryDirectory)
  secretStore = {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  }
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('development seed', () => {
  it('populates an empty development database with representative data', async () => {
    expect(await seedDevelopmentData(secretStore)).toBe(true)

    expect(await listProviders()).toHaveLength(4)
    expect((await listProviders()).map(provider => provider.name)).toEqual(expect.arrayContaining(['OpenAI', 'Anthropic', 'Volcengine Ark', 'DeepSeek']))
    expect((await listProviders()).every(provider => !provider.name.includes('开发示例'))).toBe(true)
    // 除启动时内建的 `default` 外，种子再补两条按用途分的队列，逻辑模型页才有复数可摆。
    const logicalModels = await listLogicalModels()
    expect(logicalModels).toHaveLength(3)
    expect(logicalModels.map(model => model.modelId).sort()).toEqual(['default', 'fast', 'reasoning'])
    // 已删除的供应商 / 模型不进活跃列表，但行确实在表里（`deletedTime` 非空即为证据）。
    expect(await listProviders(true)).toHaveLength(5)
    const deletedProviderRows = getConfigDb().select().from(providers).where(eq(providers.id, 'prov_dev_deleted')).all()
    expect(deletedProviderRows).toEqual([expect.objectContaining({ name: 'Deleted Demo Provider', enabled: false, deletedTime: expect.any(Number) })])
    const providerModelRows = getConfigDb().select().from(providerModels).all()
    expect(providerModelRows).toHaveLength(8)
    expect(providerModelRows.filter(row => row.deletedTime !== null)).toEqual([
      expect.objectContaining({ id: 'model_dev_provider_8', providerId: 'prov_dev_deleted', modelName: 'deleted-demo-model', enabled: false }),
    ])
    // 请求重写规则：两条绑在 `model_dev_provider_1` 上、一条全局，全部启用、未被删过。
    const rewriteRules = await listRequestRewriteRules()
    expect(rewriteRules.map(rule => rule.id).sort()).toEqual(['rule_dev_drop_debug_flag', 'rule_dev_probe_header', 'rule_dev_strict_temperature'])
    expect(rewriteRules.map(rule => rule.scope).sort()).toEqual(['global', 'model', 'model'])
    // 种子规则与手写规则等价：`source: 'user'`、可编辑可删除；`builtin` 那一档留给从模板起手的规则。
    expect(rewriteRules.every(rule => rule.source === 'user')).toBe(true)
    // 脚本动作取自 `@common/rewrite-script-samples`：种子里的那段代码必须与模板共用同一份字符串。
    expect(rewriteRules.find(rule => rule.id === 'rule_dev_strict_temperature')!.actions).toEqual([
      expect.objectContaining({ type: 'script', stage: 'request', code: PRESET_CONDITIONAL_SCRIPT_CODE }),
    ])
    expect(await listProviderModelRequestRewriteRules('model_dev_provider_1')).toEqual([
      expect.objectContaining({ providerModelId: 'model_dev_provider_1', ruleId: 'rule_dev_drop_debug_flag', priority: 1, deletedTime: null }),
      expect.objectContaining({ providerModelId: 'model_dev_provider_1', ruleId: 'rule_dev_strict_temperature', priority: 2, deletedTime: null }),
    ])
    expect(getConfigDb().select().from(requestRewriteRules).all()).toHaveLength(3)
    expect(getConfigDb().select().from(providerModelRequestRewriteRules).all()).toHaveLength(2)
    expect(await listRequestLogs(200)).toHaveLength(120)
    const firstBatchRequests = await listRequestLogs(120, 0)
    const successfulRequest = await getRequestLog(firstBatchRequests.find(request => request.status === 'success')!.id)
    expect(successfulRequest).toEqual(expect.objectContaining({
      totalDurationMilliseconds: expect.any(Number),
      ttftMilliseconds: expect.any(Number),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    }))
    const successfulRequestId = successfulRequest!.id
    expect(await getRequestUsage(successfulRequestId)).toEqual(expect.objectContaining({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
      rawUsage: expect.objectContaining({
        prompt_tokens: expect.any(Number),
        completion_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
      }),
    }))
    expect(getConfigDb().select().from(providerModels).all()).toHaveLength(8)
    // 数值用量表里只有可求和的 token 类条目，原始报文另占一行 `raw`。
    const usageRows = getDataDb().select().from(requestUsages).where(eq(requestUsages.requestId, successfulRequestId)).all()
    expect(usageRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'inputTokens', value: expect.any(Number), rawValue: null }),
      expect.objectContaining({ type: 'raw', value: null, rawValue: expect.stringContaining('prompt_tokens') }),
    ]))
    // `totalTokens` 是派生值，不再单独存一行。
    expect(usageRows.some(row => row.type === 'totalTokens')).toBe(false)
    expect((await listRequestContents(successfulRequestId))[0]).toEqual(expect.objectContaining({
      requestMethod: 'POST',
      responseStatus: 200,
      requestBody: expect.stringContaining('messages'),
      responseBody: expect.stringContaining('chat.completion'),
    }))
    const failedRequestId = firstBatchRequests.find(request => request.status === 'failed')!.id
    expect(await getRequestUsage(failedRequestId)).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null })
    expect(await listRequestContents(failedRequestId)).toHaveLength(1)
    expect(await listAttemptContents(failedRequestId)).toHaveLength(1)
    expect(await listAttemptsByRequest(failedRequestId)).toHaveLength(2)
    const failedAttempts = await listAttemptsByRequest(failedRequestId)
    // 事实（TTFT、规则、原始 usage）与是否采集正文无关，总是写入。命中集合是**尝试级**事实：
    // 同一次请求的每一次尝试命中同一组规则，重试不会让后一次少记。
    expect(failedAttempts[0].requestRewriteRuleIds).toEqual(failedAttempts[1].requestRewriteRuleIds)
    expect(failedAttempts.every(attempt => attempt.requestRewriteRuleIds.length > 0)).toBe(true)
    // 响应阶段整段关在 `RESPONSE_REWRITE_ENABLED` 后面，种子不该摆出一份「有响应命中」的假数据。
    expect(failedAttempts.every(attempt => attempt.responseRewriteRuleIds.length === 0)).toBe(true)
    // 上游形态是尝试级事实：没等到响应的那次尝试无从判断，成功那次总有个确定值。
    expect(failedAttempts.find(attempt => attempt.status === 'failed')?.upstreamTransport).toBeNull()
    expect(['http', 'http-stream']).toContain(failedAttempts.find(attempt => attempt.status === 'success')?.upstreamTransport)
    const successfulAttempt = (await listAttemptsByRequest(successfulRequestId))[0]
    expect(await getAttemptUsage(successfulAttempt.id)).toEqual(expect.objectContaining({ totalTokens: expect.any(Number) }))
    expect(new Set((await listRequestLogs()).map(request => request.clientProtocol))).toEqual(new Set([
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
    ]))
    // 命中集合按模型分叉：走到 `model_dev_provider_1` 的尝试三件套齐活（全局 + 两条绑定），
    // 其他模型只有全局那条 —— 绑定没有跟着全局规则偷偷扩散到每个模型上。
    const flatAttempts = (await Promise.all(firstBatchRequests.map(request => listAttemptsByRequest(request.id)))).flat()
    const boundModelAttempts = flatAttempts.filter(attempt => attempt.providerModelId === 'model_dev_provider_1')
    expect(boundModelAttempts.length).toBeGreaterThan(0)
    expect(boundModelAttempts.every(attempt => attempt.requestRewriteRuleIds.length === 3)).toBe(true)
    expect(flatAttempts.filter(attempt => attempt.providerModelId !== 'model_dev_provider_1').every(attempt => attempt.requestRewriteRuleIds.length === 1)).toBe(true)
    // 逻辑模型之间真的分流了：请求记录里既有 `default`，也落到专属队列上。
    expect(new Set(firstBatchRequests.map(request => request.logicalModelId))).toEqual(new Set(['default', 'fast', 'reasoning']))
    expect(secretStore.set).toHaveBeenCalledTimes(5)
  })

  it('does not modify a database that already has configuration', async () => {
    await createProvider({
      name: 'Existing provider',
      apiKeyReference: 'key_existing',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })

    expect(await seedDevelopmentData(secretStore)).toBe(false)
    expect((await listProviders()).map(provider => provider.name)).toEqual(['Existing provider'])
    expect(secretStore.set).not.toHaveBeenCalled()
  })

  it('fills missing fixtures without overwriting existing configuration', async () => {
    await createProvider({
      name: 'Existing provider',
      apiKeyReference: 'key_existing',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })

    expect(await seedDevelopmentData(secretStore, { allowExisting: true })).toBe(true)
    expect((await listProviders()).map(provider => provider.name)).toContain('Existing provider')
    expect(await listProviders()).toHaveLength(5)
    expect(secretStore.set).toHaveBeenCalledTimes(5)

    const firstBatchIds = new Set((await listRequestLogs(200)).map(request => request.id))
    expect(await seedDevelopmentData(secretStore, { allowExisting: true })).toBe(true)
    expect(await listProviders()).toHaveLength(5)
    // 重复补种不会把逻辑模型堆出第二份：还是在 `default` 之外那两条。
    expect(await listLogicalModels()).toHaveLength(3)
    expect(getConfigDb().select({ id: providerModels.id }).from(providerModels).all()).toHaveLength(8)
    // 补种会带上规则，但重复补种不会堆出第二份规则或第二份绑定。
    expect(await listRequestRewriteRules()).toHaveLength(3)
    expect(await listProviderModelRequestRewriteRules('model_dev_provider_1')).toHaveLength(2)
    const allRequests = await listRequestLogs(300)
    expect(allRequests).toHaveLength(240)
    const secondBatchRequests = allRequests.filter(request => !firstBatchIds.has(request.id))
    expect(secondBatchRequests).toHaveLength(120)
    const secondBatchSuccess = secondBatchRequests.find(request => request.status === 'success')!
    const secondBatchFailure = secondBatchRequests.find(request => request.status === 'failed')!
    expect((await getRequestUsage(secondBatchSuccess.id)).totalTokens).not.toBeNull()
    expect(await listRequestContents(secondBatchSuccess.id)).toHaveLength(1)
    expect(await listAttemptsByRequest(secondBatchFailure.id)).toHaveLength(2)
    expect(secretStore.set).toHaveBeenCalledTimes(5)
  })
})
