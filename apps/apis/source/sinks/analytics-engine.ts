/**
 * 「我们的事件」→「Cloudflare Analytics Engine 数据点」。**整条链路上唯一知道
 * Analytics Engine 存在的地方。**
 *
 * ## 为什么下游从「一个 HTTP 服务」换成了「一个绑定」
 *
 * 上一版的目标是 Aptabase：我们要拼一份它的报文，发一次 POST，然后读它的状态码。这一版的
 * 下游是**同一个 Cloudflare 账号里的一个数据集**，写入是一次本地调用
 * （`env.TELEMETRY.writeDataPoint()`），运行时在后台把它落盘。
 *
 * 这个差别不只是「少一次网络往返」，它把整条链路的失败词汇都改掉了：
 *
 * | 上一版有的东西 | 这一版 |
 * | --- | --- |
 * | 入口地址（区域常量） | 没有地址，绑定名写在 `wrangler.toml` |
 * | 凭证（`APTABASE_APP_KEY`） | **没有凭证**，它就是这个账号里的一个数据集 |
 * | 转发超时（3 秒） | 没有等待，调用立刻返回，运行时在后台写 |
 * | 「对方回了 400/404」 | 没有对方的状态码，也就没有这种失败 |
 * | 「下游把你锁了」 | **结构上不存在**：这不是一个第三方账号 |
 *
 * 最后一行才是这次改动的真正原因。上一版被锁的现场是 `Owner account is locked.`：
 * 用量超出免费额度之后，**整个账号被停掉，所有事件静默丢弃**，而我们的代码只能把它记成一条
 * `upstream_rejected`。telemetry.md §8.2 把「需要『统计不依赖第三方账号』的可控性」列为
 * 自建存储的第三个触发条件——那个条件在 2026-10 被对方用一封拒信替我们满足了。
 *
 * 额度上也不再勉强：免费档是**每天 10 万个数据点**（`writeDataPoint` 调用计数的就是它），
 * 而实测用量约 1.17 万条/天（近 18 天 17,833 次请求，见 `apps/docs/specs/telemetry.md` §8）。
 *
 * ## 一处必须知道的免费档上限
 *
 * **数据保留 3 个月**（Analytics Engine 的硬限制，不是我们能配的）。上一版的下游最长可以设
 * 更久，所以这是一处实实在在的退步。要更长的历史只有一条路：导出到 R2（免费档 10 GB，
 * 我们这个体积约 70 MB/月）。**这一版没有做**——它属于读侧，见文件末尾「这一版没做的事」。
 *
 * ## blob 的摆法：位置即列名
 *
 * Analytics Engine 的数据点由三种数组组成：`blobs`（字符串，用来分组与过滤）、`doubles`
 * （数字）、`indexes`（采样键，只允许一个）。**数组是按位置读的**，所以下面这张表就是这一层
 * 的全部约定——列的顺序在这里定，读侧的 SQL 只负责把 `blobN` 别名回这些名字：
 *
 * | # | 列 | 取值来源 | SQL 别名 |
 * | --- | --- | --- | --- |
 * | 1 | `event` | 契约的 `name` | `event` |
 * | 2–6 | `version` / `os` / `arch` / `locale` / `runtime` | 契约的信封字段，同名 | 同名 |
 * | 7 | `country` | `CF-IPCountry`（**唯一一项不来自契约的值**） | `country` |
 * | 8–17 | 事件属性 | 契约的属性名，同名 | 见 `ANALYTICS_ENGINE_BLOB_SLOTS` |
 *
 * 一共 17 列，上限是 20。
 *
 * 两处与契约的名字对不上的地方，都写在 `ANALYTICS_ENGINE_BLOB_SLOTS` 里：
 *
 * - `name` → 列名 `event`：`name` 在 SQL 里太含糊，而这一列回答的正是「哪条事件」；
 * - `from` / `to` → 别名 `protocol_from` / `protocol_to`：**它们是 SQL 保留字**，
 *   直接 `AS from` 是语法错误。契约里的属性名不动（那是发到线上的词表），改的是读侧的别名。
 *
 * 属性用的是**固定列而不是一坨 JSON**。JSON 那一版（把剩下的字段 `JSON.stringify` 成一个
 * blob）看着更省事、还能自动跟着契约长，但它有两个真实的代价：每一处查询都要写成
 * `JSONExtractString(blob8, 'reason')`，而且「这个值到底是不是字符串」要交给 SQL 方言去回答
 * （布尔在 JSON 里的读回行为各实现不一）。换来的是「契约加了属性这里自动跟上」。
 *
 * 那个自动跟进用**测试**补回来了，而且更严：`analytics-engine.test.ts` 从
 * `TelemetryEventSchema` 里机械地枚举出全部属性名，逐个要求这里有对应的一列。于是「加了事件
 * 属性、忘了加列」会是一条红的用例，而不是线上一个静默的空列——与契约里那套「命名规则由
 * `telemetry.test.ts` 机械检查」是同一个做法。
 *
 * ## 值一律写成字符串
 *
 * 契约里的属性只有字符串与布尔两种，而 blob 只收字符串，所以 `true` / `false` 在这里被写成
 * `'true'` / `'false'`。**这是这一层要做的加工，不是可以省的**：JSON 里的布尔在 SQL 侧怎么读
 * 回来要看方言，而 `'true'` 是一个所有读者都同意的值。分组、过滤因此永远是对字符串做的。
 *
 * ## 没有 double，这不是遗漏
 *
 * `doubles` 是空的。这份契约里**没有任何数字属性**（属性值只能是枚举或布尔，见
 * `@common/telemetry` 的文件头），而所有指标都是计数：一次请求发了 12 条事件，读回来的方式
 * 是 12 行。所以：
 *
 * - 计数用 `SUM(_sample_interval)`，**不要**用 `COUNT()` —— 采样会把它算少；
 * - **不要**去找 `double1`：这里没有它，`SUM(double1)` 那套写法在这张表上不成立。
 *
 * ## 时间：用 Analytics Engine 自己那个戳，不用客户端的
 *
 * 每个数据点被写入时，运行时自动补一个 `timestamp` 列，**它就是服务器时钟**。上一版要自己
 * 处理这件事：客户端的 `occurredAt` 可能太旧（休眠两天后补报）或落在未来（系统时间不对），
 * 于是适配器里有一段「超出窗口就改用接收时间顶上」的逻辑，还有一个 23 小时的常量在对齐下游
 * 的规矩。
 *
 * 这一版**把客户端的时间戳丢掉了，不落任何一列**。理由是它比那个戳可信得多：
 *
 * - `occurredAt` 来自客户端，改系统时间就能伪造，也能因为休眠而偏离几个小时；
 * - `timestamp` 是运行时在写入那一刻盖的，客户端碰不到。
 *
 * 代价要说清楚：**「事件发生」与「事件被收到」之间的差被抹掉了**。这个差有上界——客户端
 * 最多攒 12 条或等 30 秒就先发出去（`TELEMETRY_DEFAULT_BATCH_SIZE` /
 * `TELEMETRY_FLUSH_INTERVAL_MILLISECONDS`），所以日粒度、小时粒度的趋势都不受影响，而秒级的
 * 「事件什么时候发生」这一版回答不了。要判断客户端的钟偏得有多离谱，得另开一条诊断事件，
 * 而不是把这一列留着——那是 `service_start_failed` 那种**事实**，不是一列可以随意歪掉的原始值。
 *
 * 起点也因此变了：这张表里的历史**从第一次部署这一版开始**，上一版的 Aptabase 数据不会迁移
 * （它本来也已经被锁住了）。
 *
 * ## 采样与 `_sample_interval`
 *
 * Analytics Engine 在写入量很大时按 **index** 采样，并把采样率写在 `_sample_interval` 列里。
 * 这里的 index 是**安装标识**，也就是官方推荐的那种选法（「按客户/用户选 index」）：量大的
 * 那一个安装会被采样，其余安装的数据保持完整。
 *
 * 于是有一个**每个查询都要记住的规矩**：
 *
 * | 想要的 | 不要写 | 要写 |
 * | --- | --- | --- |
 * | 事件条数 | `COUNT()` | `SUM(_sample_interval)` |
 * | 去重安装数 | `COUNT(DISTINCT index1)` | `SUM(_sample_interval)` 上再聚合，或 `uniq` |
 *
 * index 的值是安装标识，它的长度有硬上限 **96 字节**，而契约保证 `installId` 是标准 UUID
 * ——36 个 ASCII 字符。这个关系有测试钉着（`analytics-engine.test.ts`），因为超限的后果是
 * **整条数据点被静默丢掉**：不是报错，是少一行。
 *
 * `indexes` 虽然是个数组，但**只能给一个**：给多个同样会静默丢掉整条数据点。所以这里是
 * `[event.installId]`，一个元素。
 *
 * ## 一个必须记住的静默失败
 *
 * 与上一版同源，只是换了一个地方：`writeDataPoint()` **不回答任何东西**。它立刻返回，运行时
 * 在后台写；数据点不合法（列太多、index 超长、blob 总量超限）时它既不抛也不回，
 * **那条数据点就是不在了**。
 *
 * 所以我们能承诺的只有「这次调用交出去了」，**不是「这一行入库了」**。验收看的是数据集的
 * SQL 查询结果，不是端点的 204（telemetry.md §10）。这也正是下面那个 try/catch 只可能包住
 * 「本地调用直接抛错」这一种情形的原因——它挡不住静默丢，谁都挡不住。
 *
 * ## 这一版没做的事
 *
 * - **读侧**：没有查询接口、没有控制台分析页。写侧先落地、先验证数据真的进得去。
 * - **长期存储**：3 个月以前的数据没有。要它就得导 R2，那是读侧的事。
 * - **限流**：仍然配在域名上（`wrangler.toml`），理由见 `index.ts` 的文件头。与下游是谁无关。
 */

