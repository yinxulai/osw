/**
 * 「我们的事件」→「Aptabase 事件报文」。**整条链路上唯一知道 Aptabase 存在的地方。**
 *
 * 纯函数构造 + 一次 POST，中间没有状态：报文进、请求体出，所以「哪个字段去了哪」可以逐条测，
 * 不必起服务器（见 `aptabase.test.ts`）。
 *
 * ## 为什么是「批量」端点
 *
 * 契约一次给我们一批（`TelemetryBatchSchema`），而 Aptabase 有 `POST /api/v0/events` 这条收
 * 数组的路。官方 SDK 走的都是单条的那条（`/api/v0/event`），但服务端两条都在，且数组那条的
 * 上限正好是 25——与契约里的 `TELEMETRY_MAX_EVENTS_PER_BATCH` 是同一个数。于是
 * **一批 = 一次下游请求**，不拆包、不分片。
 *
 * 这两个 25 是巧合而不是保证，所以这里不引用契约的那个常量（它们不是同一个概念：一个是
 * 「我们愿意一次发多少」，一个是「它一次最多收多少」），而是各写各的，并让测试钉住
 * 「契约的上限不超过这里」——契约哪天放宽到 26，那条用例会先红，而不是等线上开始出现 400。
 *
 * ## 字段怎么摆
 *
 * 契约的字段按 Aptabase 的模型各就各位：
 *
 * | 契约字段 | 去向 |
 * | --- | --- |
 * | `name` | `eventName` |
 * | `installId` | `sessionId` |
 * | `occurredAt` | `timestamp`（ISO 8601） |
 * | 其余全部（`version` / `os` / `arch` / `locale` / `runtime` / 业务属性） | 同名进 `props` |
 *
 * **不做名字映射表**：契约里的字段名直接当属性名用。契约的名字本来就是为「一眼看懂」取的，
 * 多一张对照表就多一处会漂移的东西。
 *
 * **也不给它的保留属性编值**：`osVersion` / `engineName` / `deviceModel` / `appBuildNumber`
 * 那几项有它们自己的取值规范（`engineName` 指的是浏览器引擎，我们是桌面与命令行，没有引擎），
 * 猜错就是污染它的原生维度。
 *
 * 例外只有三处，都是**语义一一对应、填上之后下游自带的视图才有值**的：`version` →
 * `appVersion`、`os` → `osName`、`locale` → `locale`。它们是 `props` 里那份的镜像，不是替代
 * ——`props` 始终是权威（口径统一在事件属性上，见 telemetry.md §11）。其中 `osName` 还多一层
 * 理由：**它不能为空**，否则下游会把这条事件当成 Web 事件去解析 User-Agent，而我们的转发
 * 请求根本没有像样的 UA（见 `AptabaseSystemProperties.osName`）。
 *
 * ## 地理位置：这一版拿不到「它自带的」地区视图
 *
 * Aptabase 的托管云在**边缘**按来源 IP 判定国家（`CloudGeoClient` 读 `CF-IPCountry` 这类
 * CDN 头），报文里**没有任何字段**能收一个 IP 或一个国家——所以从 Cloudflare 机房发出的转发
 * 请求，它看到的是机房所在的国家。
 *
 * 于是这里换一条路：**由 Worker 在收报文时按 Cloudflare 的边缘判词取国家**（`CF-IPCountry`
 * 是一枚两字母的结论，客户端伪造不了），再作为一项普通事件属性 `country` 带下去。它是唯一一个
 * 「下游报文里有、而契约里没有」的键。
 *
 * 这个取舍要说清楚：
 *
 * - 得到：地区分布这一格仍然可回答，且走的是 `props` 分组——口径与其余五个视图一致；
 * - 代价：**别去看 Aptabase 自带的地区视图**，那里显示的是机房所在地。它那一列我们改不了；
 * - 相比上一版（把客户端真实 IP 交给下游去解析）**只少了信息、没有多**：两字母的国家比一个
 *   能定位到人的地址粗得多，而且它是 Cloudflare 已经算完的结论，我们只是转抄。
 *
 * ## 「会话」这一栏放的是安装标识
 *
 * Aptabase 的模型里事件属于一个 session，而这份契约里**没有会话这个概念**（只有不轮换的
 * `installId`，见 telemetry.md §4）。把 `installId` 填进 `sessionId` 是唯一的对应方式，
 * 后果一并说清楚：
 *
 * - 得到一个跨天稳定的 `sessionId`——它的「去重会话数」就等于我们的「去重安装数」，
 *   跨天的活跃与留存仍然可回答（这正是它想要的用途）；
 * - 失去「单次会话时长」这类只在会话内成立的指标：一个安装的所有事件会串成一条无限长的会话，
 *   那个数字会一路涨到没有意义。**不要拿它当会话时长看。**
 *
 * 有一处需要留意的细节：下游会把**看起来是纯数字**的 `sessionId` 当成「秒级时间戳 + 8 位随机」
 * 来校验（超出一周就拒收）。标准 UUID 里一定有连字符，解析不成数字，所以这条分支碰不到；
 * 这也是这里不去派生一个「更短的花样 id」的原因——派生换不到匿名，却会把上面那条稳定性弄丢。
 *
 * ## 一个必须记住的静默失败
 *
 * 批量端点上，**某一条不合法是被静默丢掉的**（时间戳太旧、属性名过长……），整批仍然回 200。
 * 所以「我们回了 204」不等于「数据入库了」。与上一版同源，处置办法也一样：验收看下游自己的
 * 报表，不看状态码（telemetry.md §10）。
 */

