import { describe, expect, it } from 'vitest'
import { createRequestContext } from '@server/proxy/request/request-context'
import { OpenAiResponsesNativeAdapter, OpenAiResponsesToOpenAiCompletionsAdapter } from './adapters'

function context(body: Record<string, unknown>) {
  return createRequestContext({
    requestId: 'req_test',
    logicalModelId: 'default',
    clientProtocol: 'openai-responses',
    method: 'POST',
    path: '/v1/responses',
    requestBody: Buffer.from(JSON.stringify(body)),
  })
}

describe('openai-responses adapters', () => {
  it('native adapter rewrites model and keeps response unchanged', () => {
    const adapter = new OpenAiResponsesNativeAdapter()
    const request = JSON.parse(adapter.prepareRequest(context({ model: 'logical', input: 'hello', stream: true }), 'provider-model').toString('utf8'))
    const response = Buffer.from(JSON.stringify({ id: 'resp_1', model: 'provider-model' }))

    expect(adapter.clientProtocol).toBe('openai-responses')
    expect(adapter.endpointProtocol).toBe('openai-responses')
    expect(adapter.requiresResponseConversion).toBe(false)
    expect(request.model).toBe('provider-model')
    expect(request.stream_options.include_usage).toBe(true)
    expect(adapter.createStreamConverter()).toBeNull()
    expect(adapter.convertResponse(response)).toBe(response)
  })

  it('openai-completions adapter converts request and does not append done marker', () => {
    const adapter = new OpenAiResponsesToOpenAiCompletionsAdapter()
    const request = JSON.parse(adapter.prepareRequest(context({ model: 'logical', input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }], stream: true }), 'provider-model').toString('utf8'))

    expect(adapter.endpointProtocol).toBe('openai-completions')
    expect(adapter.requiresResponseConversion).toBe(true)
    expect(request.model).toBe('provider-model')
    expect(request.stream_options.include_usage).toBe(true)

    const converter = adapter.createStreamConverter()
    expect(converter).not.toBeNull()
    expect(adapter.finishStream(converter!)).toBe('')
  })
})
