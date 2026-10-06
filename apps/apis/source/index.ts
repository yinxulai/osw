/**
 * 匿名使用统计的上报端点（Cloudflare Worker）。
 *
 * 它是**客户端与下游分析服务之间唯一的一层**，只干三件事（见 `apps/docs/specs/telemetry.md` §7）：
 *
 * 1. **严格校验**：用客户端同一份 schema 解析，拒绝多余字段；
 * 2. **补服务端事实**：服务器时钟，以及客户端所在的国家；
 * 3. **交给下游**：具体去哪个后端由 `source/sinks/` 决定，这里不知道也不需要知道。
 *
 * 第 3 条被单独拎出来，是因为**它可替换**：换分析后端只写一个新 sink 文件并改 `createSink`
 * 一处，收报文、校验这些与下游无关的事一行都不动（见 `source/sink.ts`）。现在的下游是
 * **本账号内的一个 Analytics Engine 数据集**（`source/sinks/analytics-engine.ts`），写入是一次
 * 本地调用：没有地址、没有凭证、没有转发超时。
 *
 * 请求路径只有 `/v1/track` 一条（`TELEMETRY_REQUEST_PATH`），其余一律 404，根路径也不例外。
 * 刻意不为部署流水线另加一个健康检查接口：域名上「唯一一条路径」本身就是最强的信号，
 * 而部署后真正要确认的只有「路由注册上了没有」——对 `GET /v1/track` 期待 405 就回答了它，
 * 那是一个只可能来自本 Worker 的答案。
 *
 * 为什么必须有这一层，而不是让客户端直接打下游：下游的接入方式（上一版是一个密钥，这一版是
 * 一段绑定）只应该存在于这里。桌面应用里嵌的任何凭证都能被解出来，所以「客户端不持有下游
 * 凭证」不是可选的组织方式，是唯一的正确形态。也因此这里**不做客户端鉴权**——它只能提供虚
 * 假的安全感（§7）。
 *
 * 端点地址是客户端里唯一写死的地址，**发布出去就是永久地址**：换下游、换存储、换数据驻留
 * 区域都只动这个 Worker。所以这里对客户端承诺的是**请求格式**（`/v1/track`），不是数据去向。
 *
 * ## 关于地理位置
 *
 * 这一层会把**来源国家**（`CF-IPCountry`，由 Cloudflare 在边缘按真实客户端 IP 判好，客户端
 * 伪造不了）当作一项服务端事实交给 sink。
 *
 * **给的是结论，不是原料**：`CF-IPCountry` 是一枚两字母的代码，比一个能定位到人的地址粗得多，
 * 而这一步 Cloudflare 已经算完了——把 IP 再往下递换不到任何更准的答案，只是让链路上多留一份
 * 原始用户信息。于是**客户端的地址从头到尾没有被读过**：进存储的只有契约里的枚举值
 * 与这一枚国家代码。
 *
 * 拿不到国家时 sink 把这一列写成空串，**绝不退回请求自身的来源地址**：那只会得到「所有人都来自
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
 *
 * ## 关于日志
 *
 * **每一个非 2xx 出口都留一行**，形状统一、由 `source/log.ts` 收口；2xx 不打（理由见那个
 * 文件）。这曾经是一处真实缺口：唯一那个 500（`not_configured`）当时**没有任何日志**，于是
 * 现场只剩下客户端那句 `telemetry endpoint responded with 500`——状态码有了，原因要人去翻
 * 代码才知道。而它恰恰是部署期最容易犯的错（绑定那一段写漏了），也恰好是唯一一个「看到就能
 * 直接修」的失败。最容易犯的错必须是日志里最响的一条，不能是最静的一条。
 * */

import {
  TelemetryBatchSchema,
  TELEMETRY_MAX_REQUEST_BYTES,
  TELEMETRY_REQUEST_PATH,
  type TelemetryEvent,
} from '@common/telemetry'
import { logOutcome } from './log'
import type { TelemetrySink } from './sink'
import { createAnalyticsEngineSink, type AnalyticsEngineDatasetBinding } from './sinks/analytics-engine'