import { type TelemetryEvent } from '@common/telemetry'
import {
  postJson,
  readErrorDetail,
  type Fetcher,
  type TelemetryForwardContext,
  type TelemetryForwardOutcome,
  type TelemetrySink,
} from '../sink'

/**
 * Aptabase 的入口。**这一行决定了数据落在哪个区域**，换区域就是改它（见 `wrangler.toml`
 * 的密钥说明）。
 *
 * 区域本来写在**应用密钥**里（`A-EU-…` / `A-US-…` 中间那一段，官方 SDK 就是靠它分流量的），
 * 这里不把密钥解析抄进来——Worker 只需要知道往哪发。于是有一条**必须守住的一致性**：
 * 这个常量要与密钥的区域对得上。对不上时下游回 404（它在自己那张表里找不到这个 App Key），
 * 而不是静默丢数据，所以错了会立刻在日志里看见。
 *
 * 选欧盟而不是美国：这是一条只有匿名安装标识的数据流，唯一值得挑的就是数据驻留地，
 * 而欧盟的默认法律环境对「不做画像的统计」更清楚。
 */
export const APTABASE_EVENTS_URL = 'https://eu.aptabase.com/api/v0/events'

/**
 * 一次请求里最多能放几条，**下游服务端的硬上限**（超过就整个请求 400——不是丢几条，
 * 是一条都不进）。它与契约的 `TELEMETRY_MAX_EVENTS_PER_BATCH` 是同一个数，但那不是保证，
 * 见文件头。
 */
export const APTABASE_MAX_EVENTS_PER_REQUEST = 25

/**
 * `systemProps.appVersion` 的长度上限，来自下游模型的 `[StringLength(50)]`。
 *
 * 契约给 `version` 的上限是 100（`TELEMETRY_MAX_PROPERTY_VALUE_LENGTH`），两者对不上。
 * 超长的版本号不是一个真实场景，但**一个 400 会把整批打回去**，所以这里只在下游装得下时
 * 才填这个保留属性：装不下就不填，`props` 里那份 `version` 照样在——版本分布读的是它。
 */
const APTABASE_APP_VERSION_MAX_LENGTH = 50

/**
 * 事件的年龄上限。**这也是下游的规矩，不是我们的**。
 *
 * Aptabase 在入库校验里写着「早于一天的事件不收」，而且批量端点上这一条是**静默丢掉**。
 * 契约允许的回溯窗口是 72 小时（`TELEMETRY_MAX_BACKDATE_MILLISECONDS`），于是「休眠两天之后
 * 补报」的那一批会带着一批下游不肯要的时间戳过来。
 *
 * 处置见 `timestampOf`：改用接收时间顶上，而不是丢掉事件。数字取 23 小时而不是 24，
 * 是给两边的时钟留一小时的余量——两边对「现在」的理解本来就有秒级到分钟级的差，
 * 而差一点点就跨过门槛的后果是一条事件没了。
 */
