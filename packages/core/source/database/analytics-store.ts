import { and, eq, gte, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { DAY_MILLISECONDS, formatLatencyBinLabel, formatTrendBucketLabel, resolveHeatBuckets, resolveLatencyBinEdges, resolveTrendBuckets, type AnalyticsBuckets } from '@common/analytics-buckets'
import { cacheHitRate } from '@common/metrics'
import type { FailureReasonCategory, RequestSourceStat, RequestStatus, UsageTrendPoint } from '@common/schemas'
import { getDataDb } from './index'
import { attemptUsages, requestAttempts, requestAttributes, requestLogs, requestUsages } from './data-schema'

/**
 * 用量表里可以求和的类型。
 *
 * `raw` 行存的是上游原始 usage 报文（数值列为 NULL），任何 `sum` 都必须绕开它：
 * 这里逐类型取值，天然只命中数值行。
 */
const USAGE_TOKEN_TYPES = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens'] as const

type UsageTokenType = typeof USAGE_TOKEN_TYPES[number]

/**
 * 「请求级总 token」的求和项：输入 + 输出。
 *
 * `raw` 行存的是上游原始报文（数值列为 NULL），`in (...)` 天然把它排除。
 */
const TOTAL_REQUEST_TOKENS = sql<number>`case when ${requestUsages.type} in ('inputTokens', 'outputTokens') then ${requestUsages.value} else 0 end`

/** 用量透视的列集合：一列对应一种数值用量类型。 */
type UsageTokenSums<T> = Record<UsageTokenType, T>

/**
 * 把「一种类型一行」的用量表拧成「一列一种类型」的五列。
 *
 * 显式列出五种类型（而不是循环拼接）是为了让子查询的列集合成为静态已知的字段，
 * 后续查询才能按类型名索引到具体的列。
 */
function usagePivotColumns(typeColumn: AnySQLiteColumn, valueColumn: AnySQLiteColumn): UsageTokenSums<SQL.Aliased<number>> {
  const sumOf = (type: UsageTokenType) => sql<number>`sum(case when ${typeColumn} = ${type} then ${valueColumn} else 0 end)`.as(type)
  return { inputTokens: sumOf('inputTokens'), outputTokens: sumOf('outputTokens'), cachedInputTokens: sumOf('cachedInputTokens'), cacheCreationInputTokens: sumOf('cacheCreationInputTokens'), reasoningTokens: sumOf('reasoningTokens') }
}

export interface StatsSummary {
  totalRequests: number
  successCount: number
  failedCount: number
  successRate: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheHitRate: number | null
}

export async function getStatsSummary(sinceMs: number): Promise<StatsSummary> {
  const db = getDataDb()
  const result = db
    .select({
      total: sql<number>`count(*)`.as('total'),
      success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
      failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
    })
    .from(requestLogs)
    .where(sql`${requestLogs.createdTime} >= ${sinceMs}`)
    .get()
  // 用量按类型各取一个合计值，而不是先合再分：命中率要的是缓存读取 ÷ **输入总量**，
  // 分子与分母必须是**同一批样本**的两个总量，同一次扫描同时取出才不会各写一份筛选条件。
  //
  // 逐类型取值意味着 `raw` 行（上游原始报文，数值列为 NULL）不会进入任何一列。
  //
  // 这里不再连 `request_logs`：`request_usages` 本来就是请求级视角
  // （服务该请求的那次尝试写入时把它镜像过来），它的 `createdTime` 必然不早于
  // 请求的创建时间，所以按同一时间窗过滤得到的就是同一批行，少一次 join 就少一次全表扫描。
  const usageResult = db
    .select({
      inputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'inputTokens' then ${requestUsages.value} else 0 end), 0)`.as('inputTokens'),
      outputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'outputTokens' then ${requestUsages.value} else 0 end), 0)`.as('outputTokens'),
      cachedInputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'cachedInputTokens' then ${requestUsages.value} else 0 end), 0)`.as('cachedInputTokens'),
    })
    .from(requestUsages)
    .where(gte(requestUsages.createdTime, sinceMs))
    .get()
  const total = result?.total ?? 0
  const success = result?.success ?? 0
  const failed = result?.failed ?? 0
  const inputTokens = usageResult?.inputTokens ?? 0
  const outputTokens = usageResult?.outputTokens ?? 0
  const cachedInputTokens = usageResult?.cachedInputTokens ?? 0
  // 总 token 与命中率都是派生值：加数、分子分母都来自同一次扫描，合计与各列必然自洽。
  // 命中率的公式只写在 `@common/metrics` 里，这里只是把同一批样本的两个总量送进去。
  return { totalRequests: total, successCount: success, failedCount: failed, successRate: total > 0 ? success / total : 0, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cacheHitRate: cacheHitRate(cachedInputTokens, inputTokens) }
}

/** SQL 侧只能产出用量列：标签属于桶清单，由 JS 在补齐空桶时赋上。 */
type TrendUsageRow = {
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  reasoningTokens?: number | null
}

type TrendPointRow = TrendUsageRow & { label: string }

// 请求级用量透视。
//
// 用量表是「一种类型一行」，分析页要的是「一列一种类型」。**先在用量表里按请求聚好**
// （聚合后每个请求只剩一行），再左连接回请求表：分组时的中间结果因此是「请求」而不是
// 「请求 × 用量行」，扫描的行数比在请求表上现算 `case when` 少一个量级。
//
// 逐类型取值意味着 `raw` 行（上游原始报文，数值列为 NULL）不会进入任何一列。
function buildRequestUsagePivot(sinceMs: number) {
  return getDataDb()
    .select({ requestId: requestUsages.requestId, ...usagePivotColumns(requestUsages.type, requestUsages.value) })
    .from(requestUsages)
    .where(gte(requestUsages.createdTime, sinceMs))
    .groupBy(requestUsages.requestId)
    .as('request_usage_pivot')
}

type RequestUsagePivot = ReturnType<typeof buildRequestUsagePivot>

/** 透视结果按行求和：`sum(coalesce(x, 0))` 与「每行先 coalesce 再相加」等价。 */
function usageTrendSelect(pivot: RequestUsagePivot): UsageTokenSums<SQL.Aliased<number>> {
  const sumOf = (type: UsageTokenType) => sql<number>`coalesce(sum(${pivot[type]}), 0)`.as(type)
  return { inputTokens: sumOf('inputTokens'), outputTokens: sumOf('outputTokens'), cachedInputTokens: sumOf('cachedInputTokens'), cacheCreationInputTokens: sumOf('cacheCreationInputTokens'), reasoningTokens: sumOf('reasoningTokens') }
}

/**
 * 用量趋势：按推导出的粒度分桶，**只分一次，不再分「今天用这份、其余用那份」**。
 *
 * 粒度（桶宽、锚点、桶数）全部由 `@common/analytics-buckets` 从查询范围推出来，
 * 这里只负责用同一套规则去分组：两边必须是同一个式子，否则「今天 15 分钟一根柱子、
 * 30 天一天一根柱子」这类写死的毛病会从别的地方长回来。
 *
 * 空桶由 JS 补齐：SQL 的 `group by` 只返回出现过的桶，而图表要靠空桶保持时间轴连续。
 */
export async function getUsageTrend(buckets: AnalyticsBuckets): Promise<UsageTrendPoint[]> {
  const pivot = buildRequestUsagePivot(buckets.sinceMs)
  const rows = getDataDb().select({ bucket: trendBucketIndex(requestLogs.createdTime, buckets).as('bucket'), ...usageTrendSelect(pivot) })
    .from(requestLogs)
    .leftJoin(pivot, eq(pivot.requestId, requestLogs.id))
    .where(gte(requestLogs.createdTime, buckets.sinceMs))
    .groupBy(sql`bucket`)
    .all()
  return fillTrendBuckets(buckets, rows)
}

/**
 * 桶号的 SQL 表达式：与 `@common/analytics-buckets` 的 `trendBucketIndexAt` 一一对应，
 * 改动必须同时落到两处。桶宽是入参，趋势图与热力图各传自己那一档。
 *
 * 桶号是「距锚点日的**墙钟**分钟数 ÷ 桶宽」而不是「距某个绝对时间戳的毫秒数 ÷ 桶宽」：
 * 后者在跨夏令时的那一天会把格子整体错开一小时，前者不会。
 * `date(..., 'unixepoch', 'localtime')` 与 `strftime('%H'/'%M', ..., 'localtime')` 取的都是
 * 本地日历，恰是 `trendBucketIndexAt` 里 `localDayOffset` + `minutesOfLocalDay` 的表达。
 */
function bucketIndex(column: AnySQLiteColumn, anchorDayMs: number, intervalMs: number): SQL<number> {
  const anchorDay = formatTrendBucketLabel(anchorDayMs, DAY_MILLISECONDS)
  const slotsPerDay = DAY_MILLISECONDS / intervalMs
  const intervalMinutes = intervalMs / 60_000
  const localDate = localDateExpression(column)
  const localMinuteOfDay = sql`(cast(strftime('%H', ${column} / 1000, 'unixepoch', 'localtime') as integer) * 60 + cast(strftime('%M', ${column} / 1000, 'unixepoch', 'localtime') as integer))`
  return sql<number>`(cast(julianday(${localDate}) - julianday(${anchorDay}) as integer) * ${slotsPerDay} + cast(${localMinuteOfDay} / ${intervalMinutes} as integer))`
}

/** 趋势图的桶号：走趋势桶宽（与图上的柱子一一对应）。 */
function trendBucketIndex(column: AnySQLiteColumn, buckets: AnalyticsBuckets): SQL<number> {
  return bucketIndex(column, buckets.trendAnchorDayMs, buckets.trendIntervalMs)
}

/** 热力图的桶号：走热力桶宽（比趋势桶细，格数也更多）。 */
function heatBucketIndex(column: AnySQLiteColumn, buckets: AnalyticsBuckets): SQL<number> {
  return bucketIndex(column, buckets.trendAnchorDayMs, buckets.heatIntervalMs)
}

/**
 * 本地日期的 SQL 表达式（`YYYY-MM-DD`）：与 `@common/analytics-buckets` 的 `formatLocalDate`
 * 一一对应，改动必须同时落到两处。
 *
 * 用本地日历而不是 UTC 切天：不然东八区的「今天」会从 08:00 开始，一天里最早那几格
 * 会被算到昨天去。
 */
function localDateExpression(column: AnySQLiteColumn): SQL<string> {
  return sql<string>`date(${column} / 1000, 'unixepoch', 'localtime')`
}

type TrendBucketRow = TrendUsageRow & { bucket: number }

/** 按桶清单补齐空桶：没数据的桶也给一个全 0 的点，图表的时间轴才是连续的。 */
function fillTrendBuckets(buckets: AnalyticsBuckets, rows: TrendBucketRow[]): UsageTrendPoint[] {
  const byIndex = new Map(rows.map(row => [row.bucket, row]))
  return resolveTrendBuckets(buckets).map(slot => normalizeTrendPoint({ ...byIndex.get(slot.index), label: slot.label }))
}

/** 按桶清单补齐空格：与 {@link fillTrendBuckets} 同理，只是桶宽更细、格数更多。 */
function fillHeatBuckets(buckets: AnalyticsBuckets, rows: HeatBucketRow[]): UsageHeatBucketRow[] {
  const byIndex = new Map(rows.map(row => [row.bucket, row]))
  return resolveHeatBuckets(buckets).map(slot => {
    const row = byIndex.get(slot.index)
    return { label: slot.label, requests: row?.requests ?? 0, success: row?.success ?? 0, failed: row?.failed ?? 0, totalTokens: row?.totalTokens ?? 0 }
  })
}

function normalizeTrendPoint(row: TrendPointRow): UsageTrendPoint {
  return { label: row.label, inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, cachedInputTokens: row.cachedInputTokens ?? 0, cacheCreationInputTokens: row.cacheCreationInputTokens ?? 0, reasoningTokens: row.reasoningTokens ?? 0 }
}

/** SQL 产出的热力行（只有桶号，没有标签）与补齐后的热力格（有标签、有零值）是两个形状。 */
type HeatBucketRow = Omit<UsageHeatBucketRow, 'label'> & { bucket: number }

/** 热力图里的一格：桶标签由桶清单赋上，SQL 只产出数字。 */
export interface UsageHeatBucketRow {
  label: string
  requests: number
  success: number
  failed: number
  totalTokens: number
}

/**
 * 用量分布热力图：**按热力桶分组**，一格一桶。
 *
 * 粒度不在这里另选：分桶用的是同一个 `bucketIndex` 表达式，只是桶宽换成
 * `heatIntervalMs`（比趋势桶细，见 `HEAT_TARGET_CELLS`）——「今日 10 分钟一格、
 * 近 7 天 1 小时一格、近 30 天 4 小时一格」这条规则只写在 `@common/analytics-buckets` 一处。
 *
 * 请求数与 token 一次查完：用量表先按请求聚好再左连接回请求表（同 {@link getUsageTrend}），
 * 中间结果是「桶」而不是「桶 × 用量行」。没数据的桶由 JS 补零——包括还没到的时间段：
 * 热力图的格数按范围的完整时长规划（今日恒为 144 格），空着的时段就是空格子。
 */
export async function getUsageHeat(buckets: AnalyticsBuckets): Promise<UsageHeatBucketRow[]> {
  const pivot = buildRequestUsagePivot(buckets.sinceMs)
  const rows = getDataDb()
    .select({
      bucket: heatBucketIndex(requestLogs.createdTime, buckets).as('bucket'),
      requests: sql<number>`count(*)`.as('requests'),
      success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
      failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
      // 请求级总 token = 输入 + 输出，与统计卡的口径一致（`raw` 行不参与，见 `TOTAL_REQUEST_TOKENS`）。
      totalTokens: sql<number>`coalesce(sum(${pivot.inputTokens}), 0) + coalesce(sum(${pivot.outputTokens}), 0)`.as('totalTokens'),
    })
    .from(requestLogs)
    .leftJoin(pivot, eq(pivot.requestId, requestLogs.id))
    .where(gte(requestLogs.createdTime, buckets.sinceMs))
    .groupBy(sql`bucket`)
    .all()
  return fillHeatBuckets(buckets, rows)
}

/**
 * 请求来源统计。
 *
 * 属性与用量都存在「一请求多行」的表里。两张表各自**先按请求聚合好**（各带自己的
 * 时间窗），再左连接回请求表：回查次数因此是常数（两次分组），不随请求数增长。
 *
 * `request_attributes` 的主键是 `(requestId, key)`，所以同一个 key 最多只有一行，
 * `max(case when key = ... end)` 取到的就是那一行。
 */
export async function getRequestSourceStats(sinceMs: number, limit = 20): Promise<RequestSourceStat[]> {
  const attributes = getDataDb().select({
    requestId: requestAttributes.requestId,
    source: sql<string>`max(case when ${requestAttributes.key} = 'request.source' then ${requestAttributes.value} end)`.as('source'),
    category: sql<string>`max(case when ${requestAttributes.key} = 'client.category' then ${requestAttributes.value} end)`.as('category'),
  }).from(requestAttributes).where(gte(requestAttributes.createdTime, sinceMs)).groupBy(requestAttributes.requestId).as('request_attribute_pivot')
  const usages = getDataDb().select({
    requestId: requestUsages.requestId,
    tokens: sql<number>`sum(${TOTAL_REQUEST_TOKENS})`.as('tokens'),
  }).from(requestUsages).where(gte(requestUsages.createdTime, sinceMs)).groupBy(requestUsages.requestId).as('request_usage_pivot')
  const rows = getDataDb().select({
    source: sql<string>`coalesce(${attributes.source}, 'unknown')`.as('source'),
    category: sql<string>`coalesce(${attributes.category}, 'unknown')`.as('category'),
    requests: sql<number>`count(*)`.as('requests'),
    success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
    failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
    totalTokens: sql<number>`coalesce(sum(${usages.tokens}), 0)`.as('totalTokens'),
    // 进行中的请求还没有结果，不参与平均。
    avgLatency: sql<number>`coalesce(avg(case when ${requestLogs.status} <> 'pending' then ${requestLogs.totalDurationMilliseconds} end), 0)`.as('avgLatency'),
  }).from(requestLogs)
    .leftJoin(attributes, eq(attributes.requestId, requestLogs.id))
    .leftJoin(usages, eq(usages.requestId, requestLogs.id))
    .where(gte(requestLogs.createdTime, sinceMs))
    .groupBy(sql`source`, sql`category`)
    .orderBy(sql`requests desc`)
    .limit(limit)
    .all()
  return rows.map(row => ({ source: row.source, category: row.category, requests: row.requests ?? 0, success: row.success ?? 0, failed: row.failed ?? 0, totalTokens: row.totalTokens ?? 0, avgLatencyMs: row.avgLatency ?? 0 }))
}

// 提供方统计的时间窗一律用「尝试表自己的 `createdTime`」。
//
// 尝试行的写入时间必然不早于它所属请求的创建时间，所以「请求落在窗口内」与
// 「尝试落在窗口内」是同一批尝试；而按尝试表过滤才能用上
// `(providerId, createdTime)` 索引——按请求表过滤时，SQLite 只能先按 providerId
// 把该提供方的全部历史尝试捞出来，再逐行回查请求与时间窗比对，代价与时间窗无关。

/**
 * 提供方统计的「一次调用」以「一次上游尝试」为单位，字段名因此叫 attempts。
 *
 * 命中率与模型表同一口径：分子分母都取**成功的尝试**（见 `getModelStats` 的 `successOnly`）。
 * 失败尝试的上游用量要么根本没有、要么只覆盖半截响应，算进分母会让命中率随失败率一起漂移。
 */
export interface ProviderStat { providerId: string; providerName: string; attempts: number; success: number; failed: number; cacheHitRate: number | null }

function providerStatSelect(pivot: AttemptUsagePivot) {
  const successOnly = (type: UsageTokenType) => sql<number>`coalesce(sum(case when ${requestAttempts.status} = 'success' then ${pivot[type]} else 0 end), 0)`
  return {
    providerId: requestAttempts.providerId,
    // 分组键（providerId）已经确定了名称，直接把它带出来即可，不必每行再回查一次。
    providerName: sql<string>`max(${requestAttempts.providerName})`.as('providerName'),
    attempts: sql<number>`count(*)`.as('attempts'),
    success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
    failed: sql<number>`sum(case when ${requestAttempts.status} = 'failed' then 1 else 0 end)`.as('failed'),
    cachedInputTokens: successOnly('cachedInputTokens').as('cachedInputTokens'),
    inputTokens: successOnly('inputTokens').as('inputTokens'),
  }
}

type ProviderStatRow = { providerId: string; providerName: string; attempts: number | null; success: number | null; failed: number | null; cachedInputTokens: number | null; inputTokens: number | null }

function normalizeDevelopmentProviderName(providerId: string, providerName: string): string {
  // 开发种子数据给提供方名带过 `（开发示例）` 后缀，库里可能还留着这样的行，读的时候就地去掉。
  return providerId.startsWith('prov_dev_') ? providerName.replace(/（开发示例）$/, '') : providerName
}

function mapProviderStat(row: ProviderStatRow): ProviderStat {
  return {
    providerId: row.providerId,
    providerName: normalizeDevelopmentProviderName(row.providerId, row.providerName),
    attempts: row.attempts ?? 0,
    success: row.success ?? 0,
    failed: row.failed ?? 0,
    cacheHitRate: cacheHitRate(row.cachedInputTokens ?? 0, row.inputTokens ?? 0),
  }
}

export async function getProviderStats(sinceMs: number): Promise<ProviderStat[]> {
  const pivot = buildAttemptUsagePivot(sinceMs)
  const rows = getDataDb().select(providerStatSelect(pivot)).from(requestAttempts)
    .leftJoin(pivot, eq(pivot.attemptId, requestAttempts.id))
    .where(gte(requestAttempts.createdTime, sinceMs))
    .groupBy(requestAttempts.providerId)
    .orderBy(sql`attempts desc`)
    .all()
  return rows.map(mapProviderStat)
}

export async function getProviderStat(providerId: string, sinceMs: number): Promise<ProviderStat | null> {
  const pivot = buildAttemptUsagePivot(sinceMs)
  const row = getDataDb().select(providerStatSelect(pivot)).from(requestAttempts)
    .leftJoin(pivot, eq(pivot.attemptId, requestAttempts.id))
    .where(and(eq(requestAttempts.providerId, providerId), gte(requestAttempts.createdTime, sinceMs)))
    .groupBy(requestAttempts.providerId)
    .get()
  return row ? mapProviderStat(row) : null
}

export interface ProviderRequestTrendPoint { label: string; success: number; failed: number; successRate: number; avgLatencyMs: number }
export interface ProviderAnalyticsTrend { requestTrend: ProviderRequestTrendPoint[]; tokenTrend: UsageTrendPoint[]; totalTokens: number }

type ProviderTrendRow = TrendPointRow & {
  label: string
  attempts?: number | null
  success?: number | null
  failed?: number | null
  avgLatencyMs?: number | null
  totalTokens?: number | null
}

/**
 * 尝试级用量透视：把「一种类型一行」拧成「一列一种类型」，**先按尝试聚合、再左连接**。
 *
 * 用一条透视聚合，而不是为每一条尝试各回扫一次用量表的五个相关子查询：
 * 后者在分组时的代价是「尝试数 × 5 次索引查找」，前者一次分组即可。
 *
 * 逐类型取值意味着 `raw` 行（上游原始报文，数值列为 NULL）不会进入任何一列。
 */
function buildAttemptUsagePivot(sinceMs: number) {
  return getDataDb()
    .select({ attemptId: attemptUsages.attemptId, ...usagePivotColumns(attemptUsages.type, attemptUsages.value) })
    .from(attemptUsages)
    .where(gte(attemptUsages.createdTime, sinceMs))
    .groupBy(attemptUsages.attemptId)
    .as('attempt_usage_pivot')
}

type AttemptUsagePivot = ReturnType<typeof buildAttemptUsagePivot>

/** 透视结果按行求和（未命中透视的尝试按 0 算），并额外给出「输入 + 输出」的派生总值。 */
function providerTrendSelect(pivot: AttemptUsagePivot) {
  const sumOf = (type: UsageTokenType) => sql<number>`coalesce(sum(${pivot[type]}), 0)`
  const sums = { inputTokens: sumOf('inputTokens').as('inputTokens'), outputTokens: sumOf('outputTokens').as('outputTokens'), cachedInputTokens: sumOf('cachedInputTokens').as('cachedInputTokens'), cacheCreationInputTokens: sumOf('cacheCreationInputTokens').as('cacheCreationInputTokens'), reasoningTokens: sumOf('reasoningTokens').as('reasoningTokens') }
  return {
    attempts: sql<number>`count(*)`.as('attempts'),
    success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
    failed: sql<number>`sum(case when ${requestAttempts.status} = 'failed' then 1 else 0 end)`.as('failed'),
    avgLatencyMs: sql<number>`coalesce(avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end), 0)`.as('avgLatencyMs'),
    ...sums,
    // 总 token 是派生值：输入 + 输出；`raw` 行不放数值，不会进入其中。
    totalTokens: sql<number>`${sumOf('inputTokens')} + ${sumOf('outputTokens')}`.as('totalTokens'),
  }
}

export async function getProviderAnalyticsTrend(providerId: string, buckets: AnalyticsBuckets): Promise<ProviderAnalyticsTrend> {
  // 时间窗按尝试表自己的 `createdTime` 收窄（与请求窗口等价，见 `getProviderStats` 上方注释），
  // 但分桶标签仍然取请求的创建时间：一次请求属于哪一天、哪个时段，是请求自己的属性。
  const bucket = trendBucketIndex(requestLogs.createdTime, buckets)
  const pivot = buildAttemptUsagePivot(buckets.sinceMs)
  const rows = getDataDb().select({ bucket: bucket.as('bucket'), ...providerTrendSelect(pivot) })
    .from(requestAttempts)
    .innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id))
    .leftJoin(pivot, eq(pivot.attemptId, requestAttempts.id))
    .where(and(gte(requestAttempts.createdTime, buckets.sinceMs), eq(requestAttempts.providerId, providerId)))
    .groupBy(sql`bucket`)
    .all()
  const byIndex = new Map(rows.map(row => [row.bucket, row]))
  const slots = resolveTrendBuckets(buckets)
  const trendRows = slots.map(slot => ({ ...byIndex.get(slot.index), label: slot.label }))
  return {
    requestTrend: trendRows.map(normalizeProviderRequestTrendPoint),
    tokenTrend: trendRows.map(normalizeTrendPoint),
    totalTokens: rows.reduce((total, row) => total + (row.totalTokens ?? 0), 0),
  }
}

function normalizeProviderRequestTrendPoint(row: ProviderTrendRow): ProviderRequestTrendPoint {
  const success = row.success ?? 0
  const failed = row.failed ?? 0
  const attempts = row.attempts ?? 0
  return { label: row.label, success, failed, successRate: attempts > 0 ? success / attempts : 0, avgLatencyMs: row.avgLatencyMs ?? 0 }
}

/**
 * 单个上游模型的使用情况。
 *
 * 所有指标都以「上游尝试」为口径（因此计数字段命名为 attempts）：
 * 一个请求可能产生多次尝试，把请求级指标与尝试级指标混在同一行里算
 * 平均，结果没有任何含义。
 *
 * 除了 `attempts` / `success` 两个计数，其余指标一律只看**成功的尝试**：
 * 失败尝试既没有可用输出也没有完整耗时，混进来会让平均与比率失真（尤其是
 * 以尝试耗时作分母的 TPS）。
 */
export interface ModelStat { providerModelId: string; providerModelName: string; providerId: string; providerName: string; attempts: number; success: number; avgTtftMs: number | null; cachedInputTokens: number; inputTokens: number; outputTokens: number; speedOutputTokens: number; speedDurationMs: number }

export async function getModelStats(sinceMs: number, limit = 10, providerId?: string): Promise<ModelStat[]> {
  // 时间窗同样按尝试表自己的 `createdTime` 收窄（等价性见 `getProviderStats` 上方注释）：
  // 这里除了用量，没有任何指标来自请求表，因此整个连接都可以去掉。
  const filters = [gte(requestAttempts.createdTime, sinceMs)]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const pivot = buildAttemptUsagePivot(sinceMs)
  // 失败尝试的用量不算进这些列；未命中透视的尝试以 0 参与。
  const successOnly = (type: UsageTokenType) => sql<number>`coalesce(sum(case when ${requestAttempts.status} = 'success' then ${pivot[type]} else 0 end), 0)`
  // 参与速度计算的尝试：成功、有输出，且耗时为正。
  // 分子与分母必须来自同一批样本，见下面 `speedOutputTokens` 的注释。
  const speedSampleBasis = sql`${requestAttempts.status} = 'success' and ${requestAttempts.durationMilliseconds} > 0 and coalesce(${pivot.outputTokens}, 0) > 0`
  const rows = getDataDb().select({
    // 排行单位是「上游模型」：一个 providerModelId 只属于一个提供方，所以只按它分组——
    // 带上 providerId 会让提供方改绑后留在尝试行里的旧快照把同一个模型拆成两行，
    // 排行榜上同一个模型出现两次，还要各占一个 TOP 名额。
    providerModelId: requestAttempts.providerModelId,
    providerModelName: requestAttempts.providerModelName,
    providerId: requestAttempts.providerId,
    providerName: requestAttempts.providerName,
    // 上面四个是「裸列」，取值来源由下面这个唯一的 max() 决定：
    // SQLite 在查询里只有 min()/max() 这一种极值聚合、且只出现一次时，
    // 所有裸列都取该极值所在的那一行。于是模型名与提供方一定来自同一条尝试记录，
    // 不会出现「A 家的 id 配 B 家的名字」。**新增 min()/max() 会破坏这个约定。**
    latestAttemptCreatedTime: sql<number>`max(${requestAttempts.createdTime})`.as('latestAttemptCreatedTime'),
    attempts: sql<number>`count(*)`.as('attempts'),
    success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
    avgTtft: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.ttftMilliseconds} end)`.as('avgTtft'),
    cachedInputTokens: successOnly('cachedInputTokens').as('cachedInputTokens'),
    inputTokens: successOnly('inputTokens').as('inputTokens'),
    outputTokens: successOnly('outputTokens').as('outputTokens'),
    // 速度的两个合计值由 `speedSampleBasis` 筛出同一批尝试，缺一不可：
    // 分母是成功尝试的**整段耗时**，不扣首字延迟——上游报的输出 Token 里含推理 Token，
    // 而推理 Token 正是在首字延迟那段时间产出的，减掉首字等于「Token 留下、产它的时间挖走」；
    // 首字迟到的响应还会让扣完的分母缩成几十毫秒，除出几千 TPS 的假值（口径见 `@common/metrics`）。
    // 耗时不为正、没有输出 Token 的尝试算不出速度，它的输出 Token 也就不能只留在分子里。
    speedOutputTokens: sql<number>`coalesce(sum(case when ${speedSampleBasis} then ${pivot.outputTokens} else 0 end), 0)`.as('speedOutputTokens'),
    speedDurationMs: sql<number>`coalesce(sum(case when ${speedSampleBasis} then ${requestAttempts.durationMilliseconds} else 0 end), 0)`.as('speedDurationMs'),
  }).from(requestAttempts)
    .leftJoin(pivot, eq(pivot.attemptId, requestAttempts.id))
    .where(and(...filters))
    .groupBy(requestAttempts.providerModelId)
    // 尝试数相同时用 id 兜底：排行榜不该在多次刷新之间自己换位置。
    .orderBy(sql`attempts desc, ${requestAttempts.providerModelId} asc`)
    .limit(limit)
    .all()
  return rows.map(row => ({ providerModelId: row.providerModelId, providerModelName: row.providerModelName, providerId: row.providerId, providerName: normalizeDevelopmentProviderName(row.providerId, row.providerName), attempts: row.attempts ?? 0, success: row.success ?? 0, avgTtftMs: row.avgTtft ?? null, cachedInputTokens: row.cachedInputTokens ?? 0, inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, speedOutputTokens: row.speedOutputTokens ?? 0, speedDurationMs: row.speedDurationMs ?? 0 }))
}

