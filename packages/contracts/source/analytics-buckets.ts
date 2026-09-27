/**
 * 分析页各图的分桶规则。
 *
 * 「粒度」是这个模块唯一的话题：窗口有多长，决定了趋势图一根柱子覆盖多久、热力图一格代表多久、
 * 直方图切几档。规则集中在这里，是因为同一套桶要在三处同时成立——SQL 分桶、标签生成、界面坐标轴。
 * 任何一处凭印象写死一个步长，就会出现「窗口是 30 天、柱子还是 15 分钟」，或者
 * 「统计出来的桶」与「画出来的桶」对不上。
 */

import type { AnalyticsRange } from './schemas'

/** 一天的毫秒数。只用于长度换算：本地的一天可能是 23 或 25 小时，日历推进必须交给 `Date`。 */
export const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

const MINUTE_MS = 60 * 1000
const MINUTES_PER_DAY = 24 * 60

/**
 * 趋势图与热力图共用的候选步长（分钟）。
 *
 * 三条约束一起定下了这张表：
 * 1. 全部整除 1440，桶边界因此落在本地整点或整天上——「每 6 小时」的柱子起点永远是
 *    00:00 / 06:00 / 12:00 / 18:00，而不是从查询时刻往前推出来的随机分钟数；
 * 2. 最细到 5 分钟：再细的画面对「今天的用量」没有新信息，柱子只会细到看不清；
 * 3. 最粗到 1 天：再粗（比如「每 3 天」）会让一周之内的变化整个消失。
 *
 * 表里的 10 分钟、60 分钟、4 小时几档是热力图挑出来的（见 {@link HEAT_TARGET_CELLS}），
 * 趋势图用不上——它的上限定得比热力图紧得多。
 */
const INTERVAL_STEPS_MINUTES = [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720, 1440]

/**
 * 趋势图一张卡片上最多画多少根柱子，用来反向挑选步长。
 *
 * 卡片内宽按 800px 量级估算，60 根柱子每根还有 13px，柱子本身仍看得清、也仍能靠 hover 读数。
 * 结果：「今天」随当天时间从 5 分钟一路粗到 30 分钟（最多 60 根）；「近 7 天」是 3 小时（57 根）；
 * 「近 30 天」落到表里最粗的一档，一天一根（31 根）——两端各有一个不完整的桶，
 * 所以桶数会比「跨度 ÷ 步长」多一个。
 *
 * 这里宁可画得密一点：柱子稀了（比如「近 7 天」一天一根）看不出一天之内的起伏，
 * 而柱子密了最差也只是看起来细，hover 与 tooltip 依旧逐桶读数。
 */
export const TREND_MAX_BUCKETS = 60

/**
 * 用量分布最多铺多少格：按范围的**完整时长**反向挑粒度。
 *
 * 比趋势图宽松得多，因为两者对「密」的容忍度完全不同：趋势图的柱子要容下坐标轴与
 * hover 命中区，热力图只是一张密度纹理——格子里没有文字，读数靠 tooltip，20px 上下
 * 仍然逐格可读。取 180 撞上三个刚刚好的档位：
 *
 * | 范围 | 格宽 | 格数 |
 * | --- | --- | --- |
 * | 今天 | 10 分钟 | 144 |
 * | 近 7 天 | 1 小时 | 169 |
 * | 近 30 天 | 4 小时 | 181 |
 *
 * 「今天」的窗口本来就是完整的一整天，所以格数是死的 144：时间往前走时画面不会一格一格
 * 长出来，还没到的时段就是空格子。另外两个范围的窗口是「此刻往前推」，起点与终点各占一个
 * 不完整的桶，格数因此比「跨度 ÷ 格宽」多一个。
 *
 * 格宽不再细分（比如近 7 天用半小时 = 336 格）不是为了省事：格数一多，方形格就会被挤成
 * 1px 不到的点，整块图从「能读的分布」退化成一片噪声。
 */