export const APTABASE_MAX_EVENT_AGE_MILLISECONDS = 23 * 60 * 60 * 1000

/**
 * 生产者标识。**它是必填项**（下游模型的 `[Required]`），空字符串会被整批 400，
 * 所以不能是「想起来才填」的东西。
 *
 * 填什么有不小的自由度：下游只用它区分「谁在发」。官方 SDK 填的是自己的包名与版本
 * （`aptabase-browser@0.3.1` 这种），而这里发事件的是 Worker 而不是某个 SDK，所以填的就是
 * 这个 Worker 自己的名字。**不伪造一个 SDK 名**：编出来的名字会在下游的诊断视图里指着一个
 * 并不存在的组件。（应用版本是另一回事，它在 `appVersion` 上。）
 *
 * 不带版本号是刻意的：Worker 拿不到自己的构建版本，硬编一个只会变成一处需要人记得同步的地方。
 */
const SDK_VERSION = 'one-switch-worker'

/**
 * 事件里由**下游**保管的那部分事实。
 *
 * 只列我们写的四项，其余（`osVersion` / `engineName` / `deviceModel` / `appBuildNumber` /
 * `isDebug`）一律不填，见文件头。
 */
export interface AptabaseSystemProperties {
  /** 必填（见 `SDK_VERSION`）。 */
  sdkVersion: string
  /**
   * 操作系统名。**不能为空**：为空会被下游当成 Web 事件去解析 User-Agent，
   * 而我们的转发请求没有像样的 UA。
   */
  osName: string
  /** 界面语言；下游会规范化成小写，并校验「两字母」或「`xx-YY`」两种形状。 */
  locale: string
  /** 应用版本；装不下时整个不填（见 `APTABASE_APP_VERSION_MAX_LENGTH`）。 */
  appVersion?: string
}

/** Aptabase 里的一条事件。只列我们写的五个字段。 */
export interface AptabaseEvent {
  /** ISO 8601。**一定有值**，且绝不会落在未来。 */
  timestamp: string
  /** 事件的归属。这里放的是安装标识，见文件头。 */
  sessionId: string
  eventName: string
  systemProps: AptabaseSystemProperties
  /** 事件属性；永不缺省，最少也是个空对象。 */
  props: Record<string, string | boolean>
}

export interface AptabaseSinkOptions {
  /** 应用密钥（`A-EU-…` / `A-US-…`）。它是这条链路上唯一的秘密，只从 Worker 的 secret 来。 */
  appKey: string
  fetcher: Fetcher
}

/** 造一个 Aptabase 下游。 */
export function createAptabaseSink(options: AptabaseSinkOptions): TelemetrySink {
  return {
    name: 'aptabase',
    async forward(events, context): Promise<TelemetryForwardOutcome> {
      // 凭证走**请求头**（`App-Key`），这是 Aptabase 的规矩；它与事件是分开的参数，所以
      // 「谁也不知道密钥」这件事在类型上就成立——测试可以只断言事件部分。
      const headers = { 'App-Key': options.appKey }
      const result = await postJson(APTABASE_EVENTS_URL, buildEventBatch(events, context), options.fetcher, headers)
      // 带上「是哪一种没有回答」（见 `TelemetryUnreachableReason`）：`timeout` 指向下游慢，
      // `error` 指向这次请求根本没到对方手里。两者对运维是两件不同的事。
      if (!result.ok) return { ok: false, failure: 'unreachable', reason: result.reason }
      // ⚠️ 2xx 只说明下游收下了请求，**不代表每一条都入库**（见文件头那条静默失败）。
      if (!result.response.ok) {
        // 把它的答复读出来一起带下去。读不出来就是 `null`，不影响这个判定的成立。
        return {
          ok: false,
          failure: 'rejected',
          status: result.response.status,
          detail: await readErrorDetail(result.response),
        }
      }
      return { ok: true }
    },
  }
}

/**
 * 把一批事件拼成一次 Aptabase 请求。
 *
 * 是数组而不是包装对象：下游那条路收的就是一个事件数组，顶点都不能多（多一层 `{ events: … }`
 * 会当成一条畸形事件被整批 400）。
 */
