import { and, eq, isNull, sql } from 'drizzle-orm'
import type { RequestSourceStat, RequestStatus } from '@common/schemas'
import { getDb } from './index'
import { requestAttempts, requestLogs, requestMetrics, requestUsages } from './schema'

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
  const sinceFloor = Math.floor(sinceMs / intervalMs) * intervalMs
  const rows = getDb().select({ bucket: sql<number>`floor((${requestLogs.createdTime} - ${sinceFloor}) / ${intervalMs})`.as('bucket'), ...usageTrendSelect }).from(requestLogs).leftJoin(requestUsages, and(eq(requestUsages.requestId, requestLogs.id), isNull(requestUsages.attemptId))).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(sql`bucket`).all()
  const map = new Map(rows.map(row => [row.bucket, row]))
  const nowFloor = Math.floor(Date.now() / intervalMs) * intervalMs
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
    source: sql<string>`coalesce((SELECT value FROM request_attributes source_attribute WHERE source_attribute.requestId = ${requestLogs.id} AND source_attribute.key = 'request.source' LIMIT 1), 'unknown')`.as('source'),
    category: sql<string>`coalesce((SELECT value FROM request_attributes category_attribute WHERE category_attribute.requestId = ${requestLogs.id} AND category_attribute.key = 'client.category' LIMIT 1), 'unknown')`.as('category'),
    requests: sql<number>`count(*)`.as('requests'),
    success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
    failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
    totalTokens: sql<number>`coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.requestId = ${requestLogs.id} AND usage.attemptId IS NULL AND usage.type = 'totalTokens')), 0)`.as('totalTokens'),
    avgLatency: sql<number>`coalesce(avg((SELECT metric.value FROM request_metrics metric WHERE metric.requestId = ${requestLogs.id} AND metric.key = 'durationMilliseconds')), 0)`.as('avgLatency'),
  }).from(requestLogs).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(sql`source`, sql`category`).orderBy(sql`requests desc`).limit(limit).all()
  return rows.map(row => ({ source: row.source, category: row.category, requests: row.requests ?? 0, success: row.success ?? 0, failed: row.failed ?? 0, totalTokens: row.totalTokens ?? 0, avgLatencyMs: row.avgLatency ?? 0 }))
}

export interface ProviderStat { providerId: string; providerName: string; requests: number; success: number; failed: number; avgLatencyMs: number }

const providerStatSelect = {
  providerId: requestAttempts.providerId,
  providerName: sql<string>`(SELECT latest.providerName FROM request_attempts latest WHERE latest.providerId = ${requestAttempts.providerId} ORDER BY latest.createdTime DESC LIMIT 1)`.as('providerName'),
  requests: sql<number>`count(*)`.as('requests'),
  success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
  failed: sql<number>`sum(case when ${requestAttempts.status} = 'failed' then 1 else 0 end)`.as('failed'),
  avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
}

type ProviderStatRow = { providerId: string; providerName: string; requests: number | null; success: number | null; failed: number | null; avgLatency: number | null }

function normalizeDevelopmentProviderName(providerId: string, providerName: string): string {
  return providerId.startsWith('prov_dev_') ? providerName.replace(/（开发示例）$/, '') : providerName
}

function mapProviderStat(row: ProviderStatRow): ProviderStat {
  return { providerId: row.providerId, providerName: normalizeDevelopmentProviderName(row.providerId, row.providerName), requests: row.requests ?? 0, success: row.success ?? 0, failed: row.failed ?? 0, avgLatencyMs: row.avgLatency ?? 0 }
}

export async function getProviderStats(sinceMs: number): Promise<ProviderStat[]> {
  const rows = getDb().select(providerStatSelect).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(requestAttempts.providerId).orderBy(sql`requests desc`).all()
  return rows.map(mapProviderStat)
}

export async function getProviderStat(providerId: string, sinceMs: number): Promise<ProviderStat | null> {
  const row = getDb().select(providerStatSelect).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(eq(requestAttempts.providerId, providerId), sql`${requestLogs.createdTime} >= ${sinceMs}`)).groupBy(requestAttempts.providerId).get()
  return row ? mapProviderStat(row) : null
}

export interface ProviderRequestTrendPoint { label: string; success: number; failed: number; successRate: number; avgLatencyMs: number }
export interface ProviderAnalyticsTrend { requestTrend: ProviderRequestTrendPoint[]; tokenTrend: DailyTrendPoint[]; totalTokens: number }

type ProviderTrendRow = TrendPointRow & {
  label: string
  requests?: number | null
  success?: number | null
  failed?: number | null
  avgLatencyMs?: number | null
  totalTokens?: number | null
}

