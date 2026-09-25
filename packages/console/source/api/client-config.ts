import type {
  ClientConfigFileState,
  ClientConfigFillResultItem,
  ClientConfigOverviewItem,
  ClientConfigPreviewResult,
  ClientConfigVersion,
  ClientConfigVersionEntry,
  ClientConfigWriteResult,
} from '@common/client-config'
import { request } from './client'

/**
 * 「按本地服务改写」要写入的值——与 `ClientConfigApplyRequestSchema` 对齐，只差文件定位那两个字段。
 *
 * 不含地址与密钥：它们由服务端按本机监听设置自己填，界面既不展示也不传。
 */
export interface ClientConfigApplyValues {
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

  /**
   * 预览一次「按本地服务改写」：只算不写。
   *
   * 界面在用户改模型 / 换文件时调它，把结果直接摆到下方的内容里；真正落盘仍然只走 `save`
   * ——「改一下就写进磁盘」在配置文件上太危险，中间那一步确认得留给用户。
   */
  preview: (clientKey: string, filePath: string, values: ClientConfigApplyValues) =>
    request<ClientConfigPreviewResult>('/client-config/preview', { clientKey, filePath, ...values }),

  save: (clientKey: string, filePath: string, content: string, note?: string) =>
    request<ClientConfigWriteResult>('/client-config/save', { clientKey, filePath, content, note }),

  /** 版本列表：每条都带「与当前文件相比改了哪几行」，供菜单直接展示差异。 */
  listVersions: (clientKey: string, filePath: string) =>
    request<ClientConfigVersionEntry[]>('/client-config/versions', { clientKey, filePath }),

  // 版本可能已经被清理掉，此时服务端回 `null`——「这个版本不在了」是正常状态，不是错误。
  getVersion: (id: string) => request<ClientConfigVersion | null>('/client-config/version/get', { id }),

  restoreVersion: (clientKey: string, filePath: string, id: string) =>
    request<ClientConfigWriteResult>('/client-config/version/restore', { clientKey, filePath, id }),
}
