import type {
  ClientConfigApplyResult,
  ClientConfigFileState,
  ClientConfigFillResultItem,
  ClientConfigOverviewItem,
  ClientConfigVersion,
  ClientConfigVersionSummary,
  ClientConfigWriteResult,
} from '@common/client-config'
import { request } from './client'

/**
 * 自动填充要写入的值——与 `ClientConfigApplyRequestSchema` 对齐，只差文件定位那两个字段。
 */
export interface ClientConfigApplyValues {
  baseUrl: string
  apiKey: string
  model: string
  smallModel?: string
}

/**
 * 客户端配置文件读写。
 *
 * 每个入口都同时带上 `clientKey` 与 `filePath`：服务端以「注册表里声明过的那一条」
 * 作为可写白名单，界面上任何一步都不该有「只凭一个 id 就能写任意文件」的调用。
 */
export const clientConfigApi = {
  getFile: (clientKey: string, filePath: string) => request<ClientConfigFileState>('/client-config/get', { clientKey, filePath }),

  /** 列表页一屏：每个客户端的状态与最近更新时间。 */
  listOverview: () => request<ClientConfigOverviewItem[]>('/client-config/overview', {}),

  /** 一键生效。不带 `clientKey` 是全部客户端，带上就是列表行内那一颗。 */
  fill: (clientKey?: string) => request<ClientConfigFillResultItem[]>('/client-config/fill', { clientKey }),

  apply: (clientKey: string, filePath: string, values: ClientConfigApplyValues) =>
    request<ClientConfigApplyResult>('/client-config/apply', { clientKey, filePath, ...values }),

  save: (clientKey: string, filePath: string, content: string, note?: string) =>
    request<ClientConfigWriteResult>('/client-config/save', { clientKey, filePath, content, note }),

  listVersions: (clientKey: string, filePath: string) =>
    request<ClientConfigVersionSummary[]>('/client-config/versions', { clientKey, filePath }),

  // 版本可能已经被清理掉，此时服务端回 `null`——「这个版本不在了」是正常状态，不是错误。
  getVersion: (id: string) => request<ClientConfigVersion | null>('/client-config/version/get', { id }),

  restoreVersion: (clientKey: string, filePath: string, id: string) =>
    request<ClientConfigWriteResult>('/client-config/version/restore', { clientKey, filePath, id }),
}
