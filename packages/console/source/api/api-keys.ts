import type { ApiKey, CreatedApiKey } from '@common/schemas'
import { request } from './client'

/**
 * 客户端 API Key 的管理面。
 *
 * 与供应商一样是普通的管理 API：全部 `POST` + JSON，失败走 `errorCode → errors.*`。
 * 唯一特殊之处是**明文只在创建与轮换的响应里出现一次**（`CreatedApiKey.secret`），
 * `list`/`get`/`update` 回的都是不含明文的元数据（`ApiKey`）——客户端拿不到第二次。
 */
export type CreateApiKeyInput = { name: string; enabled?: boolean; expiresTime?: number | null }
export type UpdateApiKeyInput = Partial<Pick<ApiKey, 'name' | 'enabled' | 'expiresTime'>>

export const apiKeyApi = {
  list: () => request<ApiKey[]>('/api-key/list'),
  create: (input: CreateApiKeyInput) => request<CreatedApiKey>('/api-key/create', input),
  update: (id: string, updates: UpdateApiKeyInput) => request<ApiKey>('/api-key/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string }>('/api-key/delete', { id }),
  rotate: (id: string) => request<CreatedApiKey>('/api-key/rotate', { id }),
}
