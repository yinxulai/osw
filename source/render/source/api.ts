/**
 * 管理 API 客户端
 * 统一 POST 风格，路径格式 /api/resource/action
 */

const API_BASE = import.meta.env.VITE_MANAGEMENT_API_URL ?? 'http://127.0.0.1:9301/api'

export interface ApiError {
  success: false
  errorCode: string
  errorMessage: string
}

export interface ApiSuccess<T> {
  success: true
  data: T
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

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

type CreateBindingInput = {
  logicalModelId: string
  providerId: string
  protocol: string
  upstreamUrl?: string
  upstreamModelId: string
  priority: number
  enabled?: boolean
  customAuthHeader?: string | null
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

import type { Provider, ProviderHealth, LogicalModel, ModelBinding, Settings } from '@common/schemas'

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

// ========== Model Binding ==========

export const bindingApi = {
  list: (logicalModelId: string) =>
    request<ModelBinding[]>('/binding/list', { logicalModelId }),
  create: (data: CreateBindingInput) => request<ModelBinding>('/binding/create', data),
  update: (id: string, updates: Partial<ModelBinding>) =>
    request<ModelBinding>('/binding/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string }>('/binding/delete', { id }),
}

// ========== Settings ==========

export const settingsApi = {
  get: () => request<Settings>('/settings/get'),
  update: (updates: Partial<Settings>) =>
    request<Settings>('/settings/update', updates),
}

// ========== Queue ==========

export const queueApi = {
  status: () => request<{ manualBindingId: string | null }>('/queue/status'),
  switch: (bindingId: string | null) =>
    request<{ bindingId: string | null }>('/queue/switch', { bindingId }),
}

// ========== Health ==========

export const healthApi = {
  list: () => request<ProviderHealth[]>('/health/list'),
}

// ========== Proxy Lifecycle ==========

export interface ProxyServerStatus {
  running: boolean
  host: string
  port: number
}

export const proxyApi = {
  status: () => request<ProxyServerStatus>('/proxy/status'),
  start: () => request<ProxyServerStatus>('/proxy/start'),
  stop: () => request<ProxyServerStatus>('/proxy/stop'),
  restart: () => request<ProxyServerStatus>('/proxy/restart'),
}
