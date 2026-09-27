import type { AnalyticsRange, AnalyticsSummary, LogEntry, ProviderAnalyticsDetail, RequestLogBodies, RequestLogDetail, RequestLogEntry } from '@common/schemas'
import { request } from './client'

export type ListLogsParams = { limit?: number; offset?: number; level?: LogEntry['level']; query?: string }
export type ListRequestLogsParams = { limit?: number; offset?: number; providerId?: string; providerModelId?: string; logicalModelId?: string; protocol?: string; status?: 'pending' | 'success' | 'failed' | 'cancelled'; createdTimeFrom?: number; createdTimeTo?: number }

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