/**
 * Worker 的绑定。
 *
 * 只有一项：写入数据集（`wrangler.toml` 里的 `[[analytics_engine_datasets]]`）。它是一个**绑定**
 * 而不是 secret——没有密钥、没有区域地址，也不能被别人拿到别处去。于是这一层曾经的「部署时
 * 忘了 `wrangler secret put`」那一类部署事故**结构上不存在了**。
 *
 * 名字跟的是**角色**（`TELEMETRY`）而不是下游是谁。上一版它叫 `APTABASE_APP_KEY`，理由是
 * 「不同后端的凭证本来就不是同一样东西」；这个理由在绑定上是反过来的:绑定本来就是一种通用
 * 形态（任何后端都能包成一个绑定对象），而 `env.TELEMETRY` 这种名字让「代码引用的是谁」与
 * 「下游是谁」彻底解耦——换后端时这个文件只剩导入与 `createSink` 两行要改。
 *
 * 宣告成可选是因为「没绑上」是一种必须能表达的运行状态：`wrangler.toml` 少了一段就会这样，
 * 而那时应该回 500 并点名它（见下面那段）。
 */
export interface TelemetryEnv {
  TELEMETRY?: AnalyticsEngineDatasetBinding
}

export type TelemetryHandler = (request: Request, env: TelemetryEnv, now?: number) => Promise<Response>

/**
 * 造一个 handler。
 *
 * 刻意**没有任何可注入项**。上一版收一个 `fetcher` 参数，因为那时「那次 HTTP」是唯一的对外
 * 依赖、也是测试最想替换的东西。这一版的下游是一次本地调用，而它已经藏在 sink 后面了
 * （测试直接造一个 sink 就行，不必经过 handler），所以这里不再需要那个接缝。
 */
