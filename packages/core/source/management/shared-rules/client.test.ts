import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../errors'
import { RequestRewriteRuleSchema } from '@common/schemas'

vi.mock('../../infrastructure/network/outbound-connector', () => ({
  createOutboundConnector: vi.fn(),
}))

vi.mock('../../infrastructure/network/core-network', () => ({
  createCoreNetworkClient: vi.fn(),
}))

vi.mock('../../database/settings-store', () => ({
  getSettings: vi.fn(),
}))

vi.mock('../../database/request-rewrite-rule-store', () => ({
  getRequestRewriteRule: vi.fn(),
  createRequestRewriteRule: vi.fn(),
}))

import { createOutboundConnector } from '../../infrastructure/network/outbound-connector'
import { createCoreNetworkClient } from '../../infrastructure/network/core-network'
import { getSettings } from '../../database/settings-store'
import { getRequestRewriteRule, createRequestRewriteRule } from '../../database/request-rewrite-rule-store'
import { adoptSharedRule, browseSharedRules, publishRuleToDirectory } from './service'
import { listSharedRules } from './client'

/**
 * 目录客户端要断言的是「发到哪儿、发什么、怎么翻译应答」，所以连接器与网络客户端、设置都换成替身，
 * 只留下真实的编排。本地 HTTP 服务在这里反而帮不上忙：真正需要盯住的是 URL 推导、
 * 请求头、以及非 2xx 应答如何变成 `AppError`。
 */

interface BufferedResponse {
  statusCode: number
  body: string
}

interface RequestCall {
  url: URL
  options: { method: string; hostname: string; port: string; path: string; headers: Record<string, string | number> }
  body: Buffer
}

const SHARED_RULE = {
  id: 'sha256:abc',
  name: 'Strip thinking',
  description: 'Removes reasoning blocks',
  scope: 'global',
  schemaVersion: 1,
  match: {},
  actions: [{ type: 'header-remove', stage: 'request', name: 'x-thinking' }],
  testCases: [],
  usageCount: 4,
  createdTime: 1,
  updatedTime: 2,
}

let calls: RequestCall[]
let response: BufferedResponse
let connector: { initialize: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }

/** 每次请求按动作分派应答，方便让一次「使用」同时经过 get 与 use 两条路径。 */
function respondByAction(map: (action: string) => BufferedResponse): void {
  vi.mocked(createCoreNetworkClient).mockReturnValue({
    requestHttpBuffered: (url: URL, options: RequestCall['options'], body: Buffer) => {
      calls.push({ url, options, body })
      return Promise.resolve(map(url.pathname.split('/').pop() ?? ''))
    },
  } as never)
}

beforeEach(() => {
  calls = []
  response = { statusCode: 200, body: JSON.stringify({ ok: true, rules: [], total: 0, limit: 30, offset: 0 }) }
  connector = { initialize: vi.fn(async () => undefined), destroy: vi.fn() }
  vi.mocked(createOutboundConnector).mockReturnValue(connector as never)
  respondByAction(() => response)
  // 默认走内置常量（空 telemetryEndpoint）。
  vi.mocked(getSettings).mockResolvedValue({ telemetryEndpoint: '' } as never)
  vi.mocked(getRequestRewriteRule).mockReset()
  vi.mocked(createRequestRewriteRule).mockReset()
})

/** 从请求体的 data 里取回 JSON 载荷，便于断言发出去的是什么。 */
function sentBody(call: RequestCall): unknown {
  return JSON.parse(call.body.toString('utf8'))
}

const LIST_INPUT = { query: '', sort: 'popular' as const, limit: 30, offset: 0 }

