/**
 * 管理 API 客户端
 * 统一 POST 风格，路径格式 /api/resource/action
 */

import type {
  ApiResponse,
  Provider,
  ProviderHealth,
  LogicalModel,
  UpstreamModel,
  ProtocolEndpoint,
  Settings,
  ProxyServerStatus,
  LogEntry,
  RequestLogEntry,
  AnalyticsRange,
  AnalyticsSummary,
} from '@common/schemas'

const API_BASE = import.meta.env.VITE_MANAGEMENT_API_URL ?? 'http://127.0.0.1:9301/api'

type CreateProviderInput = {
  name: string
  apiKey: string
  timeoutMilliseconds?: number
  enabled?: boolean
  endpoints?: Record<string, string>
}

type UpdateProviderInput = Partial<Pick<Provider, 'name' | 'timeoutMilliseconds' | 'enabled'>> & {
  apiKey?: string
  endpoints?: Record<string, string>
}

type CreateLogicalModelInput = {
  name: string
  description?: string
  enabled?: boolean
}

type CreateUpstreamModelInput = {
  logicalModelId: string
  providerId: string
  upstreamModelId: string
  endpoints?: ProtocolEndpoint[]
  priority: number
  enabled?: boolean
}

async function request<T>(path: string, body: unknown = {}): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return {
        success: false,
        errorCode: 'INVALID_RESPONSE',
        errorMessage: `管理服务返回了无法识别的响应（HTTP ${res.status}）`,
      }
    }

    const response = (await res.json()) as ApiResponse<T>
    if (!res.ok && response.success) {
      return {
        success: false,
        errorCode: 'HTTP_ERROR',
        errorMessage: `管理服务请求失败（HTTP ${res.status}）`,
      }
    }
    return response
  } catch (err) {
    return {
      success: false,
      errorCode: 'NETWORK_ERROR',
      errorMessage: (err as Error).message,
    }
  }
}

// ========== Provider ==========

export const providerApi = {
  list: () => request<Provider[]>('/provider/list'),
  get: (id: string) => request<Provider>('/provider/get', { id }),
  create: (data: CreateProviderInput) =>
    request<Provider>('/provider/create', data),
  update: (id: string, updates: UpdateProviderInput) =>
    request<Provider>('/provider/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string }>('/provider/delete', { id }),
  resetHealth: (providerId: string) =>
    request<{ providerId: string }>('/provider/reset-health', { providerId }),
}

// ========== Logical Model ==========

export const logicalModelApi = {
  list: () => request<LogicalModel[]>('/logical-model/list'),
  get: (id: string) => request<LogicalModel>('/logical-model/get', { id }),
  create: (data: CreateLogicalModelInput) =>
    request<LogicalModel>('/logical-model/create', data),
  update: (id: string, updates: Partial<LogicalModel>) =>
    request<LogicalModel>('/logical-model/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string }>('/logical-model/delete', { id }),
}

// ========== Upstream Model ==========

export const upstreamModelApi = {
  list: (logicalModelId: string) =>
    request<UpstreamModel[]>('/upstream-model/list', { logicalModelId }),
  create: (data: CreateUpstreamModelInput) =>
    request<UpstreamModel>('/upstream-model/create', data),
  update: (id: string, updates: Partial<UpstreamModel>) =>
    request<UpstreamModel>('/upstream-model/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string }>('/upstream-model/delete', { id }),
}

// ========== Settings ==========

export const settingsApi = {
  get: () => request<Settings>('/settings/get'),
  update: (updates: Partial<Settings>) =>
    request<Settings>('/settings/update', updates),
}

// ========== Queue ==========

export const queueApi = {
  status: () => request<{ manualModelId: string | null }>('/queue/status'),
  switch: (modelId: string | null) =>
    request<{ modelId: string | null }>('/queue/switch', { modelId }),
}

// ========== Health ==========

export const healthApi = {
  list: () => request<ProviderHealth[]>('/health/list'),
}

// ========== Proxy Lifecycle ==========

export const proxyApi = {
  status: () => request<ProxyServerStatus>('/proxy/status'),
  start: () => request<ProxyServerStatus>('/proxy/start'),
  stop: () => request<ProxyServerStatus>('/proxy/stop'),
  restart: () => request<ProxyServerStatus>('/proxy/restart'),
}

// ========== Logs ==========

export const logsApi = {
  list: (params: { after?: number; limit?: number } = {}) =>
    request<{ logs: LogEntry[]; latestId: number }>('/logs/list', params),
  export: () => request<{ content: string }>('/logs/export', {}),
  clear: () => request<{ cleared: boolean }>('/logs/clear', {}),
}

// ========== Request Logs ==========

export const requestLogApi = {
  list: (limit = 30) => request<{ logs: RequestLogEntry[] }>('/request-log/list', { limit }),
}

// ========== Analytics ==========

export const analyticsApi = {
  summary: (range: AnalyticsRange = '7d') =>
    request<AnalyticsSummary>('/analytics/summary', { range }),
}

// ========== Model Test ==========

export interface ModelTestResult {
  modelId: string
  upstreamModelId: string
  providerId: string
  providerName: string
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
}

export const modelTestApi = {
  run: (logicalModelId: string, protocol: string) =>
    request<{ results: ModelTestResult[] }>('/model-test/run', { logicalModelId, protocol }),
}

// ========== Config Import/Export ==========

export interface ExportedConfig {
  version: 1
  exportedAt: number
  settings: Partial<Settings>
  providers: Array<{
    id?: string
    name: string
    timeoutMilliseconds?: number
    enabled?: boolean
    apiKeyPlaceholder?: string
    apiKey?: string
    endpoints?: Record<string, string>
  }>
  logicalModels: Array<{
    id?: string
    name: string
    description?: string
    enabled?: boolean
  }>
  upstreamModels: Array<{
    id?: string
    logicalModelName?: string
    providerName?: string
    logicalModelId?: string
    providerId?: string
    upstreamModelId: string
    endpoints?: ProtocolEndpoint[]
    priority: number
    enabled?: boolean
  }>
}

export const configApi = {
  export: () => request<{ config: ExportedConfig; content: string }>('/config/export', {}),
  import: (config: ExportedConfig, mode: 'merge' | 'replace' = 'merge') =>
    request<{ imported: { providers: number; logicalModels: number; upstreamModels: number } }>(
      '/config/import',
      { config, mode },
    ),
}