export interface LatencyBucket { range: string; count: number }

/**
 * 把 TTFT 归到桶号的 SQL 表达式（桶号与 `formatLatencyBinLabel` 一一对应）。
 *
 * 桶边界由窗口内的 p95 推出（见 `@common/analytics-buckets`），在这里只展开一次：
 * 分桶与标签都从同一份 `edges` 派生，因此不可能出现「统计的桶」与「画出来的桶」对不上。
 */
function latencyBinIndex(edges: number[]): SQL<number> {
  return sql<number>`case ${sql.join(edges.map((edge, index) => sql`when ${requestAttempts.ttftMilliseconds} < ${edge} then ${index}`), sql` `)} else ${edges.length} end`
}

/**
 * 窗口内 TTFT 的 p95，用来定直方图的桶宽。
 *
 * 取值口径必须与分布本身完全一致（同一批过滤条件）：拿别处的 p95 去切这批样本，
 * 档位就会切在分布之外。排序留在 SQL 内完成——返回的只有一行，而不是把窗口内
 * 十几万个 TTFT 搬进 JS 再排一次（`docs/product/observability.md` §性能）。
 */
function getTtftP95(filters: SQL[]): number | null {
  const ranked = getDataDb().select({
    ttft: requestAttempts.ttftMilliseconds,
    rank: sql<number>`row_number() over (order by ${requestAttempts.ttftMilliseconds})`.as('rank'),
    total: sql<number>`count(*) over ()`.as('total'),
  }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(...filters)).as('ranked_ttft')
  const row = getDataDb().select({ ttft: ranked.ttft }).from(ranked).where(sql`${ranked.rank} = max(1, cast(${ranked.total} * 0.95 as integer))`).get()
  return row?.ttft ?? null
}

