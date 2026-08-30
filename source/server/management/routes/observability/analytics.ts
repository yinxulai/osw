import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import { AnalyticsRangeSchema, type AnalyticsRange, type AnalyticsSummary, type ModelStat, type ProviderAnalyticsDetail } from '@common/schemas'
import {
  getStatsSummary,
  getUsageTrend,
  getIntradayUsageTrend,
  getProviderStats,
  getProviderStat,
  getProviderAnalyticsTrend,
  getModelStats,
  getLatencyDistribution,
  getFailureReasons,
  getRequestSourceStats,
  type ModelStat as DatabaseModelStat,
} from '@server/database/analytics-store'
import { HttpRouter } from '@server/http-router'

export const analyticsRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/analytics/summary', handleAnalyticsSummary)
  .post('/api/analytics/provider-detail', handleProviderAnalyticsDetail)

const AnalyticsSummaryRequestSchema = z.object({
  range: AnalyticsRangeSchema.optional().default('7d'),
})

const ProviderAnalyticsRequestSchema = z.object({
  providerId: z.string().trim().min(1),
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

  const trend = range === 'today' ? await getIntradayUsageTrend(sinceMs) : await getUsageTrend(sinceMs)

  const [summary, providerStats, modelStats, latencyDistribution, failureReasons, sourceStats] = await Promise.all([
    getStatsSummary(sinceMs),
    getProviderStats(sinceMs),
    getModelStats(sinceMs, 10),
    getLatencyDistribution(sinceMs),
    getFailureReasons(sinceMs),
    getRequestSourceStats(sinceMs),
  ])

  const totalRequests = summary.totalRequests
  const totalProviderAttempts = providerStats.reduce((total, provider) => total + provider.requests, 0)
  const totalFailures = summary.failedCount

  const providerStatsWithPercent = providerStats.map(p => ({
    ...p,
    percent: totalProviderAttempts > 0 ? Math.round((p.requests / totalProviderAttempts) * 100) : 0,
  }))

  const modelStatsWithRate = modelStats.map(mapModelStat)

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
    sourceStats,
  }

  sendSuccess(res, response)
}

async function handleProviderAnalyticsDetail(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { providerId, range } = ProviderAnalyticsRequestSchema.parse(body ?? {})
  const sinceMs = resolveSinceMs(range)
  const provider = await getProviderStat(providerId, sinceMs)
  if (!provider) {
    sendError(res, 'RESOURCE_NOT_FOUND', `当前时间范围内没有供应商统计数据 ${providerId}`, 404)
    return
  }

  const [trend, modelStats, latencyDistribution, failureReasons] = await Promise.all([
    getProviderAnalyticsTrend(providerId, sinceMs, range === 'today'),
    getModelStats(sinceMs, 200, providerId),
    getLatencyDistribution(sinceMs, providerId),
    getFailureReasons(sinceMs, providerId),
  ])
  const latencySamples = latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)
  const failureSamples = failureReasons.reduce((total, reason) => total + reason.count, 0)
  const response: ProviderAnalyticsDetail = {
    summary: {
      ...provider,
      successRate: provider.requests > 0 ? provider.success / provider.requests : 0,
      totalTokens: trend.totalTokens,
    },
    requestTrend: trend.requestTrend,
    tokenTrend: trend.tokenTrend,
    models: modelStats.map(mapModelStat),
    latencyDistribution: latencyDistribution.map(bucket => ({
      ...bucket,
      percent: latencySamples > 0 ? Math.round((bucket.count / latencySamples) * 100) : 0,
    })),
    failureReasons: failureReasons.map(reason => ({
      ...reason,
      percent: failureSamples > 0 ? Math.round((reason.count / failureSamples) * 100) : 0,
    })),
  }
  sendSuccess(res, response)
}

function mapModelStat(model: DatabaseModelStat): ModelStat {
  return {
    providerModelId: model.providerModelId,
    providerModelName: model.providerModelName,
    providerId: model.providerId,
    providerName: model.providerName,
    requests: model.requests,
    success: model.success,
    avgLatencyMs: model.avgLatencyMs,
    avgTtftMs: model.avgTtftMs,
    avgTps: model.successGenerationDurationMs > 0 && model.outputTokens > 0 ? model.outputTokens / (model.successGenerationDurationMs / 1000) : null,
    successRate: model.requests > 0 ? model.success / model.requests : 0,
    cacheHitRate: model.inputTokens > 0 ? model.cachedInputTokens / model.inputTokens : null,
  }
}
