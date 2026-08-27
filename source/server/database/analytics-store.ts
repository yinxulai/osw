import { and, eq, isNull, sql } from 'drizzle-orm'
import type { RequestSourceStat, RequestStatus } from '@common/schemas'
import { getDb } from './index'
import { requestAttempts, requestLogs, requestUsages } from './schema'

export interface StatsSummary {
  totalRequests: number
  successCount: number
  failedCount: number
  successRate: number
  avgLatencyMs: number
  totalTokens: number
}

export async function getStatsSummary(sinceMs: number): Promise<StatsSummary> {
  const db = getDb()
  const result = db
    .select({
      total: sql<number>`count(*)`.as('total'),
      success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
      failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
      avgLatency: sql<number>`avg((SELECT value FROM request_metrics m WHERE m.requestId = ${requestLogs.id} AND m.key = 'durationMilliseconds') )`.as('avgLatency'),
    })
    .from(requestLogs)
    .where(sql`${requestLogs.createdTime} >= ${sinceMs}`)
    .get()
  const usageResult = db
    .select({ tokens: sql<number>`coalesce(sum(${requestUsages.value}), 0)`.as('tokens') })
    .from(requestUsages)
    .innerJoin(requestLogs, eq(requestUsages.requestId, requestLogs.id))
    .where(and(eq(requestUsages.type, 'totalTokens'), isNull(requestUsages.attemptId), sql`${requestLogs.createdTime} >= ${sinceMs}`))
    .get()
  const total = result?.total ?? 0
  const success = result?.success ?? 0
  const failed = result?.failed ?? 0
  return { totalRequests: total, successCount: success, failedCount: failed, successRate: total > 0 ? success / total : 0, avgLatencyMs: result?.avgLatency ?? 0, totalTokens: usageResult?.tokens ?? 0 }
}

export interface DailyTrendPoint { label: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheCreationInputTokens: number; reasoningTokens: number }

type TrendPointRow = {
  label: string
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  reasoningTokens?: number | null
}