export const HEAT_TARGET_CELLS = 180

/**
 * TTFT 直方图的候选桶宽（毫秒），全部取自 1-2-5 序列。
 *
 * 宽度本身是给人读的数：50、100、200 一眼就能换算成秒；而「按 p95 均分」算出来的
 * 37.4ms 这种宽度读起来是一串没有意义的小数，还会因为窗口里多了一个样本而整体挪位。
 */
const LATENCY_BIN_STEPS_MS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000]

/**
 * TTFT 直方图的档数上限。
 *
 * 不按窗口长短分档：能画几档由窗口内的 p95 与 1-2-5 阶梯共同决定，窗口长短只影响样本量。
 * 上限取 16 而不是「正好 10」：阶梯是量化的，同一个 p95 在相邻两档步长下算出的档数会从
 * 10 档直接跳到 16 档（500ms 的 p95 在 50ms 步长下是 12 档，100ms 步长下只剩 8 档），
 * 上限必须留出余量，「至少 10 档」这个下限才守得住。
 */
const LATENCY_TARGET_BINS = 16

/** 一次「范围 → 粒度」推导的全部结果。 */
export interface AnalyticsBuckets {
  /** 窗口起点：`today` 是本地零点，`7d` / `30d` 是「此刻往前推」。 */
  sinceMs: number
  /** 趋势图每一根柱子覆盖的时长。 */
  trendIntervalMs: number
  /** 桶号的零点：窗口起点所在的那一天（本地零点）。桶号是「距这一天的墙钟分钟数 ÷ 桶宽」。 */
  trendAnchorDayMs: number
  /** 趋势数组的长度：从窗口起点所在的桶到此刻所在的桶，空桶也要占位。 */
  trendBucketCount: number
  /** 热力图一格覆盖的时长。比趋势桶细，且按范围的完整时长挑（见 {@link HEAT_TARGET_CELLS}）。 */
  heatIntervalMs: number
  /** 热力图的格数：`today` 是整天的格数，`7d` / `30d` 是完整时长再加「此刻」所在的那个半截桶。 */
  heatBucketCount: number
  /** TTFT 直方图的档数上限；实际档数还要看窗口内的 p95（见 {@link resolveLatencyBinEdges}）。 */
  latencyTargetBins: number
}

/** 一个时间桶的编号与标签：`index` 与服务端 SQL 算出的桶号是同一个数。趋势图与热力图共用。 */
export interface BucketSlot {
  index: number
  label: string
}

/** 一个范围的名义总时长（`today` 一整天，`7d` / `30d` 各 7 / 30 天毫秒数）。点数按它规划。 */
export function resolveRangeSpanMs(range: AnalyticsRange): number {
  return (range === 'today' ? 1 : range === '7d' ? 7 : 30) * DAY_MILLISECONDS
}

/**
 * 由一个时间范围算出窗口与三张图各自的粒度。
 *
 * 粒度不写死：它是「范围」的推论，和窗口一起算出来才不会有对不上的组合。
 */
export function resolveAnalyticsBuckets(range: AnalyticsRange, nowMs = Date.now()): AnalyticsBuckets {
  const spanMs = resolveRangeSpanMs(range)
  // 窗口长度是三个完整时长：`today` 从本地零点起算（一整天），`7d` / `30d` 从此刻往前推。
  const sinceMs = range === 'today' ? startOfLocalDay(nowMs) : nowMs - spanMs
  const trendAnchorDayMs = startOfLocalDay(sinceMs)
  const trendIntervalMs = resolveTrendIntervalMs(trendAnchorDayMs, sinceMs, nowMs)
  const heatIntervalMs = resolveHeatIntervalMs(spanMs)
  return {
    sinceMs,
    trendIntervalMs,
    trendAnchorDayMs,
    trendBucketCount: resolveTrendBucketCount(trendAnchorDayMs, sinceMs, nowMs, trendIntervalMs),
    heatIntervalMs,
    heatBucketCount: resolveHeatBucketCount(trendAnchorDayMs, sinceMs, nowMs, heatIntervalMs, spanMs),
    latencyTargetBins: LATENCY_TARGET_BINS,
  }
}

