import { request } from './client'

export interface FreeModelSyncState {
  time: number
  status: 'success' | 'error'
  error: string | null
  added: number
  removed: number
  total: number
}

export interface FreeModelSourceInfo {
  key: string
  name: string
  description: string
  presetKey: string
  providerName: string
  requiresApiKey: boolean
  apiKeyPlaceholder: string | null
  apiKeyHelpText: string | null
  enabled: boolean
  providerId: string | null
  providerEnabled: boolean
  modelCount: number
  syncState: FreeModelSyncState | null
}

export interface FreeModelSyncResult {
  providerId: string
  added: number
  removed: number
  total: number
}

export const freeModelApi = {
  sources: () => request<{ sources: FreeModelSourceInfo[] }>('/free-model/sources'),
  enable: (sourceKey: string, apiKey?: string) =>
    request<FreeModelSyncResult>('/free-model/enable', { sourceKey, ...(apiKey ? { apiKey } : {}) }),
  disable: (sourceKey: string) => request<{ sourceKey: string }>('/free-model/disable', { sourceKey }),
  sync: (sourceKey: string) => request<FreeModelSyncResult>('/free-model/sync', { sourceKey }),
  updateKey: (sourceKey: string, apiKey: string) =>
    request<FreeModelSyncResult>('/free-model/update-key', { sourceKey, apiKey }),
}
