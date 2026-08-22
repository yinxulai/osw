import type { Protocol, ProviderModelRouteEndpoint } from '@common/schemas'

export interface ProtocolEndpointEntry {
  protocol: Protocol
  enabled: boolean
  overrideUrl: boolean
  endpointUrl: string
  protocolConversionEnabled: boolean
}

export interface ProviderEndpointEntry {
  protocol: Protocol
  enabled: boolean
  url: string
}

export type ProviderEndpoints = Partial<Record<Protocol, string>>

export function getEffectiveEndpointUrl(endpoint: ProviderModelRouteEndpoint): string {
  return endpoint.endpointUrl.trim()
}