/** 趋势图每一根柱子覆盖多久：取「桶数不超上限」的最细一档。 */
export function resolveTrendIntervalMs(anchorDayMs: number, sinceMs: number, nowMs: number): number {
  for (const minutes of INTERVAL_STEPS_MINUTES) {
    const intervalMs = minutes * MINUTE_MS
    if (resolveTrendBucketCount(anchorDayMs, sinceMs, nowMs, intervalMs) <= TREND_MAX_BUCKETS) return intervalMs
  }
  return lastIntervalStepMs()
}

/** 趋势数组的长度：含窗口起点与「此刻」各所在的那两个桶。 */
export function resolveTrendBucketCount(anchorDayMs: number, sinceMs: number, nowMs: number, intervalMs: number): number {
  return trendBucketIndexAt(anchorDayMs, nowMs, intervalMs) - trendBucketIndexAt(anchorDayMs, sinceMs, intervalMs) + 1
}

/**
 * 桶号：以 `anchorDayMs`（某个本地零点）为 0 号桶，按**墙钟分钟数**递增。
 *
 * 墙钟而不是绝对毫秒：跨夏令时的 23 / 25 小时天仍要按用户手表上的小时切桶，
 * 否则那一天的柱子会整体错开一小时。服务端的 SQL 分桶表达的是同一个式子
 * （见 `analytics-store.ts` 的 `trendBucketIndex`），两边必须同时改。
 */
export function trendBucketIndexAt(anchorDayMs: number, ms: number, intervalMs: number): number {
  const minutes = localDayOffset(anchorDayMs, ms) * MINUTES_PER_DAY + minutesOfLocalDay(ms)
  return Math.floor(minutes / (intervalMs / MINUTE_MS))
}

/** 桶标签：桶起点的本地时间，不足一天是 `YYYY-MM-DD HH:MM`，一天及以上只写 `YYYY-MM-DD`。 */
export function trendBucketLabelAt(anchorDayMs: number, index: number, intervalMs: number): string {
  return formatTrendBucketLabel(trendBucketStartMs(anchorDayMs, index, intervalMs), intervalMs)
}

/** 桶起点的本地时间戳；日期进位的规范化交给 `Date`，跨月跨年与夏令时都对。 */
function trendBucketStartMs(anchorDayMs: number, index: number, intervalMs: number): number {
  const totalMinutes = index * (intervalMs / MINUTE_MS)
  const minuteOfDay = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const dayOffset = Math.floor(totalMinutes / MINUTES_PER_DAY)
  const anchor = new Date(anchorDayMs)
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dayOffset, Math.floor(minuteOfDay / 60), minuteOfDay % 60).getTime()
}

/** 趋势图的桶清单（编号 + 标签），按时间递增；服务端按这份清单补齐空桶。 */
export function resolveTrendBuckets(buckets: AnalyticsBuckets): BucketSlot[] {
  return resolveBucketSlots(buckets.trendAnchorDayMs, buckets.sinceMs, buckets.trendIntervalMs, buckets.trendBucketCount)
}

/**
 * 热力图一格覆盖多久：取「按完整时长规划的格数不超上限」的最细一档。
 *
 * 只看完整时长，不看「已经过去多少」：`today` 在凌晨 6 点就要按 144 格画好，而不是当时
 * 只画 36 格、随时间推移再一格格长出来——格宽一旦随当前时刻漂移，同一张图在两个时刻
 * 的格子含义就不一样了。
 */
