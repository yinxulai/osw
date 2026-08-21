import { describe, expect, it } from 'vitest'
import { protocolAdapters } from './registry'
import { createRequestContext } from '../request-context'

function context(body: Record<string, unknown>, clientProtocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages') {
  return createRequestContext({
    requestId: 'req_test',
    logicalModelId: 'default',
    clientProtocol,
    method: 'POST',
    path: '/v1/test',
    requestBody: Buffer.from(JSON.stringify(body)),
    request: {} as never,
  })
}

describe('protocol adapter registry', () => {
  it('resolves native adapters and rewrites the provider model', () => {
    const adapter = protocolAdapters.resolve('openai-completions', 'openai-completions')
    const body = JSON.parse(adapter.prepareRequest(context({ model: 'logical', messages: [] }, 'openai-completions'), 'provider-model').toString())

    expect(adapter.clientProtocol).toBe('openai-completions')
    expect(adapter.endpointProtocol).toBe('openai-completions')
    expect(body.model).toBe('provider-model')
    expect(adapter.createStreamConverter()).toBeNull()
  })

  it('resolves conversion adapters and preserves streaming conversion', () => {
    const adapter = protocolAdapters.resolve('openai-completions', 'anthropic-messages')
    const body = JSON.parse(adapter.prepareRequest(context({ model: 'logical', messages: [{ role: 'user', content: 'hi' }], stream: true }, 'openai-completions'), 'provider-model').toString())

    expect(body.model).toBe('provider-model')
    expect(body.messages[0].content[0].text).toBe('hi')
    expect(adapter.createStreamConverter()).not.toBeNull()
    expect(() => protocolAdapters.resolve('anthropic-messages', 'openai-responses')).toThrow('不支持的协议转换方向')
  })
})