export function createTelemetryHandler(): TelemetryHandler {
  return async function handle(request, env, now = Date.now()) {
    // ---- 1. 路由：只有一条路径，只有一种方法 ----

    // 只认一条路径。不在它上面的一律 404（根路径也是）：域名上**没有**「不知道为什么有回应」
    // 的地址，包括不给运维探针留位置——那件事由 `GET /v1/track` 的 405 回答，见文件头。
    const path = new URL(request.url).pathname
    if (path !== TELEMETRY_REQUEST_PATH) {
      // 未知路径也记一行，并且**带上路径**：老客户端停在旧地址（`/v1/events`）是真实会发生的，
      // 而没有这行日志时它和「有人在扫这个域名」长得一模一样——两种都不是能看到答案的事。
      // 路径来自请求，所以得先洗一遍（见 `log.ts`）。
      logOutcome(404, 'not_found', { path })
      return json(404, { ok: false, error: 'not_found' })
    }

    if (request.method !== 'POST') {
      // 这行同时是部署探针的落点：对 `GET /v1/track` 期待 405 的那个人，会在这里看到一条
      // 带路径与方法的记录，而不是只有一个状态码。
      logOutcome(405, 'method_not_allowed', { method: request.method })
      return methodNotAllowed('POST')
    }

    const contentType = request.headers.get('content-type')
    if (!isJsonContentType(contentType)) {
      // 同样带上原始值：客户端发错 `Content-Type`（比如忘了设、设成了 `text/plain`）是
      // 这条链路上最常见的客户端错，而错误码本身只说「不接受」。
      logOutcome(415, 'unsupported_media_type', { content_type: contentType ?? '<none>' })
      return json(415, { ok: false, error: 'unsupported_media_type' })
    }

    // ---- 2. 下游：缺配置就说清楚，不能静默丢数据 ----

    // `createSink` 是**全 Worker 唯一知道选的是哪个后端的地方**。换后端时只改它。
    const sink = createSink(env)
    if (sink === null) {
      // ⚠️ 全 Worker 唯一一个 500，而原因只有一个：数据集没绑上（`wrangler.toml` 里那段
      // `[[analytics_engine_datasets]]` 没写、写到了别的 Worker / 别的环境）。所以这一行
      // **必须点名缺的是哪一项**——「少了一个绑定」与「少的是 `TELEMETRY`」之间，差的正好
      // 是拿去修的那一步。
      logOutcome(500, 'not_configured', { missing: 'TELEMETRY' })
      return json(500, { ok: false, error: 'not_configured' })
    }

    // ---- 3. 严格校验 ----

    const text = await request.text()
    const size = byteLength(text)
    if (size > TELEMETRY_MAX_REQUEST_BYTES) {
      // 带上实际字节数：只有一个「太大了」时，修的人还得先量一遍才知道差了多少。
      logOutcome(413, 'payload_too_large', { bytes: size, limit: TELEMETRY_MAX_REQUEST_BYTES })
      return json(413, { ok: false, error: 'payload_too_large' })
    }

    const payload = parseJson(text)
    if (payload === null) {
      logOutcome(400, 'invalid_json', { bytes: size })
      return json(400, { ok: false, error: 'invalid_json' })
    }

    const parsed = TelemetryBatchSchema.safeParse(payload)
    if (!parsed.success) {
      // 回显前几条问题：客户端开发者要能自己看出报文哪里不对，而这里没有任何秘密可泄露
      // （schema 是开源的、端点本来也没有鉴权）。
      const issues = parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      // 日志里只留第一条：它几乎总是根因，而五条会把一行撑成五行，反而没人看。
      logOutcome(400, 'invalid_payload', { issue: issues[0] ?? null })
      return json(400, { ok: false, error: 'invalid_payload', issues })
    }

    // ---- 4. 一批只能来自一台设备 ----

    const events = parsed.data.events
    if (!isSingleDevice(events)) {
      // 只说「几条事件混了」，**不说标识与平台**：这一行要给的是「客户端把两批并成了一批」
      // 这个结论，而具体是哪两台设备正在混，正好是最不该落盘的那一点信息。
      logOutcome(400, 'mixed_batch', { events: events.length })
      return json(400, { ok: false, error: 'mixed_batch' })
    }

    // ---- 5. 交给下游：本 Worker 的职责到此为止 ----

    // 没有削平、没有拼报文、没有字段去向：那全是 sink 的事。这一层只提供两项服务端事实
    // （服务器时钟与来源国家），因为只有它看得到 HTTP、也只有它读得到 Cloudflare 填的头。
    const outcome = await sink.forward(events, { receivedAt: now, countryCode: countryOf(request) })
    if (outcome.ok) return new Response(null, { status: 204 })

    // 从这里往下只有一行日志，不说「谁在发」：没有安装标识、没有来源地址、没有报文正文。
    // `wrangler.toml` 把 `[observability]` 打开，等的就是它们。带上 `sink` 名是为了将来同时挂
    // 两个下游时这些行还能分开。
    //
    // 上一版这里有两个分支（`unreachable` / `rejected`），各带一项下游才给得出的补充
    // （`reason` / `upstream_status`）。这一版只有一种失败，也就不再有可补充的东西（见
    // `sink.ts` 里那张表）。
    //
    // ⚠️ 反过来，204 **不代表事件入库**：绑定不接受无效的数据点，它只是静默地把它丢掉。
    // 验收得看数据集里的查询结果（telemetry.md §10）。
    logOutcome(502, 'not_delivered', {
      sink: sink.name,
      events: events.length,
    })
    return json(502, { ok: false, error: 'not_delivered' })
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
 * 上一版这里还要「不猜密钥格式」一段自歉，因为密钥是手拼给 `wrangler secret put` 的，且它里面
 * 还藏着区域、可能跟入口地址矛盾。绑定把这些全题都消掉了：`TELEMETRY` 是或不存，没有格式
 * 可猜，也不存在「区域写错了」这种部署形态。于是这个函数只剩「存不存在」一件判断。
 */
function createSink(env: TelemetryEnv): TelemetrySink | null {
  const dataset = env.TELEMETRY
  if (dataset === undefined) return null
  return createAnalyticsEngineSink({ dataset })
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