export function resolveHeatIntervalMs(spanMs: number): number {
  for (const minutes of INTERVAL_STEPS_MINUTES) {
    const intervalMs = minutes * MINUTE_MS
    if (Math.ceil(spanMs / intervalMs) <= HEAT_TARGET_CELLS) return intervalMs
  }
  return lastIntervalStepMs()
}

/**
 * 热力图的格数：按完整时长规划的格数，与「已经走到的最后一个桶」取大者。
 *
 * 两者在正常情况下相等（`today` 恒为整天的 144 格）；取大者只是为了兜住「此刻落在规划
 * 终点之外」这种边界（比如时钟被往前调过），免得最后一个已有数据的桶算不进清单里。
 */
export function resolveHeatBucketCount(anchorDayMs: number, sinceMs: number, nowMs: number, intervalMs: number, spanMs: number): number {
  const planned = Math.ceil(spanMs / intervalMs)
  const elapsed = trendBucketIndexAt(anchorDayMs, nowMs, intervalMs) - trendBucketIndexAt(anchorDayMs, sinceMs, intervalMs) + 1
  return Math.max(planned, elapsed)
}

/** 热力图的格子清单：与 {@link resolveTrendBuckets} 同一套编号与标签，只是格宽更细。 */
export function resolveHeatBuckets(buckets: AnalyticsBuckets): BucketSlot[] {
  return resolveBucketSlots(buckets.trendAnchorDayMs, buckets.sinceMs, buckets.heatIntervalMs, buckets.heatBucketCount)
}

/** 按「窗口起点所在的桶」往后取若干格，编号与标签一起算出来。 */
function resolveBucketSlots(anchorDayMs: number, sinceMs: number, intervalMs: number, count: number): BucketSlot[] {
  const first = trendBucketIndexAt(anchorDayMs, sinceMs, intervalMs)
  return Array.from({ length: count }, (_, offset) => {
    const index = first + offset
    return { index, label: trendBucketLabelAt(anchorDayMs, index, intervalMs) }
  })
}

/** 候选步长都试过还超上限时的兜底：最粗的一档。窗口最长 30 天，正常走不到这里。 */
function lastIntervalStepMs(): number {
  return INTERVAL_STEPS_MINUTES[INTERVAL_STEPS_MINUTES.length - 1] * MINUTE_MS
}

/** 粒度的人话分解：界面据此挑文案（`每 5 分钟` / `每 6 小时` / `每日`），不自己反推。 */
export interface TrendIntervalParts {
  unit: 'minute' | 'hour' | 'day'
  count: number
}

export function trendIntervalParts(intervalMs: number): TrendIntervalParts | null {
  // 桶宽是服务端算完带回来的（`trendIntervalMs`），界面这边只是翻成人话。
  // 拿不到值时返回 `null` 而不是硬算：`Math.round(NaN)` 会写出「每 NaN 分钟用量」，
  // 与其说一句错的，不如这一句不说。
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null
  if (intervalMs >= DAY_MILLISECONDS) return { unit: 'day', count: Math.round(intervalMs / DAY_MILLISECONDS) }
  if (intervalMs >= 60 * MINUTE_MS) return { unit: 'hour', count: Math.round(intervalMs / (60 * MINUTE_MS)) }
  return { unit: 'minute', count: Math.round(intervalMs / MINUTE_MS) }
}

/**
 * TTFT 直方图的桶边界（毫秒）：从 0 起按选定桶宽向上排，p95 落在**倒数第二档之内**，
 * 最后一档留给 p95 以上的慢尾。
 *
 * 桶宽取「把 p95 装进 `targetBins - 2` 档的最细一档」，所以窗口里的 TTFT 越快档位就越细
 * （样本都在 200ms 以内时切到 50ms 一档，秒级时切到 250ms 一档）。
 *
 * 边界从 0 起而不是从最小样本起，是为了让同一个范围的两次刷新边界一致：
 * 跟着最小样本走，多来一个快样本就会把整张图的刻度挪一格。
 *
 * 返回的是**上界**数组：第 i 档是 `[edges[i-1], edges[i])`，最后一档是 `>= edges.at(-1)`
 * 的开口桶——慢尾只给这一个桶，再切十份只会得到十根几乎等高的矮柱子。
 */
