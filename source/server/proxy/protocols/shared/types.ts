import type { Protocol } from '@common/schemas'
import type { RequestContext } from '@server/proxy/request/request-context'

export interface StreamConverter {
  push(chunk: string): string
  flush(): string
  finish?(): string
}

interface ProtocolAdapterBase {
  readonly clientProtocol: Protocol
  readonly endpointProtocol: Protocol
  prepareRequest(context: RequestContext, providerModelName: string): Buffer
}

export interface NativeProtocolAdapter extends ProtocolAdapterBase {
  readonly kind: 'native'
  readonly requiresResponseConversion: false
  createStreamConverter(): null
  finishStream(converter: StreamConverter): string
  convertResponse(body: Buffer): Buffer
}

export interface ProtocolConversionAdapter extends ProtocolAdapterBase {
  readonly kind: 'conversion'
  readonly requiresResponseConversion: true
  createStreamConverter(): StreamConverter
  finishStream(converter: StreamConverter): string
  convertResponse(body: Buffer): Buffer
}

export type ProtocolAdapter = NativeProtocolAdapter | ProtocolConversionAdapter

export interface ProtocolAdapterRegistry {
  resolve(clientProtocol: Protocol, endpointProtocol: Protocol): ProtocolAdapter
}
