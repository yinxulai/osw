import type { Settings, Protocol } from '@common/schemas'

export interface ExportedProvider {
  id: string
  name: string
  timeoutMilliseconds: number
  enabled: boolean
  apiKeyPlaceholder: string
  endpoints: Record<string, string>
}

export interface ExportedLogicalModel {
  id: string
  name: string
  description: string
  enabled: boolean
}

export interface ExportedProviderModel {
  id: string
  providerId: string
  modelName: string
  enabled: boolean
  endpoints: Array<{
    protocol: string
    url: string | null
    enabled: boolean
    conversions: Array<{ clientProtocol: string; enabled: boolean }>
  }>
}

export interface ExportedSchedulingPolicy {
  logicalModelId: string
  providerModelId: string
  strategy: string
  priority: number
  weight: number
  enabled: boolean
}

export interface ExportedConfig {
  schemaVersion: 3
  exportedAt: number
  settings: Partial<Settings>
  providers: ExportedProvider[]
  logicalModels: ExportedLogicalModel[]
  providerModels: ExportedProviderModel[]
  schedulingPolicies: ExportedSchedulingPolicy[]
}

export interface ImportConfigInput {
  config: {
    schemaVersion: 3
    settings: Partial<Settings> & { captureRequestContent?: boolean }
    providers: Array<{
      id?: string
      name: string
      timeoutMilliseconds?: number
      enabled?: boolean
      apiKey?: string
      endpoints?: Partial<Record<Protocol, string>>
    }>
    logicalModels: Array<{ id?: string; name: string; description?: string; enabled?: boolean }>
    providerModels: Array<{
      id?: string
      providerId: string
      modelName: string
      enabled?: boolean
      endpoints?: Array<{
        protocol: Protocol
        url?: string | null
        enabled?: boolean
        conversions?: Array<{ clientProtocol: Protocol; enabled?: boolean }>
      }>
    }>
    schedulingPolicies: Array<{
      logicalModelId: string
      providerModelId: string
      strategy?: string
      priority: number
      weight?: number
      enabled?: boolean
    }>
  }
  mode: 'merge' | 'replace'
}
