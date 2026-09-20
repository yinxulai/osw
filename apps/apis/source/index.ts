/**
 * 匿名使用统计的上报端点（Cloudflare Worker）。
 *
 * 它是**客户端与下游分析服务之间唯一的一层**，只干三件事（见 `docs/product/telemetry.md` §7）：
 *
 * 1. **严格校验**：用客户端同一份 schema 解析，拒绝多余字段；
 * 2. **补服务端事实**：服务器时钟，以及客户端所在的国家；
 * 3. **交给下游**：具体去哪个后端由 `source/sinks/` 决定，这里不知道也不需要知道。
 *
 * 第 3 条被单独拎出来，是因为**它可替换**：换分析后端只写一个新 sink 文件并改 `createSink`
 * 一处，收报文、校验这些与下游无关的事一行都不动（见 `source/sink.ts`）。
 *
 * 请求路径只有 `/v1/track` 一条（`TELEMETRY_REQUEST_PATH`），其余一律 404，根路径也不例外。
 * 刻意不为部署流水线另加一个健康检查接口：域名上「唯一一条路径」本身就是最强的信号，
 * 而部署后真正要确认的只有「路由注册上了没有」——对 `GET /v1/track` 期待 405 就回答了它，
 * 那是一个只可能来自本 Worker 的答案。
 *
 * 为什么必须有这一层，而不是让客户端直接打下游：下游的凭证只应该存在于这里。桌面应用里嵌的
 * 任何凭证都能被解出来，所以「客户端不持有下游凭证」不是可选的组织方式，是唯一的正确形态。
 * 也因此这里**不做客户端鉴权**——它只能提供虚假的安全感（§7）。
 *
 * 端点地址是客户端里唯一写死的地址，**发布出去就是永久地址**：换下游、换存储、换数据驻留
 * 区域都只动这个 Worker。所以这里对客户端承诺的是**请求格式**（`/v1/track`），不是数据去向。
 *
 * ## 关于地理位置
 *
 * 转发请求是从 **Cloudflare 机房**发出的，所以下游按请求来源 IP 做地理归属只会得到
 * 「所有用户都在机房所在地」这个假答案。因此这里把**来源国家**（`CF-IPCountry`，由 Cloudflare
 * 在边缘按真实客户端 IP 判好，客户端伪造不了）当作一项服务端事实交给 sink。
 *
 * **给的是结论，不是原料**：`CF-IPCountry` 是一枚两字母的代码，比一个能定位到人的地址粗得多，
 * 而这一步 Cloudflare 已经算完了——把 IP 再往下递换不到任何更准的答案，只是让链路上多留一份
 * 原始用户信息。于是**客户端的地址从头到尾没有被读过**：离开这个 Worker 的只有契约里的枚举值
 * 与这一枚国家代码。
 *
 * 拿不到国家时 sink 不带地区，**绝不退回请求自身的来源地址**：那只会得到「所有人都来自
 * 机房」这个假答案。
 *
 * ## 关于限流：这里不做
 *
 * 曾经有一层按安装标识与来源地址的内存计数器，删掉了，因为它做不到它看起来在做的事：计数器
 * 住在**单个 isolate 的内存**里，而 Cloudflare 会同时跑很多个 isolate、很多个机房，状态既不
 * 共享也不持久。于是实际放行量是「配置值 × 机房数」的量级——一个会随部署规模自行放大的上限，
 * 不像上限，更像噪声。而按客户端聚合（限流真正要的东西）只有边缘做得到，所以限流配在域名上
 * （`wrangler.toml` 里有说明），**那是这条链路上唯一的限流手段**。
 *
 * `/v1/track` 是幂等追加、无鉴权、无副作用的，漏挡不构成风险。删掉它还顺带简化了上面那段隐私
 * 账：那个地址之前至少要被哈希一次才成为限流键，现在连一次哈希都没有了。
 */

import {
  TelemetryBatchSchema,
  TELEMETRY_MAX_REQUEST_BYTES,
  TELEMETRY_REQUEST_PATH,
  type TelemetryEvent,
} from '@common/telemetry'
import type { Fetcher, TelemetrySink } from './sink'
import { createAptabaseSink } from './sinks/aptabase'

