import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryEventInput } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
import { createProvider } from '@server/database/provider-store'
import { createProviderModelRoute } from '@server/database/model-store'
import { createRequestRewriteRule } from '@server/database/request-rewrite-rule-store'
import { RequestRewriteError } from '@server/proxy/request-rewrite/request-rewrite-engine'
import { requestRewriteRuleRoutes } from './routes/relations/request-rewrite-rules'
import { mockResponse } from './test-support'

/**
 * 新建规则只发一条，属性是「来源」：库里存三档（`user` / `builtin` / `imported`），
 * 上报只有两档——要回答的是「内建模板有人用吗」，所以只有内建才算 `builtin`。
 */
const { reported } = vi.hoisted(() => ({ reported: [] as TelemetryEventInput[] }))

vi.mock('@server/telemetry', () => ({
  reportTelemetryEvent: (event: TelemetryEventInput) => {
    reported.push(event)
  },
}))

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-rewrite-rules-'))
  await initDatabases(temporaryDirectory)
  reported.length = 0
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('request rewrite rule routes', () => {
  it('creates, reads, updates and tests a rewrite rule', async () => {
    const createRes = mockResponse()
    await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/create', createRes, {
      name: 'default header',
      description: 'tests something',
      enabled: true,
      scope: 'global',
      schemaVersion: 1,
      source: 'user',
      match: { clientProtocols: ['openai-responses'], upstreamProtocols: [] },
      actions: [{ type: 'header-set', stage: 'request', name: 'x-created', value: 'created' }],
      testCases: [],
    })
    const created = responseData(createRes).data as { id: string }
    expect(created.id).toMatch(/^rule_/)
    expect(reported).toEqual([{ name: 'rewrite_rule_created', kind: 'custom' }])

    const getRes = mockResponse()
    await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/get', getRes, { id: created.id })
    expect(responseData(getRes).data).toMatchObject({ id: created.id, name: 'default header' })

    const updateRes = mockResponse()
    await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/update', updateRes, {
      id: created.id,
      description: 'updated description',
      enabled: true,
      scope: 'model',
      schemaVersion: 1,
      source: 'user',
      match: { clientProtocols: ['openai-responses'] },
      actions: [{ type: 'header-set', stage: 'request', name: 'x-updated', value: 'updated' }],
      testCases: [],
    })
    expect(responseData(updateRes).data).toMatchObject({ id: created.id, description: 'updated description' })

    const rule = await createRequestRewriteRule({
      name: 'add custom header',
      description: 'tests header injection',
      enabled: true,
      scope: 'global',
      schemaVersion: 1,
      source: 'user',
      match: { clientProtocols: ['openai-responses'], upstreamProtocols: ['openai-responses'] },
      actions: [{ type: 'header-set', stage: 'request', name: 'x-test-header', value: 'enabled' }],
      testCases: [],
    })

    const testRes = mockResponse()
    await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/test', testRes, {
      rule: {
        ...rule,
        name: 'add custom header',
        description: 'updated description',
        enabled: true,
        scope: 'model',
        schemaVersion: 1,
        source: 'user',
        match: { clientProtocols: ['openai-responses'], upstreamProtocols: [] },
        actions: [{ type: 'header-set', stage: 'request', name: 'x-updated', value: 'updated' }],
        testCases: [],
      },
      testCase: {
        stage: 'request',
        body: '{"hello":"world"}',
        headers: '{"authorization":"Bearer token"}',
        clientProtocol: 'openai-responses',
        upstreamProtocol: 'openai-responses',
        transport: 'http',
      },
    })
    expect(responseData(testRes).data).toMatchObject({ body: '{"hello":"world"}' })
  })

  /**
   * 试跑要能把脚本的日志带回界面。`/test` 把引擎结果摊平后回给前端（body 转成字符串），
   * `scriptLogs` 是新增字段，最怕在摊平时被顺手丢掉——那样脚本编辑器里永远看不到日志。
   */
  it('surfaces script logs and applied body from the test endpoint', async () => {
    const testRes = mockResponse()
    await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/test', testRes, {
      rule: {
        id: 'rule_script',
        name: 'scripted body',
        description: '',
        enabled: true,
        global: true,
        source: 'user',
        match: { clientProtocols: ['openai-completions'], upstreamProtocols: [] },
        schemaVersion: 1,
        actions: [
          { type: 'script', stage: 'request', code: 'console.log("seen", body.count); return { body: { ...body, count: body.count + 1 } }', timeoutMilliseconds: 200 },
        ],
        testCases: [],
        createdTime: 0,
        updatedTime: 0,
        deletedTime: null,
      },
      testCase: {
        stage: 'request',
        body: '{"count":1}',
        headers: '{"authorization":"Bearer token"}',
        clientProtocol: 'openai-completions',
        upstreamProtocol: 'openai-completions',
        transport: 'http',
      },
    })
    const data = responseData(testRes).data as { body: string, scriptLogs: string[], appliedRuleIds: string[] }
    expect(JSON.parse(data.body)).toEqual({ count: 2 })
    expect(data.scriptLogs).toEqual(['[log] seen 1'])
    expect(data.appliedRuleIds).toEqual(['rule_script'])
  })

  it('reports a failing script as an error instead of a partial result', async () => {
    const testRes = mockResponse()
    // 脚本抛错时引擎抛 `RequestRewriteError`，路由不吞掉它：试跑请求以失败收场，
    // 而不是 200 带一份脏数据回界面。
    await expect(requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/test', testRes, {
      rule: {
        id: 'rule_boom',
        name: 'throwing script',
        description: '',
        enabled: true,
        global: true,
        source: 'user',
        match: { clientProtocols: ['openai-completions'], upstreamProtocols: [] },
        schemaVersion: 1,
        actions: [{ type: 'script', stage: 'request', code: 'throw new Error("boom")' }],
        testCases: [],
        createdTime: 0,
        updatedTime: 0,
        deletedTime: null,
      },
      testCase: {
        stage: 'request',
        body: '{"count":1}',
        headers: '{}',
        clientProtocol: 'openai-completions',
        upstreamProtocol: 'openai-completions',
        transport: 'http',
      },
    })).rejects.toThrow(RequestRewriteError)
    expect(vi.mocked(testRes.end)).not.toHaveBeenCalled()
  })

  /**
   * 来源的映射只有一处，但它决定了整个属性有没有信息量：库里三档、上报两档，只有内建算
   * `builtin`。界面从模板起手时写的就是 `builtin`（`rule-presets.ts`），这里盯住这条通路。
   */
  it('maps the rule source to the two-value vocabulary', async () => {
    for (const [source, kind] of [['builtin', 'builtin'], ['user', 'custom'], ['imported', 'custom']] as const) {
      reported.length = 0
      const res = mockResponse()
      await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/create', res, {
        name: `rule from ${source}`,
        description: '',
        enabled: true,
        scope: 'model',
        schemaVersion: 1,
        source,
        match: { clientProtocols: [], upstreamProtocols: [] },
        actions: [{ type: 'header-set', stage: 'request', name: `x-${source}`, value: source }],
        testCases: [],
      })
      expect(reported, `source=${source}`).toEqual([{ name: 'rewrite_rule_created', kind }])
    }
  })

  it('lists provider model bindings and replaces them', async () => {
    const provider = await createProvider({ name: 'Bindings Provider', apiKeyReference: 'key_bindings', timeoutMilliseconds: 20_000, enabled: true })
    const providerModel = await createProviderModelRoute({ providerId: provider.id, modelName: 'bindings-model', priority: 0 })
    const rule = await createRequestRewriteRule({
      name: 'binding rule',
      description: 'bind rule',
      enabled: true,
      scope: 'model',
      schemaVersion: 1,
      source: 'user',
      match: { clientProtocols: ['openai-responses'], upstreamProtocols: [] },
      actions: [{ type: 'header-set', stage: 'request', name: 'x-bind', value: 'rule' }],
      testCases: [],
    })

    const replaceRes = mockResponse()
    await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/replace-bindings', replaceRes, {
      providerModelId: providerModel.id,
      bindings: [{ ruleId: rule.id, priority: 1, enabled: true }],
    })
    expect(responseData(replaceRes).data).toEqual([expect.objectContaining({ ruleId: rule.id, priority: 1, enabled: true })])

    const listRes = mockResponse()
    await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/bindings', listRes, { providerModelId: providerModel.id })
    expect(responseData(listRes).data).toEqual([expect.objectContaining({ ruleId: rule.id })])
  })
})
