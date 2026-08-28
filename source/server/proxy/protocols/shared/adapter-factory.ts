import type { Protocol } from '@common/schemas'
import { rewriteRequestModel, injectUsageParams } from '@server/proxy/request/request'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { ProtocolAdapter, StreamConverter } from './types'
import { convertRequestBody } from './request-conversion'
import { convertResponseBody, createSseConverter } from './response-conversion'

class RegisteredProtocolAdapter implements ProtocolAdapter {
  readonly requiresResponseConversion: boolean

  constructor(
    readonly clientProtocol: Protocol,
    readonly endpointProtocol: Protocol,
    private readonly prepare: (context: RequestContext, providerModelName: string) => Buffer,
  ) {
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
    const tail = converter.push('') + converter.flush() + (converter.finish?.() ?? '')
    return this.clientProtocol === 'openai-completions'
      ? `${tail}data: [DONE]\n\n`
      : tail
  }

  convertResponse(body: Buffer): Buffer {
    return convertResponseBody(this.clientProtocol, this.endpointProtocol, body)
  }
}

export function createAdapter(clientProtocol: Protocol, endpointProtocol: Protocol): ProtocolAdapter {
  return new RegisteredProtocolAdapter(clientProtocol, endpointProtocol, (context, providerModelName) => {
    const converted = clientProtocol === endpointProtocol
      ? rewriteRequestModel(context.requestBody, providerModelName)
      : convertRequestBody(clientProtocol, endpointProtocol, context.requestBody, providerModelName)
    return injectUsageParams(converted, endpointProtocol)
  })
}

export function registerAdapter(map: Map<string, ProtocolAdapter>, clientProtocol: Protocol, endpointProtocol: Protocol): void {
  map.set(`${clientProtocol}:${endpointProtocol}`, createAdapter(clientProtocol, endpointProtocol))
}