/**
 * Worker 的绑定。
 *
 * 只有一项：下游的应用密钥。它是 secret（`wrangler secret put`），不进仓库、不进
 * `wrangler.toml`、不进客户端。它一旦泄露，任何人都能往这个项目里灌数据。
 *
 * 名字跟着下游走（现在是 Aptabase），而不是起一个中性的 `TELEMETRY_TOKEN`：不同后端的凭证
 * 本来就不是同一样东西，把它藏在一个通用名字后面只会让「现在配的到底是哪家的密钥」
 * 变成一件要靠人记的事。换后端时这里会跟着变，那正是应该发生的。
 *
 * 值的形状是 `A-<区域>-<随机段>`（区域那一段决定它属于哪个数据中心），但**这里不看它**
 * ——为什么，见 `createSink`。
 */
export interface TelemetryEnv {
  APTABASE_APP_KEY?: string
}

export type TelemetryHandler = (request: Request, env: TelemetryEnv, now?: number) => Promise<Response>

/**
 * 造一个 handler。
 *
 * 之所以是工厂而不是一个模块级的函数，是为了让 `fetcher` 能被换掉：测试要替换的正是「那一次
 * HTTP」，而不是把整条链路搭起来。部署时用文件末尾那个默认实例。
 */
export function createTelemetryHandler(fetcher: Fetcher = fetch): TelemetryHandler {
  return async function handle(request, env, now = Date.now()) {
    // ---- 1. 路由：只有一条路径，只有一种方法 ----

    // 只认一条路径。不在它上面的一律 404（根路径也是）：域名上**没有**「不知道为什么有回应」
    // 的地址，包括不给运维探针留位置——那件事由 `GET /v1/track` 的 405 回答，见文件头。
    if (new URL(request.url).pathname !== TELEMETRY_REQUEST_PATH) return json(404, { ok: false, error: 'not_found' })
    if (request.method !== 'POST') return methodNotAllowed('POST')
    if (!isJsonContentType(request.headers.get('content-type'))) return json(415, { ok: false, error: 'unsupported_media_type' })

    // ---- 2. 下游：缺配置就说清楚，不能静默丢数据 ----

    // `createSink` 是**全 Worker 唯一知道选的是哪个后端的地方**。换后端时只改它。
    const sink = createSink(env, fetcher)
    if (sink === null) return json(500, { ok: false, error: 'not_configured' })

    // ---- 3. 严格校验 ----

    const text = await request.text()
    if (byteLength(text) > TELEMETRY_MAX_REQUEST_BYTES) return json(413, { ok: false, error: 'payload_too_large' })

    const payload = parseJson(text)
    if (payload === null) return json(400, { ok: false, error: 'invalid_json' })

    const parsed = TelemetryBatchSchema.safeParse(payload)
    if (!parsed.success) {
      // 回显前几条问题：客户端开发者要能自己看出报文哪里不对，而这里没有任何秘密可泄露
      // （schema 是开源的、端点本来也没有鉴权）。
      return json(400, {
        ok: false,
        error: 'invalid_payload',
        issues: parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      })
    }

    // ---- 4. 一批只能来自一台设备 ----

    const events = parsed.data.events
    if (!isSingleDevice(events)) return json(400, { ok: false, error: 'mixed_batch' })

    // ---- 5. 交给下游：本 Worker 的职责到此为止 ----

    // 没有削平、没有拼报文、没有字段去向：那全是 sink 的事。这一层只提供两项服务端事实
    // （服务器时钟与来源国家），因为只有它看得到 HTTP、也只有它读得到 Cloudflare 填的头。
    const outcome = await sink.forward(events, { receivedAt: now, countryCode: countryOf(request) })
    if (outcome.ok) return new Response(null, { status: 204 })

    // 唯一的两个日志点，都说「下游答不答」，不说「谁在发」：没有安装标识、没有来源地址、
    // 没有报文正文。`wrangler.toml` 把 `[observability]` 打开，等的就是这两行。
    // 也带上 `sink` 名：将来同时挂两个下游时，这两行要能分开。
    if (outcome.failure === 'unreachable') {
      console.error(`[apis] upstream unreachable sink=${sink.name}`)
      return json(502, { ok: false, error: 'upstream_unreachable' })
    }
    // ⚠️ 2xx 只说明下游收下了请求，**不代表事件入库**：缺标识、缺事件名、超出它的时间窗
    // 都会被静默丢弃（telemetry.md §9）。所以这个返回值不能当验收标准用，验收要看下游
    // 自己的报表。
    console.error(`[apis] upstream rejected sink=${sink.name} status=${outcome.status}`)
    return json(502, { ok: false, error: 'upstream_rejected', status: outcome.status })
  }
}