export function buildEventBatch(events: readonly TelemetryEvent[], context: TelemetryForwardContext): AptabaseEvent[] {
  return events.map(event => toEvent(event, context))
}

function toEvent(event: TelemetryEvent, context: TelemetryForwardContext): AptabaseEvent {
  return {
    timestamp: timestampOf(event.occurredAt, context.receivedAt),
    sessionId: event.installId,
    eventName: event.name,
    systemProps: systemPropertiesOf(event),
    props: eventProperties(event, context),
  }
}

/**
 * 事件时间戳，**格式是 ISO 8601，而且一定有值**。
 *
 * 下游的 `timestamp` 是必填：不给会被反序列化成「0001 年」那种远古时间，然后整条被丢。
 * 所以这里没有「不带时间戳」这个选项，只有「用哪一个时间」。
 *
 * 超过回溯窗口或落在未来时用**接收时间**顶上。下游那条「一天前的不要」是它自己的规矩，
 * 而我们能选的只有「时间不准」与「这条不要」——补报本来就允许损失时间精度
 * （telemetry.md §12），所以选前者。
 *
 * 落在未来的一律当成客户端时钟错了：服务端的接收时间一定比它更接近事实。
 */
export function timestampOf(occurredAt: number, receivedAt: number): string {
  const age = receivedAt - occurredAt
  if (age < 0 || age > APTABASE_MAX_EVENT_AGE_MILLISECONDS) return new Date(receivedAt).toISOString()
  return new Date(occurredAt).toISOString()
}

/**
 * 保留属性：**只填有确定对应物的三项**，其余留空（见文件头）。
 *
 * `locale` 与 `appVersion` 是 `props` 里那份的镜像，`osName` 不是——它必须给（见它自己的
 * 注释）。三处都只在下游装得下时才填。
 */
function systemPropertiesOf(event: TelemetryEvent): AptabaseSystemProperties {
  return {
    sdkVersion: SDK_VERSION,
    osName: event.os,
    locale: event.locale,
    ...(event.version.length <= APTABASE_APP_VERSION_MAX_LENGTH ? { appVersion: event.version } : {}),
  }
}

/**
 * 事件属性：**契约里除三样归位字段之外的全部字段，同名落进来**，外加一项服务端事实。
 *
 * 扫描的是报文自身的键而不是一份硬编码名单：报文已被 `.strict()` 校验过，键集合只可能是契约里
 * 那些，所以「报文里有什么就发什么」在这里等价于白名单，而且契约加了字段这里自动跟上——
 * 不必记得来改这个文件。业务属性（各事件自己的那一个）也走同一条路，不需要区别对待。
 *
 * 值的类型**原样保留**：契约里的属性只有字符串与布尔两种，而下游收得下 JSON 里的任何东西
 * （布尔会被它自己规范化成 `'true'` / `'false'`，那是它的事，不是我们要提前替它做的加工）。
 */
function eventProperties(event: TelemetryEvent, context: TelemetryForwardContext): Record<string, string | boolean> {
  const properties: Record<string, string | boolean> = {}
  for (const [key, value] of Object.entries(event)) {
    if (RELOCATED_FIELDS.has(key)) continue
    properties[key] = typeof value === 'boolean' ? value : String(value)
  }
  // 唯一一个下游报文里有、而契约里没有的键：Worker 按 Cloudflare 的边缘判词补上的来源国家
  // （见文件头「地理位置」）。拿不到就不带，而不是编一个——「不知道在哪」比「定到一个错的
  // 地方」错得少。
  if (context.countryCode !== null) properties.country = context.countryCode
  return properties
}

/**
 * 已经各有去处的契约字段，不再重复进属性表：`name` → `eventName`、`installId` → `sessionId`、
 * `occurredAt` → `timestamp`。写成集合是为了在逐字段扫描时用一次查表代替一次数组查找。
 *
 * 只有这三样：`version` / `os` / `locale` 虽然也在保留属性里露了一面，但那是镜像，`props`
 * 里那份才是权威（见文件头）。
 */
const RELOCATED_FIELDS: ReadonlySet<string> = new Set(['name', 'installId', 'occurredAt'])
