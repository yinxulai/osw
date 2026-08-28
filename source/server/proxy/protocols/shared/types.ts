import type { Protocol } from '@common/schemas'
import type { RequestContext } from '@server/proxy/request/request-context'

export interface StreamConverter {
  push(chunk: string): string
  flush(): string
  finish?(): string
}

export interface ProtocolAdapter {
  readonly clientProtocol: Protocol
  readonly endpointProtocol: Protocol
  readonly requiresResponseConversion: boolean
  prepareRequest(context: RequestContext, providerModelName: string): Buffer
  createStreamConverter(): StreamConverter | null
  finishStream(converter: StreamConverter): string
  convertResponse(body: Buffer): Buffer
}

export interface ProtocolAdapterRegistry {
  resolve(clientProtocol: Protocol, endpointProtocol: Protocol): ProtocolAdapter
}
