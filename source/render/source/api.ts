/**
 * 管理 API 客户端
 * 统一 POST 风格，路径格式 /api/resource/action
 */

import type {
  ApiResponse,
  Provider,
  ProviderEndpoint,
  ProviderHealth,
  LogicalModel,
  ProviderModel,
  ProviderModelRoute,
  SchedulingPolicy,
  ProviderModelRouteEndpoint,
  Protocol,
  Settings,
  ProxyServerStatus,
  LogEntry,
  RequestLogEntry,
  AnalyticsRange,
  AnalyticsSummary,
} from '@common/schemas'
import { getRuntimeProfile } from '@common/runtime-profile'

const API_BASE = getRuntimeProfile(import.meta.env.DEV ? 'development' : 'production').managementApiUrl

type CreateProviderInput = {
  name: string
  apiKey?: string
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

export type ListLogsParams = {
  after?: number
  limit?: number
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

export interface FetchedProviderModel {
  id: string
  ownedBy: string | null
  displayName: string | null
  createdTime: number | null
}

export interface FetchProviderModelsInput {
  protocol: Protocol
  providerId?: string
  baseUrl?: string
  apiKey?: string
}

export const providerApi = {
  list: () => request<Provider[]>('/provider/list'),
  get: (id: string) => request<Provider>('/provider/get', { id }),
  endpoints: (id: string) => request<ProviderEndpoint[]>('/provider/endpoints', { id }),
  fetchModels: (input: FetchProviderModelsInput) =>
    request<{ models: FetchedProviderModel[]; matchedUrl: string; attempts: { url: string; statusCode?: number; error?: string }[] }>('/provider/fetch-models', input),
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

type ProviderModelEndpointView = {
  id: string
  url: string | null
  enabled: boolean
  protocol: Protocol
  providerModelId: string
  providerEndpointId: string
  conversions: Array<{ id: string; clientProtocol: Protocol; enabled: boolean }>
}

type ProviderModelView = ProviderModel & { endpoints: ProviderModelEndpointView[] }

type ProviderModelUpdateInput = {
  logicalModelId?: string
  modelName?: string
  enabled?: boolean
  priority?: number
  endpoints?: ProviderModelRouteEndpoint[]
}

type ProviderModelCreateInput = {
  providerId: string
  modelName: string
  logicalModelId?: string
  priority?: number
  enabled?: boolean
  endpoints?: ProviderModelRouteEndpoint[]
}

export const providerModelApi = {
  list: () => request<ProviderModelView[]>('/provider-model/list', {}),
  get: (id: string) => request<ProviderModelView>('/provider-model/get', { id }),
  create: (data: ProviderModelCreateInput) => request<ProviderModelView>('/provider-model/create', data),
  update: (id: string, updates: ProviderModelUpdateInput) =>
    request<ProviderModelView>('/provider-model/update', { id, ...updates }),
  queue: () => request<ProviderModelRoute[]>('/provider-model/queue', {}),
  remove: (id: string) => request<{ id: string }>('/provider-model/delete', { id }),
}

export const schedulingPolicyApi = {
  list: (logicalModelId?: string) => request<SchedulingPolicy[]>('/scheduling-policy/list', logicalModelId ? { logicalModelId } : {}),
  update: (data: SchedulingPolicyInput) => request<SchedulingPolicy>('/scheduling-policy/update', data),
  remove: (logicalModelId: string, providerModelId: string) => request<{ logicalModelId: string; providerModelId: string }>('/scheduling-policy/delete', { logicalModelId, providerModelId }),
}

type SchedulingPolicyInput = {
  logicalModelId: string
  providerModelId: string
  strategy?: string
  priority?: number
  weight?: number
  enabled?: boolean
  failoverEnabled?: boolean
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
  list: (params: ListLogsParams = {}) =>
    request<{ logs: LogEntry[]; latestId: number }>('/logs/list', params),
  export: () => request<{ content: string }>('/logs/export', {}),
  clear: () => request<{ cleared: boolean }>('/logs/clear', {}),
}

// ========== Request Logs ==========

export type ListRequestLogsParams = {
  limit?: number
  offset?: number
  providerId?: string
  protocol?: string
  status?: 'pending' | 'success' | 'failed' | 'cancelled'
}

export const requestLogApi = {
  list: (params: ListRequestLogsParams = {}) =>
    request<{ logs: RequestLogEntry[]; total: number }>('/request-log/list', params),
  prune: (retentionDays: number) =>
    request<{ deleted: number }>('/request-log/prune', { retentionDays }),
}

// ========== Analytics ==========

export const analyticsApi = {
  summary: (range: AnalyticsRange = '7d') =>
    request<AnalyticsSummary>('/analytics/summary', { range }),
}

// ========== Model Test ==========

export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
}

export interface ModelTestFilters {
  providerIds?: string[]
  modelIds?: string[]
}

export const modelTestApi = {
  run: (protocol: string, filters: ModelTestFilters = {}) =>
    request<{ results: ModelTestResult[] }>('/model-test/run', { protocol, ...filters }),
}

// ========== Config Import/Export ==========

export interface ExportedConfig {
  version: 3
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
  providerModels?: Array<{
    id?: string
    providerId: string
    modelName: string
    enabled?: boolean
    endpoints?: Array<{
      protocol: string
      url?: string | null
      enabled?: boolean
      conversions?: Array<{ clientProtocol: string; enabled?: boolean }>
    }>
  }>
  schedulingPolicies?: Array<{
    logicalModelId: string
    providerModelId: string
    strategy?: string
    priority: number
    weight?: number
    enabled?: boolean
    failoverEnabled?: boolean
  }>
}

export const configApi = {
  export: () => request<{ config: ExportedConfig; content: string }>('/config/export', {}),
  import: (config: ExportedConfig, mode: 'merge' | 'replace' = 'merge') =>
    request<{ imported: { providers: number; logicalModels: number; providerModels: number } }>(
      '/config/import',
      { config, mode },
    ),
  seedDevelopment: () => request<{ inserted: boolean }>('/config/seed-development', {}),
}
