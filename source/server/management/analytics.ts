import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'
import { AnalyticsRangeSchema, type AnalyticsRange, type AnalyticsSummary } from '@common/schemas'
import {
  getStatsSummary,
  getRequestTrend,
  getProviderStats,
  getModelStats,
  getLatencyDistribution,
  getFailureReasons,
} from '../database/store'

export const analyticsRoutes: Record<string, ManagementHandler> = {
  '/api/analytics/summary': handleAnalyticsSummary,
}

const AnalyticsSummaryRequestSchema = z.object({
  range: AnalyticsRangeSchema.optional().default('7d'),
})

function resolveSinceMs(range: AnalyticsRange): number {
  const now = Date.now()
  switch (range) {
    case 'today': {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000
    case '30d':
      return now - 30 * 24 * 60 * 60 * 1000
  }
}

function resolveDays(range: AnalyticsRange): number {
  switch (range) {
    case 'today': return 1
    case '7d': return 7
    case '30d': return 30
  }
}

async function handleAnalyticsSummary(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { range } = AnalyticsSummaryRequestSchema.parse(body ?? {})
  const sinceMs = resolveSinceMs(range)
  const days = resolveDays(range)

  const [summary, trend, providerStats, modelStats, latencyDistribution, failureReasons] = await Promise.all([
    getStatsSummary(sinceMs),
    getRequestTrend(sinceMs, days),
    getProviderStats(sinceMs),
    getModelStats(sinceMs, 10),
    getLatencyDistribution(sinceMs),
    getFailureReasons(sinceMs),
  ])

  const totalRequests = summary.totalRequests
  const totalFailures = summary.failedCount

  const providerStatsWithPercent = providerStats.map(p => ({
    ...p,
    percent: totalRequests > 0 ? Math.round((p.requests / totalRequests) * 100) : 0,
  }))

  const modelStatsWithRate = modelStats.map(m => ({
    providerModelName: m.providerModelName,
    providerId: m.providerId,
    providerName: m.providerName,
    requests: m.requests,
    success: m.success,
    avgLatencyMs: m.avgLatencyMs,
    avgTtftMs: m.avgTtftMs,
    successRate: m.requests > 0 ? m.success / m.requests : 0,
    errorRate: m.requests > 0 ? (m.requests - m.success) / m.requests : 0,
    cacheHitRate: m.cacheSamples > 0 ? m.cacheHits / m.cacheSamples : null,
  }))

  const latencyWithPercent = latencyDistribution.map(l => ({
    ...l,
    percent: totalRequests > 0 ? Math.round((l.count / totalRequests) * 100) : 0,
  }))

  const failureWithPercent = failureReasons.map(f => ({
    ...f,
    percent: totalFailures > 0 ? Math.round((f.count / totalFailures) * 100) : 0,
  }))

  const response: AnalyticsSummary = {
    summary,
    trend,
    providerStats: providerStatsWithPercent,
    modelStats: modelStatsWithRate,
    latencyDistribution: latencyWithPercent,
    failureReasons: failureWithPercent,
  }

  sendSuccess(res, response)
}
