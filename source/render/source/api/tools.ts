import type { Protocol } from '@common/schemas'
import type { ConfigDocument } from '@common/config-schemas'
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
  run: (protocol: Protocol, filters: ModelTestFilters = {}) => request<{ results: ModelTestResult[] }>('/model-test/run', { protocol, ...filters }),
}

export const configApi = {
  export: () => request<{ config: ConfigDocument; content: string }>('/config/export'),
  import: (config: ConfigDocument, mode: 'merge' | 'replace' = 'merge') => request<{ imported: { providers: number; logicalModels: number; providerModels: number } }>('/config/import', { config, mode }),
  seedDevelopment: () => request<{ inserted: boolean }>('/config/seed-development'),
}
