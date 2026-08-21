import type { Protocol } from '@common/schemas'
import { convertRequestBody } from '../conversion'
import { convertResponseBody, createSseConverter } from '../conversion-response'
import { injectUsageParams, rewriteRequestModel } from '../request'
import type { RequestContext } from '../request-context'
import type { ProtocolAdapter, ProtocolAdapterRegistry, StreamConverter } from './types'

class RegisteredProtocolAdapter implements ProtocolAdapter {
  readonly requiresResponseConversion: boolean

  constructor(readonly clientProtocol: Protocol, readonly endpointProtocol: Protocol, private readonly prepare: (context: RequestContext, providerModelName: string) => Buffer) {
    this.requiresResponseConversion = clientProtocol !== endpointProtocol
  }

  prepareRequest(context: RequestContext, providerModelName: string): Buffer {
    return this.prepare(context, providerModelName)
  }

  createStreamConverter(): StreamConverter | null {
    return this.clientProtocol === this.endpointProtocol
      ? null
      : createSseConverter(this.clientProtocol, this.endpointProtocol)
  }

  finishStream(converter: StreamConverter): string {
    const tail = converter.push('') + converter.flush()
    return this.clientProtocol === 'openai-completions'
      ? `${tail}data: [DONE]\n\n`
      : tail
  }

  convertResponse(body: Buffer): Buffer {
    return convertResponseBody(this.clientProtocol, this.endpointProtocol, body)
  }
}

function createAdapter(clientProtocol: Protocol, endpointProtocol: Protocol): ProtocolAdapter {
  return new RegisteredProtocolAdapter(clientProtocol, endpointProtocol, (context, providerModelName) => {
    const converted = clientProtocol === endpointProtocol
      ? rewriteRequestModel(context.requestBody, providerModelName)
      : convertRequestBody(clientProtocol, endpointProtocol, context.requestBody, providerModelName)
    return injectUsageParams(converted, endpointProtocol)
  })
}

const adapters = new Map<string, ProtocolAdapter>([
  ['openai-completions:openai-completions', createAdapter('openai-completions', 'openai-completions')],
  ['openai-responses:openai-responses', createAdapter('openai-responses', 'openai-responses')],
  ['anthropic-messages:anthropic-messages', createAdapter('anthropic-messages', 'anthropic-messages')],
  ['anthropic-messages:openai-completions', createAdapter('anthropic-messages', 'openai-completions')],
  ['openai-responses:openai-completions', createAdapter('openai-responses', 'openai-completions')],
  ['openai-completions:anthropic-messages', createAdapter('openai-completions', 'anthropic-messages')],
])

export const protocolAdapters: ProtocolAdapterRegistry = {
  resolve(clientProtocol, endpointProtocol) {
    const adapter = adapters.get(`${clientProtocol}:${endpointProtocol}`)
    if (!adapter) throw new Error(`不支持的协议转换方向: ${clientProtocol} -> ${endpointProtocol}`)
    return adapter
  },
}