import { type TelemetryEvent } from '@common/telemetry'
import type { TelemetryForwardContext, TelemetryForwardOutcome, TelemetrySink } from '../sink'

/**
 * 数据集名。**这一行决定了数据落在哪张表里**，而读侧的 SQL 直接写它。
 *
 * 用下划线而不是连字符：它在 SQL 里是一个标识符（`FROM osw_telemetry`），连字符会让每一处
 * 查询都得写成 `FROM "osw-telemetry"`。名字里的 `osw` 与其余 Worker（`osw-apis` / `osw-www`）
 * 同源。
 *
 * 与绑定的关系：`wrangler.toml` 里把绑定名（`TELEMETRY`，代码里 `env.TELEMETRY`）指到这个
 * 数据集。**数据集不需要在后台手工创建**——第一次写入时自动建。
 */
export const ANALYTICS_ENGINE_DATASET = 'osw_telemetry'

/**
 * `indexes` 里那一项的长度上限，**下游的硬限制**（96 字节）。
 *
 * 超限的后果不是报错而是**整条数据点被丢掉**，所以它值得写成常量、并被测试钉住来源：
 * 契约保证 `installId` 是标准 UUID，文本形式是 36 个 ASCII 字符（`z.string().uuid()`）。
 */
export const ANALYTICS_ENGINE_INDEX_MAX_BYTES = 96