export function resolveLatencyBinEdges(p95Ms: number, targetBins: number): number[] {
  const p95 = Math.max(p95Ms, 0)
  const step = resolveLatencyBinStep(p95, targetBins)
  // 至少两条边界：边界只有一条时也仍然是「一张有两档的直方图」，不会退化成单档。
  return Array.from({ length: Math.ceil(p95 / step) + 1 }, (_, index) => (index + 1) * step)
}

function resolveLatencyBinStep(p95Ms: number, targetBins: number): number {
  // 目标档数里先扣掉两档：一档是 p95 之上留出的整档余量（让 p95 落在真实的档里，
  // 而不是压在开口桶的边界上），另一档就是那条开口的慢尾桶。
  const budget = Math.max(1, targetBins - 2)
  for (const step of LATENCY_BIN_STEPS_MS) {
    if (Math.ceil(p95Ms / step) <= budget) return step
  }
  return LATENCY_BIN_STEPS_MS[LATENCY_BIN_STEPS_MS.length - 1]
}

/** 直方图某一档的区间标签：`< 50ms`、`50ms-100ms`、`>= 2s`。`index === edges.length` 是溢出桶。 */
export function formatLatencyBinLabel(edges: number[], index: number): string {
  if (index <= 0) return `< ${formatDuration(edges[0])}`
  if (index >= edges.length) return `>= ${formatDuration(edges[edges.length - 1])}`
  return `${formatDuration(edges[index - 1])}-${formatDuration(edges[index])}`
}

/**
 * 直方图横轴刻度：只写这一档的**上界**（`50ms`、`1s`）。下界就是前一档的上界，写出来只是重复
 * 一整排 `50ms-`；开口的最后一档没有上界，用 `+` 标出（`2s+`）。
 *
 * 这里刻意按 `formatLatencyBinLabel` 写出来的字符串反解：标签的语法只由那个函数定义，
 * 界面拿到的是服务端算好的标签，两边共用一份语法就不会各写各的。
 */
export function formatLatencyBinTick(label: string): string {
  if (label.startsWith('>= ')) return `${label.slice(3)}+`
  if (label.startsWith('< ')) return label.slice(2)
  return label.slice(label.indexOf('-') + 1)
}

/**
 * 区间端点的写法：`500ms`、`1s`、`2.5s`。
 *
 * 与 `@common/metrics` 的 `formatMilliseconds` 刻意不同，不要合并：那个函数格式化的是
 * **一个测量值**（`1.0s`，一位小数让「恰好一秒整」看得见），这里是**区间的端点**（`1s`），
 * 端点带尾随 `.0` 只会把 `1s-2s` 读成 `1.0s-2.0s`。
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  const rounded = Math.round(seconds * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`
}

/** 本地零点：窗口起点与桶标签都按本地日历走，用户看到的「今天」就是他手表上的今天。 */
export function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** `toMs` 比 `fromMs` 晚几个本地日期：跨夏令时的 23 / 25 小时天仍算一整天。 */
export function localDayOffset(fromMs: number, toMs: number): number {
  return Math.round((startOfLocalDay(toMs) - startOfLocalDay(fromMs)) / DAY_MILLISECONDS)
}