// 按 TTFT 分布统计直方图。
//
// 口径是「成功的上游尝试」：TTFT 是每次尝试自己的事实
// （`request_attempts.ttftMilliseconds`），只有这样才能把它正确地归到
// 真正产生这段输出的提供方身上。使用请求级指标 + EXISTS 会让一次失败转
// 移的请求同时计入它尝试过的每一个提供方。
// 只看成功的尝试与 `avgTtftMs` 保持同一口径：首字已经到达但随后失败的
// 尝试，代表不了一次可用的响应。
//
// 分桶直接在 SQL 里做：`group by 桶号` 只为出现过的桶返回一行。
// 把窗口内每一个 TTFT 都取回 JS 再排序分桶，等于为了一张直方图
// 把几十万个整数搬进内存再排一次序。
//
// 空档由 JS 补齐：直方图的形状靠「没有样本的档位高度为 0」才成立，
// 只画出现过的档会让横轴被压缩成等距的几根柱子，读起来像另一个分布。
// 尾部全空的档则要去掉：p95 之上留的余量与开口桶都可能是 0，
// 留着它们只会让图的最右边多出两根永远为零的柱子。
export async function getLatencyDistribution(sinceMs: number, targetBins: number, providerId?: string): Promise<LatencyBucket[]> {
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestLogs.status, 'success'), sql`${requestAttempts.ttftMilliseconds} is not null`]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const p95 = getTtftP95(filters)
  if (p95 === null) return []
  const edges = resolveLatencyBinEdges(p95, targetBins)
  const rows = getDataDb()
    .select({ bucket: latencyBinIndex(edges).as('bucket'), count: sql<number>`count(*)`.as('count') })
    .from(requestAttempts)
    .innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id))
    .where(and(...filters))
    .groupBy(sql`bucket`)
    .all()
  const counts = new Map(rows.map(row => [row.bucket, row.count]))
  const buckets = Array.from({ length: edges.length + 1 }, (_, index) => ({ range: formatLatencyBinLabel(edges, index), count: counts.get(index) ?? 0 }))
  let lastNonEmpty = 0
  buckets.forEach((bucket, index) => {
    if (bucket.count > 0) lastNonEmpty = index
  })
  return buckets.slice(0, lastNonEmpty + 1)
}

