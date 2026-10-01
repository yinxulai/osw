import type { Protocol, Provider, ProviderEndpoint } from '@common/schemas'
import type { ProviderBundle, ProviderBundleExportRequest } from '@common/provider-bundle'
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
  /** 连软删除的行一起回，用来认出厂告里那些已经删掉的供应商（历史快照仍按 id 引用它们）。 */
  listIncludingDeleted: () => request<Provider[]>('/provider/list', { includeDeleted: true }),
  get: (id: string) => request<Provider>('/provider/get', { id }),
  endpoints: (id: string) => request<ProviderEndpoint[]>('/provider/endpoints', { id }),
  fetchModels: (input: FetchProviderModelsInput) => request<{ models: FetchedProviderModel[]; matchedUrl: string; attempts: { url: string; statusCode?: number; error?: string }[] }>('/provider/fetch-models', input),
  create: (data: CreateProviderInput) => request<Provider>('/provider/create', data),
  update: (id: string, updates: UpdateProviderInput) => request<Provider>('/provider/update', { id, ...updates }),
  reorder: (ids: string[]) => request<Provider[]>('/provider/reorder', { ids }),
  remove: (id: string) => request<{ id: string }>('/provider/delete', { id }),
  resetHealth: (providerId: string) => request<{ providerId: string }>('/provider/reset-health', { providerId }),
}

export interface ProviderBundleExportResult {
  bundle: ProviderBundle
  /** 已经格式化过的 JSON 文本，前端直接落盘，避免两边各自序列化出不一致的内容。 */
  content: string
}

export interface ProviderBundleImportResult {
  imported: { providers: number; models: number }
}

/** 供应商包导入导出：一次只搬供应商（含其下属模型），不带逻辑模型、密钥以外的全局设置。 */
export const providerTransferApi = {
  export: (input: ProviderBundleExportRequest) => request<ProviderBundleExportResult>('/provider/export', input),
  import: (bundle: unknown) => request<ProviderBundleImportResult>('/provider/import', { bundle }),
}