describe('shared rules client', () => {
  it('derives the registry endpoint from the telemetry host and posts to the action path', async () => {
    vi.mocked(getSettings).mockResolvedValue({ telemetryEndpoint: 'http://127.0.0.1:8787/v1/track' } as never)

    await listSharedRules(LIST_INPUT)

    expect(calls).toHaveLength(1)
    const call = calls[0]
    // 主机与端口来自遥测端点，路径换成目录路径，动作作为最后一段。
    expect(call.url.hostname).toBe('127.0.0.1')
    expect(call.url.port).toBe('8787')
    expect(call.options.path).toBe('/v1/rules/list')
    expect(call.options.method).toBe('POST')
    // 端口显式带上：默认端口时 `URL.port` 是空串，交给 `http.request` 会走 80。
    expect(call.options.port).toBe('8787')
    expect(call.options.headers['user-agent']).toBe('OSW-Shared-Rules')
    expect(call.options.headers['content-type']).toBe('application/json')
    expect(sentBody(call)).toEqual(LIST_INPUT)
  })

  it('falls back to the built-in endpoint when the telemetry override is empty', async () => {
    await listSharedRules(LIST_INPUT)

    expect(calls[0].url.hostname).toBe('api.osw.yinxulai.com')
    expect(calls[0].options.path).toBe('/v1/rules/list')
  })

  it('destroys the connector after each call, success or failure', async () => {
    await listSharedRules(LIST_INPUT)
    expect(connector.destroy).toHaveBeenCalledTimes(1)

    respondByAction(() => ({ statusCode: 500, body: JSON.stringify({ ok: false, error: 'boom' }) }))
    await expect(listSharedRules(LIST_INPUT)).rejects.toBeInstanceOf(AppError)
    expect(connector.destroy).toHaveBeenCalledTimes(2)
  })

  it('maps a 404 to RESOURCE_NOT_FOUND', async () => {
    respondByAction(() => ({ statusCode: 404, body: JSON.stringify({ ok: false, error: 'rule_not_found', message: 'Shared rule not found' }) }))

    await expect(listSharedRules(LIST_INPUT)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
  })

  it('maps a non-json body to INVALID_RESPONSE', async () => {
    respondByAction(() => ({ statusCode: 200, body: 'not json' }))

    await expect(listSharedRules(LIST_INPUT)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('maps a 200-with-error envelope to UPSTREAM_ERROR', async () => {
    respondByAction(() => ({ statusCode: 200, body: JSON.stringify({ ok: false, error: 'not_configured' }) }))

    await expect(listSharedRules(LIST_INPUT)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
  })
})

describe('browseSharedRules', () => {
  it('passes the list result straight through', async () => {
    respondByAction(() => ({ statusCode: 200, body: JSON.stringify({ ok: true, rules: [SHARED_RULE], total: 1, limit: 30, offset: 0 }) }))

    const result = await browseSharedRules(LIST_INPUT)

    expect(result).toMatchObject({ total: 1, limit: 30, offset: 0 })
    expect(result.rules).toHaveLength(1)
    expect(result.rules[0]).toMatchObject({ id: SHARED_RULE.id, usageCount: 4 })
  })
})

describe('publishRuleToDirectory', () => {
  it('strips local-only fields and posts the payload', async () => {
    vi.mocked(getRequestRewriteRule).mockResolvedValue(RequestRewriteRuleSchema.parse({
      id: 'rule_local',
      name: 'Local rule',
      description: 'test',
      enabled: false,
      scope: 'global',
      schemaVersion: 1,
      source: 'user',
      match: {},
      actions: [{ type: 'header-set', stage: 'request', name: 'x-a', value: 'b' }],
      testCases: [],
      createdTime: 10,
      updatedTime: 20,
      deletedTime: null,
    }))
    respondByAction(() => ({ statusCode: 200, body: JSON.stringify({ ok: true, rule: SHARED_RULE }) }))

    await publishRuleToDirectory('rule_local')

    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe('/v1/rules/publish')
    // 只发作者撰写的那一半：没有 id / enabled / source / 时间戳。
    expect(sentBody(calls[0])).toEqual({
      rule: {
        name: 'Local rule',
        description: 'test',
        scope: 'global',
        schemaVersion: 1,
        // `match` 的默认值由 schema 补齐（两个协议列表），断言按解析后的形状来。
        match: { clientProtocols: [], upstreamProtocols: [] },
        actions: [{ type: 'header-set', stage: 'request', name: 'x-a', value: 'b' }],
        testCases: [],
      },
    })
  })

  it('rejects a missing local rule with RESOURCE_NOT_FOUND', async () => {
    vi.mocked(getRequestRewriteRule).mockResolvedValue(undefined)

    await expect(publishRuleToDirectory('rule_missing')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
  })
})

describe('adoptSharedRule', () => {
  it('creates a local rule from a shared rule and records one use', async () => {
    respondByAction(action =>
      action === 'get'
        ? { statusCode: 200, body: JSON.stringify({ ok: true, rule: SHARED_RULE }) }
        : { statusCode: 200, body: JSON.stringify({ ok: true, rule: { ...SHARED_RULE, usageCount: 5 } }) })
    vi.mocked(createRequestRewriteRule).mockImplementation(async input => RequestRewriteRuleSchema.parse({ ...input, id: 'rule_new', createdTime: 1, updatedTime: 1, deletedTime: null }))

    const created = await adoptSharedRule('sha256:abc')

    expect(created).toMatchObject({ name: SHARED_RULE.name, enabled: true, source: 'imported', scope: 'global' })
    expect(calls.map(call => call.url.pathname)).toEqual(['/v1/rules/get', '/v1/rules/use'])
  })

  it('still returns the saved rule when the usage counter write fails', async () => {
    respondByAction(action =>
      action === 'get'
        ? { statusCode: 200, body: JSON.stringify({ ok: true, rule: SHARED_RULE }) }
        : { statusCode: 500, body: JSON.stringify({ ok: false, error: 'boom' }) })
    vi.mocked(createRequestRewriteRule).mockImplementation(async input => RequestRewriteRuleSchema.parse({ ...input, id: 'rule_new', createdTime: 1, updatedTime: 1, deletedTime: null }))

    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)

    const created = await adoptSharedRule('sha256:abc')

    expect(created).toMatchObject({ name: SHARED_RULE.name, source: 'imported' })
    expect(debug).toHaveBeenCalled()
    debug.mockRestore()
  })
})