const providerTrendSelect = {
  requests: sql<number>`count(*)`.as('requests'),
  success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
  failed: sql<number>`sum(case when ${requestAttempts.status} = 'failed' then 1 else 0 end)`.as('failed'),
  avgLatencyMs: sql<number>`coalesce(avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end), 0)`.as('avgLatencyMs'),
  inputTokens: sql<number>`coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.attemptId = ${requestAttempts.id} AND usage.type = 'inputTokens')), 0)`.as('inputTokens'),
  outputTokens: sql<number>`coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.attemptId = ${requestAttempts.id} AND usage.type = 'outputTokens')), 0)`.as('outputTokens'),
  cachedInputTokens: sql<number>`coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.attemptId = ${requestAttempts.id} AND usage.type = 'cachedInputTokens')), 0)`.as('cachedInputTokens'),
  cacheCreationInputTokens: sql<number>`coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.attemptId = ${requestAttempts.id} AND usage.type = 'cacheCreationInputTokens')), 0)`.as('cacheCreationInputTokens'),
  reasoningTokens: sql<number>`coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.attemptId = ${requestAttempts.id} AND usage.type = 'reasoningTokens')), 0)`.as('reasoningTokens'),
  totalTokens: sql<number>`coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.attemptId = ${requestAttempts.id} AND usage.type = 'totalTokens')), 0)`.as('totalTokens'),
}

export async function getProviderAnalyticsTrend(providerId: string, sinceMs: number, intraday: boolean): Promise<ProviderAnalyticsTrend> {
  const intervalMs = 15 * 60 * 1000
  const sinceFloor = Math.floor(sinceMs / intervalMs) * intervalMs
  const bucket = intraday
    ? sql<string>`floor((${requestLogs.createdTime} - ${sinceFloor}) / ${intervalMs})`
    : sql<string>`strftime('%Y-%m-%d', ${requestLogs.createdTime} / 1000, 'unixepoch', 'localtime')`
  const rows = getDb().select({ label: bucket.as('label'), ...providerTrendSelect })
    .from(requestAttempts)
    .innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id))
    .where(and(sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestAttempts.providerId, providerId)))
    .groupBy(bucket)
    .orderBy(bucket)
    .all()
  const normalizedRows = intraday ? fillIntradayProviderTrend(rows, sinceMs) : rows.map(row => ({ ...row, label: String(row.label) }))
  return {
    requestTrend: normalizedRows.map(normalizeProviderRequestTrendPoint),
    tokenTrend: normalizedRows.map(normalizeTrendPoint),
    totalTokens: rows.reduce((total, row) => total + (row.totalTokens ?? 0), 0),
  }
}

function fillIntradayProviderTrend(rows: ProviderTrendRow[], sinceMs: number): ProviderTrendRow[] {
  const intervalMs = 15 * 60 * 1000
  const map = new Map(rows.map(row => [Number(row.label), row]))
  const sinceFloor = Math.floor(sinceMs / intervalMs) * intervalMs
  const nowFloor = Math.floor(Date.now() / intervalMs) * intervalMs
  const slots = Math.floor((nowFloor - sinceFloor) / intervalMs) + 1
  return Array.from({ length: slots }, (_, index) => ({ ...map.get(index), label: formatIntradayLabel(sinceFloor + index * intervalMs) }))
}

function normalizeProviderRequestTrendPoint(row: ProviderTrendRow): ProviderRequestTrendPoint {
  const success = row.success ?? 0
  const failed = row.failed ?? 0
  const requests = row.requests ?? 0
  return { label: row.label, success, failed, successRate: requests > 0 ? success / requests : 0, avgLatencyMs: row.avgLatencyMs ?? 0 }
}

export interface ModelStat { providerModelId: string; providerModelName: string; providerId: string; providerName: string; requests: number; success: number; avgLatencyMs: number; avgTtftMs: number | null; cachedInputTokens: number; inputTokens: number; outputTokens: number; successGenerationDurationMs: number }

