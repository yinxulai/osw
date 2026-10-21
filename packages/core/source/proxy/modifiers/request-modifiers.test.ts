import { describe, expect, it, vi } from 'vitest'
import type { BufferedPayload, Modifier, ModifierContext } from '@server/proxy/contracts'
import type { ProtocolAdapter } from '@server/proxy/protocols/shared/types'
import type { RequestContext } from '@server/proxy/request/request-context'
import { ToolNameRegistry } from '@server/proxy/protocols/shared/tool-name-registry'
import { createRequestModifiers } from './request-modifiers'

/** 适配器在这几个测试里不出正文，只负责回一份「已经准备好」的字节。 */
function passthroughAdapter(): ProtocolAdapter {
  return {
    kind: 'native',
    clientProtocol: 'openai-completions',
    endpointProtocol: 'openai-completions',
    requiresResponseConversion: false,
    prepareRequest: () => Buffer.from('prepared'),
    createStreamConverter: () => null,
    finishStream: () => '',
    convertResponse: body => body,
  }
}

function createContext(): ModifierContext {
  return {
    direction: 'request',
    clientProtocol: 'openai-completions',
    upstreamProtocol: 'openai-completions',
    exchange: {
      requestId: 'req-1',
      logicalModelId: 'logical-1',
      clientProtocol: 'openai-completions',
      transport: 'http',
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer client-key' },
      body: Buffer.from('{}'),
      signal: new AbortController().signal,
    },
    attempt: { index: 0, endpointId: 'completions', endpointProtocol: 'openai-completions' },
    upstreamHead: null,
  }
}

function createOptions(overrides: Partial<Parameters<typeof createRequestModifiers>[0]> = {}) {
  return {
    adapter: passthroughAdapter(),
    requestContext: {} as RequestContext,
    providerModelName: 'gpt-4o',
    auth: { replace: { authorization: 'Bearer provider-key' }, fill: {} },
    rules: [],
    toolNames: new ToolNameRegistry(),
    onRewriteEvaluated: vi.fn(),
    ...overrides,
  }
}

function findModifier(modifiers: readonly Modifier[], id: string): Modifier {
  const modifier = modifiers.find(item => item.id === id)
  if (!modifier) throw new Error(`缺少修改器 ${id}`)
  return modifier
}

async function runBuffered(modifier: Modifier, context: ModifierContext, payload: BufferedPayload): Promise<BufferedPayload> {
  const result = await modifier.applyBuffered?.(context, payload)
  if (!result) throw new Error(`修改器 ${modifier.id} 丢掉了这次交换`)
  return result
}

describe('createRequestModifiers', () => {
  it('runs headers before body so the prepared body drives content-length', async () => {
    const modifiers = createRequestModifiers(createOptions())
    expect(modifiers.map(modifier => modifier.id)).toEqual(['upstream-headers', 'body-prepare', 'request-rewrite'])
    expect(modifiers.map(modifier => modifier.order)).toEqual([10, 20, 30])
  })

  it('replaces the client credential with the resolved provider credential', async () => {
    const modifiers = createRequestModifiers(createOptions())
    const headers = findModifier(modifiers, 'upstream-headers')

    const result = await runBuffered(headers, createContext(), { body: Buffer.from('{}'), headers: {} })

    expect(result.headers).toMatchObject({ authorization: 'Bearer provider-key', 'content-type': 'application/json' })
  })

  it('attaches plugin headers provided by resolveRequest', async () => {
    // 这是契约里 `PluginRequestResolutionResultSchema.headers` 的落地断言：
    // 插件声明「这个请求还要带上门户的组织标识」，它必须真的出现在发往上游的头里。
    const modifiers = createRequestModifiers(createOptions({
      pluginHeaders: { 'openai-organization': 'org-1', 'x-tenant-id': 'tenant-1' },
    }))
    const headers = findModifier(modifiers, 'upstream-headers')

    const result = await runBuffered(headers, createContext(), { body: Buffer.from('{}'), headers: {} })

    expect(result.headers).toMatchObject({
      authorization: 'Bearer provider-key',
      'openai-organization': 'org-1',
      'x-tenant-id': 'tenant-1',
    })
  })

  it('keeps authentication and hop-by-hop headers out of reach of plugin headers', async () => {
    const modifiers = createRequestModifiers(createOptions({
      pluginHeaders: { authorization: 'Bearer sneaky', host: 'evil.example', 'x-tenant-id': 'tenant-1' },
    }))
    const headers = findModifier(modifiers, 'upstream-headers')

    const result = await runBuffered(headers, createContext(), { body: Buffer.from('{}'), headers: {} })

    expect(result.headers.authorization).toBe('Bearer provider-key')
    expect(result.headers.host).toBeUndefined()
    expect(result.headers['x-tenant-id']).toBe('tenant-1')
  })

  it('carries plugin headers through the remaining request modifiers', async () => {
    const modifiers = createRequestModifiers(createOptions({ pluginHeaders: { 'x-tenant-id': 'tenant-1' } }))
    let payload: BufferedPayload = { body: Buffer.from('{}'), headers: {} }

    for (const modifier of modifiers) {
      payload = await runBuffered(modifier, createContext(), payload)
    }

    expect(payload.headers['x-tenant-id']).toBe('tenant-1')
    expect(payload.headers.authorization).toBe('Bearer provider-key')
  })

  it('leaves headers untouched when no plugin supplies any', async () => {
    const modifiers = createRequestModifiers(createOptions())
    const headers = findModifier(modifiers, 'upstream-headers')

    const result = await runBuffered(headers, createContext(), { body: Buffer.from('{}'), headers: {} })

    // 没有插件头时，头集合就是「客户端转发 + 凭据 + 链路自己算的 content-length」，一个不多。
    expect(Object.keys(result.headers).sort()).toEqual(['authorization', 'content-length', 'content-type'])
    expect(result.headers['content-length']).toBe('2')
  })
})
