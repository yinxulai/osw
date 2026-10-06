import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryEventInput } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
import { createProvider } from '@server/database/provider-store'
import { createProviderModelRoute } from '@server/database/model-store'
import { createRequestRewriteRule, getRequestRewriteRule, listRequestRewriteRules } from '@server/database/request-rewrite-rule-store'
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

  /**
   * 响应阶段整段被功能闸门关闭（`RESPONSE_REWRITE_ENABLED`，见 `@common/features`）。
   *
   * 界面藏起「响应」选项只是第一道；真正要防的是脚本、旧数据或第三方客户端直接把带响应
   * 阶段的请求打进来——只靠界面藏，等于把闸门交给调用方自觉。这三条用例盯住写入（create /
   * update）与试跑（test）三个入口都拒绝了，并且回的是**具名**错误码而不是笼统的 400：
   * 界面要能据此本地化出一句可照做的理由。
   */
  describe('response stage is closed behind the feature flag', () => {
    it('rejects a create that carries a response-stage action', async () => {
      const res = mockResponse()
      await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/create', res, {
        name: 'response rule',
        description: '',
        enabled: true,
        scope: 'model',
        schemaVersion: 1,
        source: 'user',
        match: { clientProtocols: [], upstreamProtocols: [] },
        actions: [{ type: 'body-set', stage: 'response', path: '$.text', value: 'x' }],
        testCases: [],
      })
      expect(responseData(res)).toMatchObject({ success: false, errorCode: 'RESPONSE_REWRITE_DISABLED' })
      // 被拒绝的写入一个字节都不该落库。
      expect(await listRequestRewriteRules()).toHaveLength(0)
    })

    it('rejects an update that switches an action to the response stage', async () => {
      const rule = await createRequestRewriteRule({
        name: 'request rule', description: '', enabled: true, scope: 'model', schemaVersion: 1, source: 'user',
        match: { clientProtocols: [], upstreamProtocols: [] },
        actions: [{ type: 'header-set', stage: 'request', name: 'x-a', value: 'a' }],
        testCases: [],
      })
      const res = mockResponse()
      await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/update', res, {
        id: rule.id,
        actions: [{ type: 'body-set', stage: 'response', path: '$.text', value: 'x' }],
      })
      expect(responseData(res)).toMatchObject({ success: false, errorCode: 'RESPONSE_REWRITE_DISABLED' })
      // 原规则的动作没有被改写——拒绝必须发生在落库之前。
      const stored = await getRequestRewriteRule(rule.id)
      expect(stored?.actions).toEqual([{ type: 'header-set', stage: 'request', name: 'x-a', value: 'a' }])
    })

    it('rejects a response-stage test case', async () => {
      const res = mockResponse()
      await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/test', res, {
        rule: {
          id: 'rule_response_test', name: 'x', description: '', enabled: true, global: true, source: 'user',
          match: { clientProtocols: [], upstreamProtocols: [] }, schemaVersion: 1,
          actions: [{ type: 'body-set', stage: 'response', path: '$.text', value: 'x' }],
          testCases: [], createdTime: 0, updatedTime: 0, deletedTime: null,
        },
        testCase: { stage: 'response', body: '{"text":"original"}', headers: '{}', clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions', transport: 'http' },
      })
      expect(responseData(res)).toMatchObject({ success: false, errorCode: 'RESPONSE_REWRITE_DISABLED' })
    })

    it('rejects a response-stage test case even when the rule itself only touches the request', async () => {
      // 试跑的阶段是「这一次试跑」的属性，与规则里存了什么无关：用户可以在一条纯请求阶段的
      // 规则上把试跑切到响应阶段。只看规则的动作就会漏掉这条入口。
      const res = mockResponse()
      await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/test', res, {
        rule: {
          id: 'rule_request_only', name: 'x', description: '', enabled: true, global: true, source: 'user',
          match: { clientProtocols: [], upstreamProtocols: [] }, schemaVersion: 1,
          actions: [{ type: 'header-set', stage: 'request', name: 'x-a', value: 'a' }],
          testCases: [], createdTime: 0, updatedTime: 0, deletedTime: null,
        },
        testCase: { stage: 'response', body: '{"text":"original"}', headers: '{}', clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions', transport: 'http' },
      })
      expect(responseData(res)).toMatchObject({ success: false, errorCode: 'RESPONSE_REWRITE_DISABLED' })
    })
  })

  it('reports a missing rule as 404 instead of an empty success', async () => {
    const res = mockResponse()

    await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/get', res, { id: 'rule_nope' })

    expect(responseData(res)).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
    expect(res.statusCode).toBe(404)
  })

  /**
   * WebSocket 是双向多轮：正文既不是一整份、也不是向下分帧，改写引擎没有可以下手的形态。
   * 真实入口对同一个请求回 501，所以试跑必须**一致地**失败——`bodyDeliveryShape('websocket')`
   * 其实能给一个形态，放着往下走就会一本正经地报「改造成功了 N 条」，让用户以为 WS 上生效了。
   */
  it('refuses to dry-run a websocket test case', async () => {
    const res = mockResponse()
    await requestRewriteRuleRoutes.invoke('/api/request-rewrite-rule/test', res, {
      rule: {
        id: 'rule_ws', name: 'x', description: '', enabled: true, global: true, source: 'user',
        match: { clientProtocols: [], upstreamProtocols: [] }, schemaVersion: 1,
        actions: [{ type: 'header-set', stage: 'request', name: 'x-a', value: 'a' }],
        testCases: [], createdTime: 0, updatedTime: 0, deletedTime: null,
      },
      testCase: { stage: 'request', body: '{"a":1}', headers: '{}', clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions', transport: 'websocket' },
    })

    expect(responseData(res)).toMatchObject({ success: false, errorCode: 'TRANSPORT_NOT_IMPLEMENTED' })
    expect(res.statusCode).toBe(400)
  })
})