/** `blobs` 的列数上限。超了整条数据点被丢掉，所以多一列都不行。 */
export const ANALYTICS_ENGINE_MAX_BLOBS = 20

/**
 * 一次 Worker 调用里最多能写多少个数据点，**下游的硬限制**（250）。
 *
 * 它远大于契约的单批上限（`TELEMETRY_MAX_EVENTS_PER_BATCH`，25），所以「一批 = 一次调用里的
 * 若干个数据点」永远撞不到它。仍然有测试钉着这条关系：契约哪天把单批放宽到 251，那条用例
 * 会先红，而不是等线上开始静默丢数据点。
 */
export const ANALYTICS_ENGINE_MAX_DATA_POINTS_PER_INVOCATION = 250

/**
 * 一个数据点里 blob 的**总字节**上限，16 KB。
 *
 * 这是下游的限制，也是这一层唯一一条「不合法就静默丢」的量级约束。它在这里出现是为了有一条
 * 能被测试断言的上界（见 `analytics-engine.test.ts` 里那个「最坏情况的数据点」用例），
 * 不是因为我们会接近它——契约给每个字段都定了长度上限，最坏情况仍然差着两个数量级。
 */
export const ANALYTICS_ENGINE_MAX_BLOB_BYTES = 16 * 1024

/**
 * Analytics Engine 数据点里我们会填的两项（`indexes` / `blobs`）。
 *
 * **自己声明而不去引一个全局类型**：这个 Worker 只依赖 `@osw/contracts`，没有装
 * `@cloudflare/workers-types`（那个包会带来一整套运行时环境类型，而这里只需要一个方法的形状）。
 * 类型写得比平台更窄也有好处——`readonly string[]` 让测试可以直接递冻结的数组，
 * 而 `ArrayBuffer` 那一支我们这个用例永远用不到。
 */
