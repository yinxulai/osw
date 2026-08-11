/**
 * 管理 API 客户端
 * 统一 POST 风格，路径格式 /api/resource/action
 */

const API_BASE = '/api'

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

async function request<T>(path: string, body: unknown = {}): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return (await res.json()) as ApiResponse<T>
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
  create: (data: { name: string; apiKeyReference: string; timeoutMilliseconds?: number; enabled?: boolean }) =>
    request<Provider>('/provider/create', data),
  update: (id: string, updates: Partial<Provider>) =>
    request<Provider>('/provider/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string }>('/provider/delete', { id }),
  resetHealth: (providerId: string) =>
    request<{ providerId: string }>('/provider/reset-health', { providerId }),
}

// ========== Logical Model ==========

export const logicalModelApi = {
  list: () => request<LogicalModel[]>('/logical-model/list'),
  get: (id: string) => request<LogicalModel>('/logical-model/get', { id }),
  create: (data: { name: string; description?: string; enabled?: boolean }) =>
    request<LogicalModel>('/logical-model/create', data),
  update: (id: string, updates: Partial<LogicalModel>) =>
    request<LogicalModel>('/logical-model/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string }>('/logical-model/delete', { id }),
}

// ========== Model Binding ==========

export const bindingApi = {
  list: (logicalModelId: string) =>
    request<ModelBinding[]>('/binding/list', { logicalModelId }),
  create: (data: {
    logicalModelId: string
    providerId: string
    protocol: string
    upstreamUrl: string
    upstreamModelId: string
    priority: number
    enabled?: boolean
    customAuthHeader?: string | null
  }) => request<ModelBinding>('/binding/create', data),
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
