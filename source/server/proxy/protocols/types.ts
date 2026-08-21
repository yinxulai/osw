import type { Protocol } from '@common/schemas'
import type { RequestContext } from '../request-context'

export interface StreamConverter {
  push(chunk: string): string
  flush(): string
}

export interface ProtocolAdapter {
  readonly clientProtocol: Protocol
  readonly endpointProtocol: Protocol
  prepareRequest(context: RequestContext, providerModelName: string): Buffer
  createStreamConverter(): StreamConverter | null
  convertResponse(body: Buffer): Buffer
}

export interface ProtocolAdapterRegistry {
  resolve(clientProtocol: Protocol, endpointProtocol: Protocol): ProtocolAdapter
}
