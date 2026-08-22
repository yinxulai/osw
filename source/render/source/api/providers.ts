import type { Protocol, Provider, ProviderEndpoint } from '@common/schemas'
import { request } from './client'

type CreateProviderInput = { name: string; apiKey?: string; timeoutMilliseconds?: number; enabled?: boolean; endpoints?: Record<string, string> }
type UpdateProviderInput = Partial<Pick<Provider, 'name' | 'timeoutMilliseconds' | 'enabled'>> & { apiKey?: string; endpoints?: Record<string, string> }

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
  fetchModels: (input: FetchProviderModelsInput) => request<{ models: FetchedProviderModel[]; matchedUrl: string; attempts: { url: string; statusCode?: number; error?: string }[] }>('/provider/fetch-models', input),
  create: (data: CreateProviderInput) => request<Provider>('/provider/create', data),
  update: (id: string, updates: UpdateProviderInput) => request<Provider>('/provider/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string }>('/provider/delete', { id }),
  resetHealth: (providerId: string) => request<{ providerId: string }>('/provider/reset-health', { providerId }),
}
