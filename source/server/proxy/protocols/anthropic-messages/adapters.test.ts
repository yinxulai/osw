import { describe, expect, it } from 'vitest'
import { createRequestContext } from '@server/proxy/request/request-context'
import { AnthropicMessagesNativeAdapter, AnthropicMessagesToOpenAiCompletionsAdapter } from './adapters'

function context(body: Record<string, unknown>) {
  return createRequestContext({
    requestId: 'req_test',
    logicalModelId: 'default',
    clientProtocol: 'anthropic-messages',
    method: 'POST',
    path: '/v1/messages',
    requestBody: Buffer.from(JSON.stringify(body)),
  })
}

describe('anthropic-messages adapters', () => {
  it('native adapter rewrites model and keeps response unchanged', () => {
    const adapter = new AnthropicMessagesNativeAdapter()
    const request = JSON.parse(adapter.prepareRequest(context({ model: 'logical', messages: [] }), 'provider-model').toString('utf8'))
    const response = Buffer.from(JSON.stringify({ id: 'msg_1', model: 'provider-model' }))

    expect(adapter.clientProtocol).toBe('anthropic-messages')
    expect(adapter.endpointProtocol).toBe('anthropic-messages')
    expect(adapter.requiresResponseConversion).toBe(false)
    expect(request.model).toBe('provider-model')
    expect(request.max_tokens).toBe(4096)
    expect(adapter.createStreamConverter()).toBeNull()
    expect(adapter.convertResponse(response)).toBe(response)
  })

  it('openai-completions adapter converts request and does not append done marker', () => {
    const adapter = new AnthropicMessagesToOpenAiCompletionsAdapter()
    const request = JSON.parse(adapter.prepareRequest(context({ model: 'logical', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], stream: true }), 'provider-model').toString('utf8'))

    expect(adapter.endpointProtocol).toBe('openai-completions')
    expect(adapter.requiresResponseConversion).toBe(true)
    expect(request.model).toBe('provider-model')
    expect(request.stream_options.include_usage).toBe(true)

    const converter = adapter.createStreamConverter()
    expect(converter).not.toBeNull()
    expect(adapter.finishStream(converter!)).toBe('')
  })
})
