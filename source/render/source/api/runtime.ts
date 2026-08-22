import type { HealthSnapshot, ProxyServerStatus, Settings } from '@common/schemas'
import { request } from './client'

export const settingsApi = {
  get: () => request<Settings>('/settings/get'),
  update: (updates: Partial<Settings>) => request<Settings>('/settings/update', updates),
}

export const queueApi = {
  status: (logicalModelId: string) => request<{ logicalModelId: string; manualModelId: string | null }>('/queue/status', { logicalModelId }),
  switch: (logicalModelId: string, modelId: string | null) => request<{ logicalModelId: string; modelId: string | null }>('/queue/switch', { logicalModelId, modelId }),
}

export const healthApi = { list: () => request<HealthSnapshot>('/health/list') }

export const proxyApi = {
  status: () => request<ProxyServerStatus>('/proxy/status'),
  start: () => request<ProxyServerStatus>('/proxy/start'),
  stop: () => request<ProxyServerStatus>('/proxy/stop'),
  restart: () => request<ProxyServerStatus>('/proxy/restart'),
}
