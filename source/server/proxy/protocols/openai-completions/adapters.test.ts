import { describe, expect, it } from 'vitest'
import { createRequestContext } from '@server/proxy/request/request-context'
import { OpenAiCompletionsNativeAdapter, OpenAiCompletionsToAnthropicAdapter } from './adapters'

function context(body: Record<string, unknown>) {
  return createRequestContext({
    requestId: 'req_test',
    logicalModelId: 'default',
    clientProtocol: 'openai-completions',
    method: 'POST',
    path: '/v1/chat/completions',
    requestBody: Buffer.from(JSON.stringify(body)),
  })
}

describe('openai-completions adapters', () => {
  it('native adapter rewrites model and keeps response unchanged', () => {
    const adapter = new OpenAiCompletionsNativeAdapter()
    const request = JSON.parse(adapter.prepareRequest(context({ model: 'logical', messages: [], stream: true }), 'provider-model').toString('utf8'))
    const response = Buffer.from(JSON.stringify({ id: 'chatcmpl-1', model: 'provider-model' }))

    expect(adapter.clientProtocol).toBe('openai-completions')
    expect(adapter.endpointProtocol).toBe('openai-completions')
    expect(adapter.requiresResponseConversion).toBe(false)
    expect(request.model).toBe('provider-model')
    expect(request.stream_options.include_usage).toBe(true)
    expect(adapter.createStreamConverter()).toBeNull()
    expect(adapter.convertResponse(response)).toBe(response)
  })

  it('anthropic adapter converts request and emits OpenAI DONE marker', () => {
    const adapter = new OpenAiCompletionsToAnthropicAdapter()
    const request = JSON.parse(adapter.prepareRequest(context({ model: 'logical', messages: [{ role: 'user', content: 'hello' }], stream: true }), 'provider-model').toString('utf8'))

    expect(adapter.endpointProtocol).toBe('anthropic-messages')
    expect(adapter.requiresResponseConversion).toBe(true)
    expect(request.model).toBe('provider-model')
    expect(request.messages[0].content[0].text).toBe('hello')
    expect(request.max_tokens).toBe(4096)

    const converter = adapter.createStreamConverter()
    expect(converter).not.toBeNull()
    expect(adapter.finishStream(converter!)).toBe('data: [DONE]\n\n')
  })
})
