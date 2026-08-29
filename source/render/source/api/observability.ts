import type { AnalyticsRange, AnalyticsSummary, LogEntry, RequestLogDetail, RequestLogEntry } from '@common/schemas'
import { request } from './client'

export type ListLogsParams = { after?: number; limit?: number }
export type ListRequestLogsParams = { limit?: number; offset?: number; providerId?: string; providerModelId?: string; logicalModelId?: string; protocol?: string; status?: 'pending' | 'success' | 'failed' | 'cancelled'; createdTimeFrom?: number; createdTimeTo?: number }

export const logsApi = {
  list: (params: ListLogsParams = {}) => request<{ logs: LogEntry[]; latestId: number }>('/logs/list', params),
  export: () => request<{ content: string }>('/logs/export'),
  clear: () => request<{ cleared: boolean }>('/logs/clear'),
}

export const requestLogApi = {
  list: (params: ListRequestLogsParams = {}) => request<{ logs: RequestLogEntry[]; total: number }>('/request-log/list', params),
  detail: (id: string) => request<RequestLogDetail>('/request-log/detail', { id }),
  prune: (retentionDays: number) => request<{ deleted: number }>('/request-log/prune', { retentionDays }),
}

export const analyticsApi = {
  summary: (range: AnalyticsRange = '7d') => request<AnalyticsSummary>('/analytics/summary', { range }),
}
