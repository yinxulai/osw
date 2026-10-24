import type { AnalyticsRange, AnalyticsSummary, LogEntry, LogScope, ProviderAnalyticsDetail, RequestLogBodies, RequestLogDetail, RequestLogEntry } from '@common/schemas'
import { request } from './client'

export type ListLogsParams = { limit?: number; offset?: number; level?: LogEntry['level']; scope?: LogScope; query?: string }
/**
 * 请求记录的筛选参数。
 *
 * `apiKeyId` 的 `null` 是**有意义的取值**：「只看没带 Key 的请求」。因此它是 `string | null`
 * 而不是 `string`——把 `null` 当成「没筛」在这里正好反了。
 * 协议那一维的服务端字段名是 `clientProtocol`（见 `ListRequestLogsSchema`），与卡片其它地方一致。
 */
export type ListRequestLogsParams = { limit?: number; offset?: number; providerId?: string; providerModelId?: string; logicalModelId?: string; apiKeyId?: string | null; clientProtocol?: string; status?: 'pending' | 'success' | 'failed' | 'cancelled'; createdTimeFrom?: number; createdTimeTo?: number }

export type PruneRequestLogsParams = { requestLogRetentionDays?: number; contentRetentionDays?: number }

/** 观测库在磁盘上的占用。`dataBytes` = 主文件 + 未 checkpoint 的 WAL。 */
export type StorageUsage = { dataBytes: number }

export const storageApi = {
  usage: () => request<StorageUsage>('/storage/usage'),
}

export const logsApi = {
  list: (params: ListLogsParams = {}) => request<{ logs: LogEntry[]; total: number }>('/logs/list', params),
  export: () => request<{ content: string }>('/logs/export'),
  clear: () => request<{ cleared: boolean }>('/logs/clear'),
}

export const requestLogApi = {
  list: (params: ListRequestLogsParams = {}) => request<{ logs: RequestLogEntry[]; total: number }>('/request-log/list', params),
  prune: (params: PruneRequestLogsParams) => request<{ deletedLogs: number; deletedContents: number }>('/request-log/prune', params),
  detail: (id: string) => request<RequestLogDetail>('/request-log/detail', { id }),
  bodies: (id: string) => request<RequestLogBodies>('/request-log/bodies', { id }),
}

export const analyticsApi = {
  summary: (range: AnalyticsRange = '7d') => request<AnalyticsSummary>('/analytics/summary', { range }),
  providerDetail: (providerId: string, range: AnalyticsRange = '7d') => request<ProviderAnalyticsDetail>('/analytics/provider-detail', { providerId, range }),
}
