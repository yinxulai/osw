import type { HealthSnapshot, OutboundProxyMode, ProxyServerStatus, Settings } from '@common/schemas'
import { request } from './client'

export const settingsApi = {
  get: () => request<Settings>('/settings/get'),
  update: (updates: Partial<Settings>) => request<Settings>('/settings/update', updates),
}

export interface OutboundProxyTestInput {
  mode: OutboundProxyMode
  proxyUrl: string
  bypass: string
  targetUrl: string
}

export interface OutboundProxyTestResult {
  targetUrl: string
  statusCode: number
  durationMilliseconds: number
}

export const outboundProxyApi = {
  test: (input: OutboundProxyTestInput, signal?: AbortSignal) => request<OutboundProxyTestResult>('/outbound-proxy/test', input, { signal }),
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
