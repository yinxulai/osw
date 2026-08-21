import { and, eq, isNull, sql } from 'drizzle-orm'
import type { RequestStatus } from '@common/schemas'
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

export interface DailyTrendPoint { day: string; requests: number; success: number; failed: number }

export async function getRequestTrend(sinceMs: number, days: number): Promise<DailyTrendPoint[]> {
  const rows = getDb().select({
    day: sql<string>`strftime('%Y-%m-%d', ${requestLogs.createdTime} / 1000, 'unixepoch', 'localtime')`.as('day'),
    requests: sql<number>`count(*)`.as('requests'),
    success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
    failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
  }).from(requestLogs).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(sql`day`).orderBy(sql`day`).all()
  const map = new Map(rows.map(row => [row.day, row]))
  const result: DailyTrendPoint[] = []
  const current = new Date()
  for (let index = days - 1; index >= 0; index--) {
    const date = new Date(current)
    date.setDate(date.getDate() - index)
    const day = formatLocalDate(date)
    const row = map.get(day)
    result.push({ day, requests: row?.requests ?? 0, success: row?.success ?? 0, failed: row?.failed ?? 0 })
  }
  return result
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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

export interface ModelStat { providerModelName: string; providerId: string; providerName: string; requests: number; success: number; avgLatencyMs: number; avgTtftMs: number | null; cacheHits: number; cacheSamples: number }

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
    cacheHits: sql<number>`count(distinct case when (SELECT value FROM request_metrics cache WHERE cache.requestId = ${requestAttempts.requestId} AND cache.key = 'cacheHit') = 1 then ${requestAttempts.requestId} end)`.as('cacheHits'),
    cacheSamples: sql<number>`count(distinct case when (SELECT value FROM request_metrics cache WHERE cache.requestId = ${requestAttempts.requestId} AND cache.key = 'cacheHit') is not null then ${requestAttempts.requestId} end)`.as('cacheSamples'),
  }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(sql`${requestLogs.createdTime} >= ${sinceMs}`, finalAttempt)).groupBy(requestAttempts.providerModelName, requestAttempts.providerId, requestAttempts.providerName).orderBy(sql`requests desc`).limit(limit).all()
  return rows.map(row => ({ providerModelName: row.providerModelName, providerId: row.providerId, providerName: row.providerName, requests: row.requests ?? 0, success: row.success ?? 0, avgLatencyMs: row.avgLatency ?? 0, avgTtftMs: row.avgTtft ?? null, cacheHits: row.cacheHits ?? 0, cacheSamples: row.cacheSamples ?? 0 }))
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
