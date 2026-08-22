import type { Settings } from '@common/schemas'
import { request } from './client'

export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  success: boolean
  statusCode?: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
  durationMilliseconds: number
}

export interface ModelTestFilters { providerIds?: string[]; modelIds?: string[] }

export const modelTestApi = {
  run: (protocol: string, filters: ModelTestFilters = {}) => request<{ results: ModelTestResult[] }>('/model-test/run', { protocol, ...filters }),
}

export interface ExportedConfig {
  schemaVersion: 3
  exportedAt: number
  settings: Partial<Settings>
  providers: Array<{ id?: string; name: string; timeoutMilliseconds?: number; enabled?: boolean; apiKeyPlaceholder?: string; apiKey?: string; endpoints?: Record<string, string> }>
  logicalModels: Array<{ id?: string; name: string; description?: string; enabled?: boolean }>
  providerModels?: Array<{ id?: string; providerId: string; modelName: string; enabled?: boolean; endpoints?: Array<{ protocol: string; url?: string | null; enabled?: boolean; conversions?: Array<{ clientProtocol: string; enabled?: boolean }> }> }>
  schedulingPolicies?: Array<{ logicalModelId: string; providerModelId: string; strategy?: string; priority: number; weight?: number; enabled?: boolean }>
}

export const configApi = {
  export: () => request<{ config: ExportedConfig; content: string }>('/config/export'),
  import: (config: ExportedConfig, mode: 'merge' | 'replace' = 'merge') => request<{ imported: { providers: number; logicalModels: number; providerModels: number } }>('/config/import', { config, mode }),
  seedDevelopment: () => request<{ inserted: boolean }>('/config/seed-development'),
}
