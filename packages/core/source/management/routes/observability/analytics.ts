import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import { AnalyticsRangeSchema, type AnalyticsSummary, type ModelStat, type ProviderAnalyticsDetail } from '@common/schemas'
import { resolveAnalyticsBuckets } from '@common/analytics-buckets'
import { averageOutputTokensPerCall, cacheHitRate, tokensPerSecondFromTotals } from '@common/metrics'
import {
  getStatsSummary,
  getUsageTrend,
  getUsageHeat,
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

async function handleAnalyticsSummary(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { range } = AnalyticsSummaryRequestSchema.parse(body ?? {})
  // 时间窗与粒度都从查询范围推导一次，后续所有查询共用同一份结论（`@common/analytics-buckets`）。
  // 用量分布的粒度也来自这里：它的格宽与格数同样是范围的函数，只是比趋势桶细。
  const buckets = resolveAnalyticsBuckets(range)
  const { sinceMs } = buckets

  const [trend, heat, summary, providerStats, modelStats, latencyDistribution, failureReasons, sourceStats] = await Promise.all([
    getUsageTrend(buckets),
    getUsageHeat(buckets),
    getStatsSummary(sinceMs),
    getProviderStats(sinceMs),
    // 多取一些行：同一个模型名可能同时挂在几家供应商名下，账单要把它们合并成一行，
    // 合并前就在 SQL 里截到 10 行的话，被合并掉的名额会白占一个位置（第 11 名的模型
    // 永远等不到出场）。截断交给各自的展示方：排行榜按篇幅收口，账单合并后再收口。
    getModelStats(sinceMs, 200),
    getLatencyDistribution(sinceMs, buckets.latencyTargetBins),
    getFailureReasons(sinceMs),
    getRequestSourceStats(sinceMs),
  ])

  const totalProviderAttempts = providerStats.reduce((total, provider) => total + provider.attempts, 0)
  const totalFailures = summary.failedCount

  const providerStatsWithPercent = providerStats.map(p => ({
    ...p,
    percent: totalProviderAttempts > 0 ? Math.round((p.attempts / totalProviderAttempts) * 100) : 0,
  }))

  const modelStatsWithRate = modelStats.map(mapModelStat)

  // 延迟分布的口径是「成功的上游尝试」，因此分母必须是分布自身的样本总数，
  // 而不是请求数：一个请求可能贡献多次尝试，拿请求数当分母会让占比超过 100%。
  const latencySamples = latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)
  const latencyWithPercent = latencyDistribution.map(l => ({
    ...l,
    percent: latencySamples > 0 ? Math.round((l.count / latencySamples) * 100) : 0,
  }))

  const failureWithPercent = failureReasons.map(f => ({
    ...f,
    percent: totalFailures > 0 ? Math.round((f.count / totalFailures) * 100) : 0,
  }))

  const response: AnalyticsSummary = {
    summary,
    trendIntervalMs: buckets.trendIntervalMs,
    heatIntervalMs: buckets.heatIntervalMs,
    trend,
    heat,
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
  const buckets = resolveAnalyticsBuckets(range)
  const { sinceMs } = buckets
  const provider = await getProviderStat(providerId, sinceMs)
  if (!provider) {
    sendError(res, 'RESOURCE_NOT_FOUND', `No provider statistics in the requested time range: ${providerId}`, 404, { providerId })
    return
  }

  const [trend, modelStats, latencyDistribution, failureReasons] = await Promise.all([
    getProviderAnalyticsTrend(providerId, buckets),
    getModelStats(sinceMs, 200, providerId),
    getLatencyDistribution(sinceMs, buckets.latencyTargetBins, providerId),
    getFailureReasons(sinceMs, providerId),
  ])
  const latencySamples = latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)
  const failureSamples = failureReasons.reduce((total, reason) => total + reason.count, 0)
  const response: ProviderAnalyticsDetail = {
    summary: {
      ...provider,
      successRate: provider.attempts > 0 ? provider.success / provider.attempts : 0,
      totalTokens: trend.totalTokens,
    },
    trendIntervalMs: buckets.trendIntervalMs,
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
    attempts: model.attempts,
    success: model.success,
    avgTtftMs: model.avgTtftMs,
    // 输出速度的公式只写在 `@common/metrics` 里，这里只是把同一批尝试的两个合计值送进去。
    // 参数由数据库成对选出：分子是这批尝试的输出 Token，分母是同一批尝试的整段耗时。
    avgTps: tokensPerSecondFromTotals(model.speedOutputTokens, model.speedDurationMs),
    successRate: model.attempts > 0 ? model.success / model.attempts : 0,
    // 平均输出的分母是**成功调用数**而不是 `attempts`：`outputTokens` 由 `successOnly` 选出，
    // 只含成功尝试的输出；分母换成全部尝试会让比值被失败尝试压低，分子分母就不同源了。
    avgOutputTokens: averageOutputTokensPerCall(model.outputTokens, model.success),
    // 缓存读取量本就是输入量的一部分，同口径相除才是命中率。
    cacheHitRate: cacheHitRate(model.cachedInputTokens, model.inputTokens),
    // 原始合计随响应一起给出：账单要合并跨供应商的同名模型，只有合计能相加，
    // 平均值与比率都得由合并方拿合计重算。
    outputTokens: model.outputTokens,
    inputTokens: model.inputTokens,
    cachedInputTokens: model.cachedInputTokens,
  }
}
