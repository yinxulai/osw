import type { HealthSnapshot, OutboundProxyMode, ProxyServerStatus, Settings } from '@common/schemas'
import type { TelemetryEventInput } from '@common/telemetry'
import { request } from './client'

export const settingsApi = {
  get: () => request<Settings>('/settings/get'),
  update: (updates: Partial<Settings>) => request<Settings>('/settings/update', updates),
}

export const telemetryApi = {
  /**
   * 把界面侧发生的事交给 core 上报（队列在 core，界面不持有第二套）。
   *
   * 不返回也不抛：上报失败**不该**让触发它的那次操作表现成失败，所以这里连 `catch` 都不需要——
   * `request` 自己就把网络错误转成了 `{ success: false }`，没有任何东西会拒绝。
   */
  report: (event: TelemetryEventInput) => {
    void request<{ accepted: boolean }>('/telemetry/report', event)
  },
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

export const logicalModelRoutingApi = {
  status: (logicalModelId: string) => request<{ logicalModelId: string; manualModelId: string | null }>('/logical-model/status', { logicalModelId }),
  switch: (logicalModelId: string, modelId: string | null) => request<{ logicalModelId: string; modelId: string | null }>('/logical-model/switch', { logicalModelId, modelId }),
}

export const healthApi = { list: () => request<HealthSnapshot>('/health/list') }

export const proxyApi = {
  status: () => request<ProxyServerStatus>('/proxy/status'),
  start: () => request<ProxyServerStatus>('/proxy/start'),
  stop: () => request<ProxyServerStatus>('/proxy/stop'),
  restart: () => request<ProxyServerStatus>('/proxy/restart'),
}