/**
 * 同一批必须来自同一台设备。
 *
 * 不是洁癖：下游看到的是一批事件加一个标识，而「一批」在语义上就是一个安装的一次上报。
 * 混着发必然要把某些事件归到别的安装上去——那比拒收更糟，因为它静默地坏了口径。
 *
 * 比对的是 `installId` / `os` / `locale`：前两者是这条链路的基本单位，`locale` 则是「界面语言」
 * 这个维度——同一台机器同一次上报里出现两种界面语言是不可能的。`version` / `arch` / `runtime`
 * **刻意不在这里比对**：桌面端与命令行共用安装标识与数据目录，升级与宿主切换都会在真实场景里
 * 让同一批里出现不同的值，那是事实，不是有人手改了报文。
 */
function isSingleDevice(events: readonly TelemetryEvent[]): boolean {
  const [first] = events
  return events.every(event =>
    event.installId === first.installId
    && event.os === first.os
    && event.locale === first.locale)
}

/**
 * 请求的来源国家，**Cloudflare 的边缘判词**。
 *
 * `CF-IPCountry` 是 Cloudflare 在边缘按真实客户端 IP 判好的一枚两字母代码，客户端伪造不了，
 * 所以它是一种服务端事实——而且是一枚**结论**：我们不知道、也不需要知道它是从哪个地址得出
 * 的（见文件头）。
 *
 * 这里做一次形状检查：这个值会被写进转发报文，而报文是给外部服务的。两字母以外的取值
 * （Cloudflare 在某些情形下会填 `XX` 表示「不知道」，另有 `T1` 这类非国家的标记）一律当
 * **不知道**处理，而不是当成一个国家发出去——把「不确定」写成 `XX` 会让下游的地区视图里多出
 * 一个假国家。
 */
function countryOf(request: Request): string | null {
  const country = request.headers.get('CF-IPCountry')
  if (country === null) return null
  const normalized = country.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) && normalized !== 'XX' ? normalized : null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType !== null && contentType.toLowerCase().startsWith('application/json')
}

/**
 * 选一个下游。**全 Worker 唯一知道选的是哪个后端的地方**（见 `source/sink.ts`）。
 *
 * 拆成独立的函数而不是写在 handler 里，是为了让「换后端要改哪里」有一个能被搜到的答案。
 * 返回 `null` 表示配置不齐——调用方据此回 500，而不是静默地把数据丢掉。
 *
 * 只判断「密钥存不存在」：**不去猜它的格式**（前缀、区域段、长度都不看）。密钥的合法性只有
 * 下游知道，猜错的后果是「部署时看着没问题，上线后一条都收不到」。让第一个真实请求去回答它。
 *
 * ⚠️ 有一处**格式之外**的一致性靠人是守的：密钥里那一段区域要与 sink 里的入口地址对得上
 * （见 `sinks/aptabase.ts`）。对不上时下游会回 404，所以它会在日志里立刻显形，而不是静默
 * 丢数据——这也正是这里敢不去校验它的原因。
 */
function createSink(env: TelemetryEnv, fetcher: Fetcher): TelemetrySink | null {
  const appKey = env.APTABASE_APP_KEY
  if (!isNonEmpty(appKey)) return null
  return createAptabaseSink({ appKey, fetcher })
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

/**
 * 所有响应的头都只从这里出去。
 *
 * 刻意**不加 CORS**：调用方是桌面应用与命令行，不是浏览器里的页面，放开跨域只会让它更容易被
 * 滥用。刻意**不设 `Cache-Control`**：这里没有任何东西值得被缓存，而缓存住一个错误响应
 * 是真伤害。
 */
function responseHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json; charset=utf-8', ...extra }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders() })
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
    status: 405,
    headers: responseHeaders({ Allow: allow }),
  })
}

// 部署形态：handler 里没有状态，模块作用域上建一次就够，请求之间可以共用。
const handleRequest = createTelemetryHandler()

/**
 * Worker 的入口。
 *
 * 单独写成一个有名的函数而不是直接内联进 `export default`：入口是部署之后最先要去的一行，
 * 它应该能被搜到、能被打断点。运行时还会传第三个参数 `ExecutionContext`，这里用不到，
 * 不声明即可。
 */
export function workerFetch(request: Request, env: TelemetryEnv): Promise<Response> {
  return handleRequest(request, env)
}

export default { fetch: workerFetch }