export interface AnalyticsEngineDataPoint {
  readonly indexes?: readonly string[]
  readonly blobs?: readonly string[]
}

/**
 * 写入绑定，也就是 `env.TELEMETRY`。
 *
 * **返回 `void`，不返回 Promise**：运行时不希望写入被 await（它自己会在后台落盘），所以这里
 * 也不假装它是一次异步操作。`forward()` 因此是一次同步调用——整条链路上唯一一处「等」消失了，
 * 端点的应答时间不再取决于任何外部服务。
 */
export interface AnalyticsEngineDatasetBinding {
  writeDataPoint(point: AnalyticsEngineDataPoint): void
}

/**
 * 一列 blob。位置由它在 `ANALYTICS_ENGINE_BLOB_SLOTS` 里的下标决定（`blob1` 是第 0 项）。
 *
 * `alias` 与 `key` 分开，是为了让「契约里的名字」与「SQL 里能用的名字」各自正确：
 * `from` / `to` 是 SQL 保留字，列别名必须换一个，而契约里的属性名叫什么不是 SQL 能决定的。
 */
export interface TelemetryBlobSlot {
  /** 取值来源：信封字段名、事件属性名，或两个特例（`event` / `country`）。 */
  readonly key: string
  /** 读侧 SQL 里的列别名。**不总是等于 `key`**（见 `TelemetryBlobSlot`）。 */
  readonly alias: string
}

/**
 * blob 的位置表。**数组下标 + 1 就是 `blobN`**，所以这个数组的顺序就是表的列序。
 *
 * 前七项来自信封与边缘（每一条事件都有），后面十项是事件属性——契约里全部属性的并集，
 * 一个不多一个不少（多出来的列永远是空的，而空列会让人以为事件真的带了这个属性；
 * 少了列则会静默丢值）。这份名单由测试与契约机械对齐，见文件头。
 *
 * 属性之间**共用**语义相同的列：`kind` 同时装 `provider_created` 与 `rewrite_rule_created`
 * 的 `kind`（两者就是同一套词表），`protocol` 与 `protocol_from` / `protocol_to` 都装协议枚举。
 * 于是「按 kind 分组」这类查询天然跨事件成立，不必写 `UNION`。
 */
export const ANALYTICS_ENGINE_BLOB_SLOTS: readonly TelemetryBlobSlot[] = [
  // ---- 信封与边缘（每一条事件都有） ----
  { key: 'event', alias: 'event' },
  { key: 'version', alias: 'version' },
  { key: 'os', alias: 'os' },
  { key: 'arch', alias: 'arch' },
  { key: 'locale', alias: 'locale' },
  { key: 'runtime', alias: 'runtime' },
  { key: 'country', alias: 'country' },
  // ---- 事件属性（每个事件只填自己那几个，其余为空串） ----
  { key: 'reason', alias: 'reason' },
  { key: 'skipped', alias: 'skipped' },
  { key: 'mode', alias: 'mode' },
  { key: 'kind', alias: 'kind' },
  { key: 'protocol', alias: 'protocol' },
  { key: 'result', alias: 'result' },
  { key: 'from', alias: 'protocol_from' },
  { key: 'to', alias: 'protocol_to' },
  { key: 'attempts', alias: 'attempts' },
  { key: 'node_kind', alias: 'node_kind' },
]

