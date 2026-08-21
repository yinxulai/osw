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
    const response = Buffer.from(JSON.stringify({ id: 'resp_native', model: 'provider-model' }))

    expect(adapter.clientProtocol).toBe('openai-completions')
    expect(adapter.endpointProtocol).toBe('openai-completions')
    expect(adapter.requiresResponseConversion).toBe(false)
    expect(body.model).toBe('provider-model')
    expect(adapter.createStreamConverter()).toBeNull()
    expect(adapter.convertResponse(response)).toBe(response)
  })

  it('resolves conversion adapters and preserves streaming conversion', () => {
    const adapter = protocolAdapters.resolve('openai-completions', 'anthropic-messages')
    const body = JSON.parse(adapter.prepareRequest(context({ model: 'logical', messages: [{ role: 'user', content: 'hi' }], stream: true }, 'openai-completions'), 'provider-model').toString())

    expect(adapter.requiresResponseConversion).toBe(true)
    expect(body.model).toBe('provider-model')
    expect(body.messages[0].content[0].text).toBe('hi')
    const converter = adapter.createStreamConverter()
    expect(converter).not.toBeNull()
    expect(adapter.finishStream(converter!)).toBe('data: [DONE]\n\n')
    const response = JSON.parse(adapter.convertResponse(Buffer.from(JSON.stringify({
      id: 'msg_test',
      type: 'message',
      model: 'provider-model',
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
    }))).toString())
    expect(response.object).toBe('chat.completion')
    expect(response.choices[0].message.content).toBe('hello')
    expect(() => protocolAdapters.resolve('anthropic-messages', 'openai-responses')).toThrow('不支持的协议转换方向')
  })
})
