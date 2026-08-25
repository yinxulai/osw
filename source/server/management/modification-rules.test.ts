import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createProvider } from '../database/provider-store'
import { createProviderModelRoute } from '../database/model-store'
import { createRequestRewriteRule } from '../database/modification-rule-store'
import { requestRewriteRuleRoutes } from './modification-rules'

function mockResponse() {
  return { statusCode: 0, headersSent: false, writableEnded: false, setHeader: vi.fn(), end: vi.fn() } as unknown as import('node:http').ServerResponse
}

function responseData(response: import('node:http').ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-rewrite-rules-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('request rewrite rule routes', () => {
  it('creates, reads, updates and tests a rewrite rule', async () => {
    const provider = await createProvider({ name: 'Rule Provider', apiKeyReference: 'key_rule', timeoutMilliseconds: 20_000, enabled: true })
    const providerModel = await createProviderModelRoute({ providerId: provider.id, modelName: 'rule-model', priority: 0 })

    const createRes = mockResponse()
    await requestRewriteRuleRoutes['/api/request-rewrite-rule/create']({} as import('node:http').IncomingMessage, createRes, {
      name: 'default header',
      description: 'tests something',
      enabled: true,
      scope: 'global',
      schemaVersion: 1,
      source: 'user',
      match: { clientProtocols: ['openai-responses'] },
      actions: [{ type: 'header-set', stage: 'request', name: 'x-created', value: 'created' }],
      testCases: [],
    })
    const created = responseData(createRes).data as { id: string }
    expect(created.id).toMatch(/^rule_/)

    const getRes = mockResponse()
    await requestRewriteRuleRoutes['/api/request-rewrite-rule/get']({} as import('node:http').IncomingMessage, getRes, { id: created.id })
    expect(responseData(getRes).data).toMatchObject({ id: created.id, name: 'default header' })

    const updateRes = mockResponse()
    await requestRewriteRuleRoutes['/api/request-rewrite-rule/update']({} as import('node:http').IncomingMessage, updateRes, {
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
      match: { clientProtocols: ['openai-responses'], upstreamProtocols: ['openai-responses'], path: '/v1/responses' },
      actions: [{ type: 'header-set', stage: 'request', name: 'x-test-header', value: 'enabled' }],
      testCases: [],
      createdTime: Date.now(),
      updatedTime: Date.now(),
      deletedTime: null,
    })

    const testRes = mockResponse()
    await requestRewriteRuleRoutes['/api/request-rewrite-rule/test']({} as import('node:http').IncomingMessage, testRes, {
      rule: {
        ...rule,
        name: 'add custom header',
        description: 'updated description',
        enabled: true,
        scope: 'model',
        schemaVersion: 1,
        source: 'user',
        match: { clientProtocols: ['openai-responses'] },
        actions: [{ type: 'header-set', stage: 'request', name: 'x-updated', value: 'updated' }],
        testCases: [],
        createdTime: Date.now(),
        updatedTime: Date.now(),
        deletedTime: null,
      },
      testCase: {
        stage: 'request',
        body: '{"hello":"world"}',
        headers: '{"authorization":"Bearer token"}',
        clientProtocol: 'openai-responses',
        upstreamProtocol: 'openai-responses',
        logicalModelId: 'default',
        providerModelId: providerModel.id,
        path: '/v1/responses',
        streaming: false,
      },
    })
    expect(responseData(testRes).data).toMatchObject({ body: '{"hello":"world"}' })
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
      match: { clientProtocols: ['openai-responses'] },
      actions: [{ type: 'header-set', stage: 'request', name: 'x-bind', value: 'rule' }],
      testCases: [],
      createdTime: Date.now(),
      updatedTime: Date.now(),
      deletedTime: null,
    })

    const replaceRes = mockResponse()
    await requestRewriteRuleRoutes['/api/request-rewrite-rule/replace-bindings']({} as import('node:http').IncomingMessage, replaceRes, {
      providerModelId: providerModel.id,
      bindings: [{ ruleId: rule.id, priority: 1, enabled: true }],
    })
    expect(responseData(replaceRes).data).toEqual([expect.objectContaining({ ruleId: rule.id, priority: 1, enabled: true })])

    const listRes = mockResponse()
    await requestRewriteRuleRoutes['/api/request-rewrite-rule/bindings']({} as import('node:http').IncomingMessage, listRes, { providerModelId: providerModel.id })
    expect(responseData(listRes).data).toEqual([expect.objectContaining({ ruleId: rule.id })])
  })
})