export interface FailureReasonStat { reason: FailureReasonCategory; count: number }

export async function getFailureReasons(sinceMs: number, providerId?: string): Promise<FailureReasonStat[]> {
  const finalFailedAttempt = sql`${requestAttempts.attemptIndex} = (SELECT max(final_attempt.attemptIndex) FROM request_attempts AS final_attempt WHERE final_attempt.requestId = ${requestAttempts.requestId} AND final_attempt.status = 'failed')`
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestLogs.status, 'failed'), eq(requestAttempts.status, 'failed' as RequestStatus), finalFailedAttempt]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const rows = getDataDb().select({ errorCode: requestAttempts.errorCode, count: sql<number>`count(distinct ${requestAttempts.requestId})`.as('count') }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(...filters)).groupBy(requestAttempts.errorCode).orderBy(sql`count desc`).all()
  // 桶名是机器码，界面自己翻：服务端不该决定标签长什么样（见 `FAILURE_REASON_CATEGORIES`）。
  const categories: Record<FailureReasonCategory, number> = { TIMEOUT: 0, RATE_LIMITED: 0, SERVER_ERROR: 0, AUTH_FAILED: 0, OTHER: 0 }
  for (const row of rows) {
    const code = row.errorCode ?? 'UNKNOWN'
    if (code.includes('TIMEOUT') || code.includes('ECONNRESET') || code.includes('ETIMEDOUT')) categories.TIMEOUT += row.count
    else if (code.includes('429') || code.includes('RATE_LIMIT')) categories.RATE_LIMITED += row.count
    else if (/Status_5\d\d/.test(code) || code.includes('UPSTREAM_ERROR') || code.includes('SERVER_ERROR')) categories.SERVER_ERROR += row.count
    else if (code.includes('401') || code.includes('403') || code.includes('AUTH')) categories.AUTH_FAILED += row.count
    else categories.OTHER += row.count
  }
  return Object.entries(categories).map(([reason, count]) => ({ reason: reason as FailureReasonCategory, count })).filter(row => row.count > 0).sort((left, right) => right.count - left.count)
}