const usageTrendSelect = {
  inputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'inputTokens' then ${requestUsages.value} else 0 end), 0)`.as('inputTokens'),
  outputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'outputTokens' then ${requestUsages.value} else 0 end), 0)`.as('outputTokens'),
  cachedInputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'cachedInputTokens' then ${requestUsages.value} else 0 end), 0)`.as('cachedInputTokens'),
  cacheCreationInputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'cacheCreationInputTokens' then ${requestUsages.value} else 0 end), 0)`.as('cacheCreationInputTokens'),
  reasoningTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'reasoningTokens' then ${requestUsages.value} else 0 end), 0)`.as('reasoningTokens'),
}

export async function getUsageTrend(sinceMs: number): Promise<DailyTrendPoint[]> {
  const rows = getDb().select({ label: sql<string>`strftime('%Y-%m-%d', ${requestLogs.createdTime} / 1000, 'unixepoch', 'localtime')`.as('label'), ...usageTrendSelect }).from(requestLogs).leftJoin(requestUsages, and(eq(requestUsages.requestId, requestLogs.id), isNull(requestUsages.attemptId))).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(sql`label`).orderBy(sql`label`).all()
  return rows.map(normalizeTrendPoint)
}

export async function getIntradayUsageTrend(sinceMs: number): Promise<DailyTrendPoint[]> {
  const intervalMs = 15 * 60 * 1000
  const rows = getDb().select({ bucket: sql<number>`floor((${requestLogs.createdTime} - ${sinceMs}) / ${intervalMs})`.as('bucket'), ...usageTrendSelect }).from(requestLogs).leftJoin(requestUsages, and(eq(requestUsages.requestId, requestLogs.id), isNull(requestUsages.attemptId))).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(sql`bucket`).all()
  const map = new Map(rows.map(row => [row.bucket, row]))
  const nowFloor = Math.floor(Date.now() / intervalMs) * intervalMs
  const sinceFloor = Math.floor(sinceMs / intervalMs) * intervalMs
  const slots = Math.floor((nowFloor - sinceFloor) / intervalMs) + 1
  return Array.from({ length: slots }, (_, bucket) => {
    const row = map.get(bucket)
    return normalizeTrendPoint({ label: formatIntradayLabel(sinceFloor + bucket * intervalMs), ...row })
  })
}

function normalizeTrendPoint(row: TrendPointRow): DailyTrendPoint {
  return { label: row.label, inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, cachedInputTokens: row.cachedInputTokens ?? 0, cacheCreationInputTokens: row.cacheCreationInputTokens ?? 0, reasoningTokens: row.reasoningTokens ?? 0 }
}

function formatIntradayLabel(startMs: number): string {
  const d = new Date(startMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export async function getRequestSourceStats(sinceMs: number, limit = 20): Promise<RequestSourceStat[]> {
  const rows = getDb().select({
    source: sql<string>`coalesce((SELECT value FROM request_attributes source_attr WHERE source_attr.requestId = ${requestLogs.id} AND source_attr.key = 'request.source' LIMIT 1), 'unknown')`.as('source'),
    category: sql<string>`coalesce((SELECT value FROM request_attributes category_attr WHERE category_attr.requestId = ${requestLogs.id} AND category_attr.key = 'client.category' LIMIT 1), 'unknown')`.as('category'),
    requests: sql<number>`count(*)`.as('requests'),
    success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
    failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
    totalTokens: sql<number>`coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.requestId = ${requestLogs.id} AND usage.attemptId IS NULL AND usage.type = 'totalTokens')), 0)`.as('totalTokens'),
    avgLatency: sql<number>`coalesce(avg((SELECT metric.value FROM request_metrics metric WHERE metric.requestId = ${requestLogs.id} AND metric.key = 'durationMilliseconds')), 0)`.as('avgLatency'),
  }).from(requestLogs).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(sql`source`, sql`category`).orderBy(sql`requests desc`).limit(limit).all()
  return rows.map(row => ({ source: row.source, category: row.category, requests: row.requests ?? 0, success: row.success ?? 0, failed: row.failed ?? 0, totalTokens: row.totalTokens ?? 0, avgLatencyMs: row.avgLatency ?? 0 }))
}

export interface ProviderStat { providerId: string; providerName: string; requests: number; success: number; failed: number; avgLatencyMs: number }

export async function getProviderStats(sinceMs: number): Promise<ProviderStat[]> {
  const finalAttempt = sql`${requestAttempts.attemptIndex} = (SELECT max(final_attempt.attemptIndex) FROM request_attempts AS final_attempt WHERE final_attempt.requestId = ${requestAttempts.requestId})`
  const rows = getDb().select({
    providerId: requestAttempts.providerId,
    providerName: requestAttempts.providerName,
    requests: sql<number>`count(distinct ${requestAttempts.requestId})`.as('requests'),
    success: sql<number>`count(distinct case when ${requestAttempts.status} = 'success' then ${requestAttempts.requestId} end)`.as('success'),
    failed: sql<number>`count(distinct case when ${requestAttempts.status} = 'failed' then ${requestAttempts.requestId} end)`.as('failed'),
    avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
  }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(sql`${requestLogs.createdTime} >= ${sinceMs}`, finalAttempt)).groupBy(requestAttempts.providerId, requestAttempts.providerName).orderBy(sql`requests desc`).all()
  return rows.map(row => ({ providerId: row.providerId, providerName: row.providerName, requests: row.requests ?? 0, success: row.success ?? 0, failed: row.failed ?? 0, avgLatencyMs: row.avgLatency ?? 0 }))
}

export interface ModelStat { providerModelName: string; providerId: string; providerName: string; requests: number; success: number; avgLatencyMs: number; avgTtftMs: number | null; cachedInputTokens: number; inputTokens: number; outputTokens: number; successGenerationDurationMs: number }

export async function getModelStats(sinceMs: number, limit = 10): Promise<ModelStat[]> {
  const finalAttempt = sql`${requestAttempts.attemptIndex} = (SELECT max(final_attempt.attemptIndex) FROM request_attempts AS final_attempt WHERE final_attempt.requestId = ${requestAttempts.requestId})`
  const rows = getDb().select({
    providerModelName: requestAttempts.providerModelName,
    providerId: requestAttempts.providerId,
    providerName: requestAttempts.providerName,
    requests: sql<number>`count(distinct ${requestAttempts.requestId})`.as('requests'),
    success: sql<number>`count(distinct case when ${requestAttempts.status} = 'success' then ${requestAttempts.requestId} end)`.as('success'),
    avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
    avgTtft: sql<number>`avg((SELECT value FROM request_metrics ttft WHERE ttft.requestId = ${requestAttempts.requestId} AND ttft.key = 'ttftMilliseconds'))`.as('avgTtft'),
    cachedInputTokens: sql<number>`sum((SELECT coalesce(sum(CASE WHEN usage.type = 'cachedInputTokens' THEN usage.value ELSE 0 END), 0) FROM request_usages usage WHERE usage.requestId = ${requestAttempts.requestId} AND usage.attemptId IS NULL))`.as('cachedInputTokens'),
    inputTokens: sql<number>`sum((SELECT coalesce(sum(CASE WHEN usage.type = 'inputTokens' THEN usage.value ELSE 0 END), 0) FROM request_usages usage WHERE usage.requestId = ${requestAttempts.requestId} AND usage.attemptId IS NULL))`.as('inputTokens'),
    outputTokens: sql<number>`sum((SELECT coalesce(sum(CASE WHEN usage.type = 'outputTokens' THEN usage.value ELSE 0 END), 0) FROM request_usages usage WHERE usage.requestId = ${requestAttempts.requestId} AND usage.attemptId IS NULL))`.as('outputTokens'),
    successGenerationDurationMs: sql<number>`sum(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} else 0 end)`.as('successGenerationDurationMs'),
  }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(sql`${requestLogs.createdTime} >= ${sinceMs}`, finalAttempt)).groupBy(requestAttempts.providerModelName, requestAttempts.providerId, requestAttempts.providerName).orderBy(sql`requests desc`).limit(limit).all()
  return rows.map(row => ({ providerModelName: row.providerModelName, providerId: row.providerId, providerName: row.providerName, requests: row.requests ?? 0, success: row.success ?? 0, avgLatencyMs: row.avgLatency ?? 0, avgTtftMs: row.avgTtft ?? null, cachedInputTokens: row.cachedInputTokens ?? 0, inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, successGenerationDurationMs: row.successGenerationDurationMs ?? 0 }))
}

export interface LatencyBucket { range: string; count: number }

export async function getLatencyDistribution(sinceMs: number): Promise<LatencyBucket[]> {
  const buckets = [{ range: '< 1s', min: 0, max: 1000 }, { range: '1-2s', min: 1000, max: 2000 }, { range: '2-3s', min: 2000, max: 3000 }, { range: '3-5s', min: 3000, max: 5000 }, { range: '> 5s', min: 5000, max: Number.MAX_SAFE_INTEGER }]
  const result: LatencyBucket[] = []
  for (const bucket of buckets) {
    const row = getDb().select({ count: sql<number>`count(*)`.as('count') }).from(requestLogs).where(sql`${requestLogs.createdTime} >= ${sinceMs} and (SELECT value FROM request_metrics m WHERE m.requestId = ${requestLogs.id} AND m.key = 'durationMilliseconds') >= ${bucket.min} and (SELECT value FROM request_metrics m WHERE m.requestId = ${requestLogs.id} AND m.key = 'durationMilliseconds') < ${bucket.max}`).get()
    result.push({ range: bucket.range, count: row?.count ?? 0 })
  }
  return result
}

export interface FailureReasonStat { reason: string; count: number }

export async function getFailureReasons(sinceMs: number): Promise<FailureReasonStat[]> {
  const finalFailedAttempt = sql`${requestAttempts.attemptIndex} = (SELECT max(final_attempt.attemptIndex) FROM request_attempts AS final_attempt WHERE final_attempt.requestId = ${requestAttempts.requestId} AND final_attempt.status = 'failed')`
  const rows = getDb().select({ errorCode: requestAttempts.errorCode, count: sql<number>`count(distinct ${requestAttempts.requestId})`.as('count') }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestLogs.status, 'failed'), eq(requestAttempts.status, 'failed' as RequestStatus), finalFailedAttempt)).groupBy(requestAttempts.errorCode).orderBy(sql`count desc`).all()
  const categories: Record<string, number> = { '超时': 0, '限流 (429)': 0, '服务错误 (5xx)': 0, '认证失败': 0, '其他': 0 }
  for (const row of rows) {
    const code = row.errorCode ?? 'UNKNOWN'
    if (code.includes('TIMEOUT') || code.includes('ECONNRESET') || code.includes('ETIMEDOUT')) categories['超时'] += row.count
    else if (code.includes('429') || code.includes('RATE_LIMIT')) categories['限流 (429)'] += row.count
    else if (/Status_5\d\d/.test(code) || code.includes('UPSTREAM_ERROR') || code.includes('SERVER_ERROR')) categories['服务错误 (5xx)'] += row.count
    else if (code.includes('401') || code.includes('403') || code.includes('AUTH')) categories['认证失败'] += row.count
    else categories['其他'] += row.count
  }
  return Object.entries(categories).map(([reason, count]) => ({ reason, count })).filter(row => row.count > 0).sort((left, right) => right.count - left.count)
}