export async function getModelStats(sinceMs: number, limit = 10, providerId?: string): Promise<ModelStat[]> {
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const rows = getDb().select({
    providerModelId: requestAttempts.providerModelId,
    providerModelName: sql<string>`(SELECT latest.providerModelName FROM request_attempts latest WHERE latest.providerModelId = ${requestAttempts.providerModelId} ORDER BY latest.createdTime DESC LIMIT 1)`.as('providerModelName'),
    providerId: requestAttempts.providerId,
    providerName: sql<string>`(SELECT latest.providerName FROM request_attempts latest WHERE latest.providerId = ${requestAttempts.providerId} ORDER BY latest.createdTime DESC LIMIT 1)`.as('providerName'),
    requests: sql<number>`count(*)`.as('requests'),
    success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
    avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
    avgTtft: sql<number>`avg((SELECT value FROM request_metrics ttft WHERE ttft.requestId = ${requestAttempts.requestId} AND ttft.key = 'ttftMilliseconds'))`.as('avgTtft'),
    cachedInputTokens: sql<number>`sum((SELECT coalesce(sum(CASE WHEN usage.type = 'cachedInputTokens' THEN usage.value ELSE 0 END), 0) FROM request_usages usage WHERE usage.attemptId = ${requestAttempts.id}))`.as('cachedInputTokens'),
    inputTokens: sql<number>`sum((SELECT coalesce(sum(CASE WHEN usage.type = 'inputTokens' THEN usage.value ELSE 0 END), 0) FROM request_usages usage WHERE usage.attemptId = ${requestAttempts.id}))`.as('inputTokens'),
    outputTokens: sql<number>`sum((SELECT coalesce(sum(CASE WHEN usage.type = 'outputTokens' THEN usage.value ELSE 0 END), 0) FROM request_usages usage WHERE usage.attemptId = ${requestAttempts.id}))`.as('outputTokens'),
    successGenerationDurationMs: sql<number>`sum(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} else 0 end)`.as('successGenerationDurationMs'),
  }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(...filters)).groupBy(requestAttempts.providerModelId, requestAttempts.providerId).orderBy(sql`requests desc`).limit(limit).all()
  return rows.map(row => ({ providerModelId: row.providerModelId, providerModelName: row.providerModelName, providerId: row.providerId, providerName: normalizeDevelopmentProviderName(row.providerId, row.providerName), requests: row.requests ?? 0, success: row.success ?? 0, avgLatencyMs: row.avgLatency ?? 0, avgTtftMs: row.avgTtft ?? null, cachedInputTokens: row.cachedInputTokens ?? 0, inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, successGenerationDurationMs: row.successGenerationDurationMs ?? 0 }))
}

export interface LatencyBucket { range: string; count: number }

const LATENCY_BUCKET_COUNT = 10

// 线性插值取分位数，样本已按升序排列。
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const index = (sortedValues.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

// 把步长向上对齐到整数，确保前 n 个桶覆盖完整的 p95 范围。
function ceilStep(raw: number): number {
  return Math.max(1, Math.ceil(raw))
}

function formatShortDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  const rounded = Math.round(seconds * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`
}

// 根据 TTFT 的 p95 把 [0, p95] 均分成 n 份，桶边界对齐整数；超过 p95 的样本单独计入长尾桶。
export async function getLatencyDistribution(sinceMs: number, providerId?: string): Promise<LatencyBucket[]> {
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`]
  if (providerId) filters.push(sql`exists (SELECT 1 FROM request_attempts provider_attempt WHERE provider_attempt.requestId = ${requestLogs.id} AND provider_attempt.providerId = ${providerId})`)
  const rows = getDb()
    .select({ value: requestMetrics.value })
    .from(requestLogs)
    .innerJoin(requestMetrics, and(eq(requestMetrics.requestId, requestLogs.id), eq(requestMetrics.key, 'ttftMilliseconds')))
    .where(and(...filters))
    .all()
  const samples = rows.map(row => row.value).sort((left, right) => left - right)
  if (samples.length === 0) return []
  const p95 = percentile(samples, 0.95)
  const step = ceilStep(p95 / LATENCY_BUCKET_COUNT)
  const tailMin = step * LATENCY_BUCKET_COUNT
  const buckets: LatencyBucket[] = Array.from({ length: LATENCY_BUCKET_COUNT + 1 }, (_, index) => ({
    range: index < LATENCY_BUCKET_COUNT
      ? `${formatShortDuration(index * step)}-${formatShortDuration((index + 1) * step)}`
      : `> ${formatShortDuration(tailMin)}`,
    count: 0,
  }))
  for (const value of samples) {
    const index = Math.min(Math.floor(value / step), LATENCY_BUCKET_COUNT)
    buckets[index].count += 1
  }
  return buckets
}

export interface FailureReasonStat { reason: string; count: number }

export async function getFailureReasons(sinceMs: number, providerId?: string): Promise<FailureReasonStat[]> {
  const finalFailedAttempt = sql`${requestAttempts.attemptIndex} = (SELECT max(final_attempt.attemptIndex) FROM request_attempts AS final_attempt WHERE final_attempt.requestId = ${requestAttempts.requestId} AND final_attempt.status = 'failed')`
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestLogs.status, 'failed'), eq(requestAttempts.status, 'failed' as RequestStatus), finalFailedAttempt]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const rows = getDb().select({ errorCode: requestAttempts.errorCode, count: sql<number>`count(distinct ${requestAttempts.requestId})`.as('count') }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(...filters)).groupBy(requestAttempts.errorCode).orderBy(sql`count desc`).all()
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