/** 本地墙钟的「当天第几分钟」：夏令时会让绝对毫秒与墙钟错开一小时，分桶只能按墙钟走。 */
export function minutesOfLocalDay(ms: number): number {
  const date = new Date(ms)
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * 桶起点的标签：`YYYY-MM-DD HH:MM`，整天粒度只写 `YYYY-MM-DD`。
 *
 * 这是服务端与界面之间的约定，两边都从本模块取，不各写一套格式化。
 */
export function formatTrendBucketLabel(startMs: number, intervalMs: number): string {
  const date = new Date(startMs)
  const day = formatLocalDate(startMs)
  if (intervalMs >= DAY_MILLISECONDS) return day
  return `${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * 坐标轴刻度：同一天内的桶只写时刻；跨天时日期只写在各天的第一格（00:00）上，其余格子只写时刻，
 * 整天粒度只写「月/日」。
 *
 * 跨天时不再每格都「日期 + 时刻」：一排放不下十五个「9/9 12:00」，而且日期重复十几遍之后
 * 比时刻本身还抢眼，「9/9、12:00、9/10、12:00」反而更像时间轴。前一格已经报过是哪一天了。
 */
export function formatTrendTickLabel(locale: string, label: string, crossesDays: boolean): string {
  const parsed = parseTrendBucketLabel(label)
  // 认不出的标签照原样画出来：坐标轴上多一个「00:15」总好过让格式化函数把整页渲染带崩。
  if (!parsed) return label
  const date = dateFormatter(locale, { month: 'numeric', day: 'numeric' }, 'md').format(parsed.startMs)
  if (parsed.time === null) return date
  if (!crossesDays) return parsed.time
  return parsed.time === '00:00' ? date : parsed.time
}

/**
 * 刻度间隔的候选档位（分钟）：要么整除一天，要么是一天的整数倍，刻度因此永远落在本地整点
 * （00:00 / 12:00）或整天的零点上，不会出现「每 21 小时一格」这种随手算出来的位置。
 *
 * 最细只到一小时：半小时一格的刻度在 11px 的字号下一排写不下，也没人靠它读趋势。
 */
const TREND_TICK_STEPS_MINUTES = [60, 120, 180, 240, 360, 720, 1440, 2880, 4320, 7200, 10080]

/** 一张卡片上最多写几个刻度：11px 的字排十六个就到头了，再多就要叠字。 */
export const TREND_MAX_TICKS = 16

/**
 * 坐标轴要写哪几个刻度：返回**未格式化的桶标签**（recharts 的 `ticks` 必须能匹配到这一列数据，
 * 一个个自己拼出来的字符串它一个也认不出来），显示文案交给 `tickFormatter`，也就是
 * {@link formatTrendTickLabel}。
 *
 * 不能像柱子那样「每 N 根抽一根」：柱子宽 3 小时时抽 1/8 会得到每 21 小时一格，
 * 读数变成「06:00、03:00、00:00、21:00…」——同一个刻度序列里时刻在倒退。这里分两步：
 * 先按墙钟对齐挑间隔（见 {@link TREND_TICK_STEPS_MINUTES}），再取「不超过上限的那一档里刻度最多的一份」，
 * 于是 3 小时一根柱子的窗口会拿到 12 小时一格（15 格），一天一根柱子的窗口拿到两天一格（16 格）。
 *
 * 日内间隔（小于一天）还要把开头那些不落在零点的刻度掐掉：它们只写时刻，前面没有「月/日」认领，
 * 读者会以为那是上一天的 12:00（见 {@link formatTrendTickLabel}）。
 */
export function resolveTrendTicks(labels: string[], maxTickCount: number): string[] {
  const limit = Math.max(1, maxTickCount)
  const parsed = labels.map(label => parseTrendBucketLabel(label))
  const anchor = parsed.find(entry => entry !== null)
  // 标签认不出来（老服务端只回 HH:MM），退回朴素的等间隔抽取，至少不把图表带崩。
  if (!anchor) return thinTrendLabels(labels, limit)
  const crossesDays = trendCrossesDays(labels)
  const anchorDayMs = startOfLocalDay(anchor.startMs)
  // 桶是整天时标签里没有时刻，也就不存在「正午那格缺日期」的问题，不能按零点裁剪。
  const intraday = crossesDays && parsed.every(entry => entry === null || entry.time !== null)
  const minutesFromAnchorDay = (ms: number) => localDayOffset(anchorDayMs, ms) * MINUTES_PER_DAY + minutesOfLocalDay(ms)
  let best: number[] = []
  for (const step of TREND_TICK_STEPS_MINUTES) {
    const aligned: number[] = []
    parsed.forEach((entry, index) => {
      if (entry && minutesFromAnchorDay(entry.startMs) % step === 0) aligned.push(index)
    })
    const indices = intraday && step < MINUTES_PER_DAY ? dropLeadingIntradayTicks(aligned, parsed) : aligned
    if (indices.length >= 2 && indices.length <= limit && indices.length > best.length) best = indices
  }
  return best.length > 0 ? best.map(index => labels[index]) : thinTrendLabels(labels, limit)
}

/** 掐掉开头那串不落在零点的日内刻度（窗口起点在半天中间时会出现）。 */
function dropLeadingIntradayTicks(indices: number[], parsed: Array<TrendBucketLabelParts | null>): number[] {
  const first = indices.findIndex(index => parsed[index]?.time === '00:00')
  return first < 0 ? [] : indices.slice(first)
}

/** 兜底：认不出标签或没有合适间隔时，按等间隔抽几根最朴素的刻度。 */
function thinTrendLabels(labels: string[], limit: number): string[] {
  const step = Math.max(1, Math.ceil(labels.length / limit))
  return labels.filter((_, index) => index % step === 0)
}

/** Tooltip 标题：日期永远带上，跨天时再带上星期——「9/9 周二 06:00」比「06:00」有用。 */
export function formatTrendTooltipLabel(locale: string, label: string, crossesDays: boolean): string {
  const parsed = parseTrendBucketLabel(label)
  if (!parsed) return label
  const day = dateFormatter(locale, { month: 'long', day: 'numeric' }, 'long').format(parsed.startMs)
  if (parsed.time === null) return day
  if (!crossesDays) return parsed.time
  const weekday = dateFormatter(locale, { weekday: 'short' }, 'weekday').format(parsed.startMs)
  return `${day} ${weekday} ${parsed.time}`
}

/** 趋势是否跨了多个本地日期：坐标轴据此决定要不要在每一格写日期。 */
export function trendCrossesDays(labels: string[]): boolean {
  if (labels.length === 0) return false
  // 标签按时间递增，比较首尾就够。日期部分是前 10 个字符（见 `formatTrendBucketLabel`）。
  return labels[0].slice(0, 10) !== labels[labels.length - 1].slice(0, 10)
}

/** 桶标签的约定写法，见 `formatTrendBucketLabel`。 */
const TREND_BUCKET_LABEL = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/

/** 拆好的桶标签：起点毫秒 + 时刻（整天的桶没有时刻）。 */
type TrendBucketLabelParts = { startMs: number; time: string | null }

/**
 * 拆开桶标签，不是约定的写法就返回 `null`。
 *
 * 刻意不用 `new Date(label)`：带空格的 `YYYY-MM-DD HH:MM` 不在 ECMAScript 规定的
 * 日期格式里，各引擎的实现依赖细节并不一致，手动拆更稳。
 *
 * 不匹配时返回 `null` 而不是给出一份全是 `NaN` 的结果：标签是**跨进程的显示数据**，
 * 服务端换了写法（或界面比服务端新、收到的还是旧版的 `HH:MM`）时，界面最多把标签
 * 原样写出来，不该在格式化函数里炸——`Intl.DateTimeFormat.format(NaN)` 抛的是
 * `RangeError: Invalid time value`，一个标签格式就能让整个图表渲染不出来。
 */
function parseTrendBucketLabel(label: string): TrendBucketLabelParts | null {
  const matched = TREND_BUCKET_LABEL.exec(label)
  if (!matched) return null
  const [, year, month, day, hours = '0', minutes = '0'] = matched
  const startMs = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)).getTime()
  return { startMs, time: matched[4] ? `${hours}:${minutes}` : null }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/* ==========================================================================
   用量分布（贡献图式的热力图）

   格宽同样由范围推导，但**档位独立于趋势图**：趋势图一根柱子要占 13px 才看得清，
   热力图一格 20px 上下仍然逐格可读，所以它按「完整时长铺 144 ~ 181 格」挑格宽——
   今日 10 分钟、近 7 天 1 小时、近 30 天 4 小时。格数与格宽仍和窗口一起在
   `resolveAnalyticsBuckets` 里算好，服务端分桶、界面填空用的是同一份结论。

   下面是「怎么把用量涂成深浅」，与粒度无关。
   ========================================================================== */

/** 热力档数（不含「没有请求」这一档）。贡献图的口径就是 4 档，再多一档颜色就难分了。 */
const HEAT_LEVELS = 4

/**
 * 把每桶的用量映射到 0 ~ {@link HEAT_LEVELS} 档。
 *
 * 按**非零桶的分位数**切档，而不是按最大值等分：用量是重尾分布，某个桶撞上一个超长上下文
 * 会把其余所有桶压到最浅一档，整张图只剩一个深格子。按分位数切，深浅的分布才是均匀的，
 * 这也正是贡献图的做法。
 *
 * 分位数退化时（只有两三个桶有请求，或者每桶的用量一模一样）退回按最大值等分，
 * 否则整张图会只剩一种颜色。
 */
export function resolveUsageHeatLevels(values: number[]): (value: number) => number {
  const nonZero = values.filter(value => value > 0).sort((left, right) => left - right)
  if (nonZero.length === 0) return () => 0
  const thresholds = resolveHeatThresholds(nonZero)
  if (!thresholds) {
    const min = nonZero[0]
    const max = nonZero[nonZero.length - 1]
    // 非零桶全都一模一样（刚装上、每个窗口一两条请求就是这样）：线性等分会把每一格都涂成最深一档，
    // 读起来像「满负荷跑了一整天」。统一给中间档——「有请求，但分不出多少」才是事实。
    if (min === max) {
      const middle = Math.ceil(HEAT_LEVELS / 2)
      return value => value > 0 ? middle : 0
    }
    return value => value > 0 ? Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((value / max) * HEAT_LEVELS))) : 0
  }
  return value => {
    if (value <= 0) return 0
    if (value <= thresholds[0]) return 1
    if (value <= thresholds[1]) return 2
    if (value <= thresholds[2]) return 3
    return HEAT_LEVELS
  }
}

/** 三个分位阈值（非零桶的 p25 / p50 / p75）；分位完全相同时返回 `null`，调用方退回等分。 */
function resolveHeatThresholds(sortedNonZero: number[]): [number, number, number] | null {
  if (sortedNonZero.length < HEAT_LEVELS) return null
  const at = (percentile: number) => sortedNonZero[Math.min(sortedNonZero.length - 1, Math.floor(percentile * sortedNonZero.length))]
  const thresholds: [number, number, number] = [at(0.25), at(0.5), at(0.75)]
  return thresholds[0] === thresholds[2] ? null : thresholds
}

/**
 * 本地日期标签 `YYYY-MM-DD`。
 *
 * 整天粒度的桶标签用的是这个写法，服务端 SQL 的 `date(..., 'unixepoch', 'localtime')`
 * 也是同一个写法，两边必须同时改。
 */
function formatLocalDate(dayMs: number): string {
  const date = new Date(dayMs)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** `Intl.DateTimeFormat` 的构造不便宜，而坐标轴一次渲染要调用十几次，按「语言 + 选项」缓存。 */
const dateFormats = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions, cacheKey: string): Intl.DateTimeFormat {
  const key = `${locale}:${cacheKey}`
  const cached = dateFormats.get(key)
  if (cached) return cached
  const created = new Intl.DateTimeFormat(locale, options)
  dateFormats.set(key, created)
  return created
}
