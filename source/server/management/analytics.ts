import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'
import { AnalyticsRangeSchema, type AnalyticsRange, type AnalyticsSummary } from '@common/schemas'
import {
  getStatsSummary,
  getRequestTrend,
  getIntradayTrend,
  getProviderStats,
  getModelStats,
  getLatencyDistribution,
  getFailureReasons,
} from '../database/analytics-store'
import { HttpRouter } from '../http-router'

export const analyticsRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/analytics/summary', handleAnalyticsSummary)

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

async function handleAnalyticsSummary(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { range } = AnalyticsSummaryRequestSchema.parse(body ?? {})
  const sinceMs = resolveSinceMs(range)

  const trend = range === 'today' ? await getIntradayTrend(sinceMs) : await getRequestTrend(sinceMs)

  const [summary, providerStats, modelStats, latencyDistribution, failureReasons] = await Promise.all([
    getStatsSummary(sinceMs),
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
    avgTps: m.successGenerationDurationMs > 0 && m.outputTokens > 0 ? m.outputTokens / (m.successGenerationDurationMs / 1000) : null,
    successRate: m.requests > 0 ? m.success / m.requests : 0,
    cacheHitRate: m.inputTokens > 0 ? m.cachedInputTokens / m.inputTokens : null,
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