/**
 * `installId` 不进 blob：它是 index（采样键），**只在 `index1` 里**。
 *
 * 也**不在 `occurredAt` 上留列**，理由见文件头「时间」。
 *
 * 这两项与 `ANALYTICS_ENGINE_BLOB_SLOTS` 合起来，必须正好覆盖契约里的每一个非属性字段——
 * 有测试逐个核对，所以新增一个信封字段时会先红，而不是悄悄少一列。
 */
export const ANALYTICS_ENGINE_ENVELOPE_DESTINATIONS = {
  name: 'event',
  installId: 'index',
  occurredAt: 'dropped',
  version: 'version',
  os: 'os',
  arch: 'arch',
  locale: 'locale',
  runtime: 'runtime',
} as const

export interface AnalyticsEngineSinkOptions {
  /** 写入绑定，即 `env.TELEMETRY`。它是这一版唯一的依赖，而且**不是秘密**。 */
  dataset: AnalyticsEngineDatasetBinding
}

/** 造一个 Analytics Engine 下游。 */
export function createAnalyticsEngineSink(options: AnalyticsEngineSinkOptions): TelemetrySink {
  return {
    name: 'analytics-engine',
    forward(events, context): Promise<TelemetryForwardOutcome> {
      try {
        for (const event of events) options.dataset.writeDataPoint(dataPointOf(event, context))
      } catch {
        // 只有「本地调用直接抛错」会到这里（见文件头那节静默失败）。此时**前面几条可能已经写出去了**
        // ——`not_delivered` 说的是「这一批没有全部交出」，不是「一条都没有」。
        //
        // 不去回滚、不去重试：这是一次幂等追加，而统计本来就允许重复与丢失（telemetry.md §12）。
        // 重试反而会把同一批数据写第二遍，那是一个更难发现的口径问题。
        return Promise.resolve({ ok: false, failure: 'not_delivered' })
      }
      // ⚠️ 「交出」不等于「入库」：数据点不合法时运行时静默丢掉它，而且什么都不回。
      return Promise.resolve({ ok: true })
    },
  }
}

/** 一条事件 → 一个数据点。 */
export function dataPointOf(event: TelemetryEvent, context: TelemetryForwardContext): AnalyticsEngineDataPoint {
  return {
    // 只放一个元素。多放一个的后果是整条数据点被丢掉，而不是取第一个。
    indexes: [event.installId],
    blobs: blobValuesOf(event, context),
  }
}

/**
 * 按 `ANALYTICS_ENGINE_BLOB_SLOTS` 的顺序把值摊平成一串字符串。
 *
 * **长度一定等于列数**，缺的值写成空串而**不是省略**：blob 是按位置读的，少写一个会让它后面
 * 的每一列都错位一格——那是一次静默的口径错误，比缺一个值糟得多。
 *
 * 空串在每一列上的含义都是「这条事件没有这个值」（没有这个属性、或没拿到来源国家）。
 * 读侧因此要把 `''` 当缺失处理：**尤其 `country`，空串不是某个国家**。
 */
function blobValuesOf(event: TelemetryEvent, context: TelemetryForwardContext): string[] {
  return ANALYTICS_ENGINE_BLOB_SLOTS.map(slot => valueOfSlot(slot.key, event, context))
}

/**
 * 一个槽位上的值，**一律以字符串返回**。
 *
 * 三个来源，按特例在前、字段查表在后的顺序：`event` 是契约的 `name`，`country` 是 Worker 从
 * `CF-IPCountry` 拿到的边缘判词（唯一一项不在契约里的值），其余一律按名字去事件上取。
 *
 * 布尔写成了 `'true'` / `'false'`（理由见文件头「值一律写成字符串」）；取不到时是空串。
 */
function valueOfSlot(key: string, event: TelemetryEvent, context: TelemetryForwardContext): string {
  if (key === 'event') return event.name
  // 拿不到国家时是 `null` → 空串。**不退回请求自身的来源地址**：那只会得到「所有人都来自
  // 机房」这个假答案（理由见 `sink.ts` 的 `TelemetryForwardContext`）。
  if (key === 'country') return context.countryCode ?? ''
  const value = (event as unknown as Record<string, unknown>)[key]
  if (value === true) return 'true'
  if (value === false) return 'false'
  return typeof value === 'string' ? value : ''
}
