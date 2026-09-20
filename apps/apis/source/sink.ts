/**
 * 上报链路的**下游接口**：一个后端就是一个实现，一个后端就是一个文件。
 *
 * 这一层存在的理由是**把「我们采集了什么」与「它被存到哪里」分开**（telemetry.md §6）。
 * `index.ts` 只负责收——路由、校验、限流——它不知道下游是谁，也不该知道；换分析后端时，
 * 收报文这一侧一行都不用动。
 *
 * 于是「换后端」的成本被压到两处：
 *
 * 1. 在 `source/sinks/` 下新写一个实现（它只做「我们的数据 → 它的报文」这一件纯事）；
 * 2. 改 `index.ts` 里的 `createSink` —— 全 Worker 唯一知道「选的是哪个后端」的地方。
 *
 * 接口刻意只接受两样东西：**已经校验过的事件**（契约的形状，见 `@common/telemetry`）与
 * **只有服务端才知道的事实**（`TelemetryForwardContext`）。不给 `Request`、不给原始报文、
 * 不给 `env`：适配器不该有能力看到 HTTP 细节，也不该有办法顺手读到别的密钥。它拿到的是
 * 语义，不是传输。
 *
 * 反过来，接口**不承诺下游怎么用这些字段**。事件名直接沿用契约名、属性怎么摆、时间戳写哪、
 * 回溯窗口多长、凭证放正文还是放请求头，都是下游自己的事（Aptabase 有一套自己的保留属性
 * 与一天的时间窗，将来接别的后端又可能落在别处）。任何「因为下游 A 要那样所以契约里加个
 * 字段」的改动都应该被拒绝：那是适配器的事。
 */

import { type TelemetryEvent } from '@common/telemetry'
import { oneLine } from './log'

/** 一次转发要用的 `fetch`。写成别名是为了让「可以在测试里换掉」这件事在签名上一眼可见。 */
export type Fetcher = typeof fetch

/**
 * 服务端在转发那一刻知道、而客户端不知道（或不该由客户端说了算）的事实。
 *
 * 只有两项，因为它们就是仅有的两项：
 * - **服务器时钟**：客户端改系统时间伪造不出「什么时候收到的」；
 * - **来源国家**：转发请求是从 Cloudflare 机房发出的，下游按请求来源 IP 去猜只会猜到机房
 *   所在地；拿不到时为 `null`（`CF-IPCountry` 缺失，或 Cloudflare 判的是「不知道」），
 *   此时 sink **必须**放弃地理归属，而不是退回请求自身的来源地址——那只会得到「所有用户
 *   都来自机房」的假答案。
 *
 * **给的是国家代码，不是 IP。** 这是刻意选的粒度：地理归属 Cloudflare 在边缘就已经算完了，
 * `CF-IPCountry` 是一枚两字母的结论，把 IP 再往下递只是在转发链路上多留一份原始用户信息，
 * 换来的却是同一个答案。所以这里是**结论**而不是**原料**——适配器没有能力把它还原成地址，
 * 那正是这层接口想要的约束。
 */
export interface TelemetryForwardContext {
  /** 服务端收到请求的时刻（毫秒）。 */
  receivedAt: number
  /** 来源国家，ISO 3166-1 alpha-2；拿不到为 `null`。 */
  countryCode: string | null
}

/**
 * 「下游没有回答」是哪一种。**只有两种，因为只有两种排查方向。**
 *
 * - `timeout`：我们自己那个定时器按下的。指向「下游慢」——该看它的状态页，或考虑把
 *   `FORWARD_TIMEOUT_MILLISECONDS` 放宽；
 * - `error`：别的一律归这里（DNS、TLS、被重置、进程里抛错）。指向「这次请求根本没到
 *   对方手里」——该看出入口与地址。
 *
 * 再往下细分就不必了：那是 Cloudflare 的日志该说的话，不是我们能在这一层编出来的。
 */
export type TelemetryUnreachableReason = 'timeout' | 'error'

/**
 * 一次转发的结果。**分三态而不是布尔**：「连不上」与「对方收了但拒了」对运维是两件事
 * （前者看网络与出入口，后者看凭证与报文），合并成一个 `false` 就等于把这条线索扔掉。
 *
 * 三态各自还带一项**只给日志用**的补充：连不上时是哪一种（`reason`），被拒时对方说了什么
 * （`detail`）。它们不参与任何判断——调用方看的是 `failure`——但没有它们，这一层交出去的
 * 就只剩「失败了」三个字，而那正好是最需要一行日志时的全部内容。
 */
export type TelemetryForwardOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: 'unreachable'; readonly reason: TelemetryUnreachableReason }
  | { readonly ok: false; readonly failure: 'rejected'; readonly status: number; readonly detail: string | null }

/** 一个下游。 */
export interface TelemetrySink {
  /**
   * 后端名，只用于日志（`status=502 error=upstream_rejected sink=aptabase upstream_status=…`）。
   * 将来同时挂两个下游时，靠它把两行分开。
   */
  readonly name: string

  /**
   * 把一批事件交给这个后端。
   *
   * **不抛异常**：连不上与拒收都是返回值。调用方只关心「这批数据出去了没有、没出去是哪种」，
   * 而异常会在 Cloudflare 那边变成一次 500 与一条栈，把一次普通的下游故障描述成一个 bug。
   */
  forward(events: readonly TelemetryEvent[], context: TelemetryForwardContext): Promise<TelemetryForwardOutcome>
}

/**
 * 一次下游请求的超时（毫秒）。
 *
 * **必须短于客户端的超时**（`TELEMETRY_REQUEST_TIMEOUT_MILLISECONDS`，5 秒）：否则客户端会先
 * 放弃，而请求已经发了出去——那是「客户端以为失败了、下游其实收到了」的最坏情形。统计能容忍
 * 重复与丢失，但没有理由主动制造它。
 *
 * 它写在这一层而不是某个后端里：这是「我们愿意为一次转发等多久」的链路决策，
 * 与后端是谁无关。
 */
export const FORWARD_TIMEOUT_MILLISECONDS = 3_000

/** `postJson` 的回答：要么一个响应，要么「没有回答」加上是哪一种（见 `TelemetryUnreachableReason`）。 */
export type PostJsonResult =
  | { readonly ok: true; readonly response: Response }
  | { readonly ok: false; readonly reason: TelemetryUnreachableReason }

/**
 * 发一个 JSON POST。**失败与超时都折成一个返回值，绝不抛。**
 *
 * 唯一被接受的「回答」是一个 HTTP 响应；「没有回答」的后果也只有一种（这批数据没出去），
 * 所以 DNS、TLS、被重置、中途断开全归一类。但**「是我们按下的超时」要单独拎出来**：它也
 * 有一种后果，指向的方向却与前面几个相反（下游慢 vs. 请求没到）。把这一项省掉的代价，就是
 * 那条日志里除了「连不上」之外一个字都说不出。
 *
 * `headers` 是**留给下游自己的位置**：凭证放请求头（有的后端就是这么设计的）还是放正文，
 * 是下游的规矩，这一层不替它决定。这里唯一不变的部分是「正文是 JSON」。
 */
export async function postJson(url: string, body: unknown, fetcher: Fetcher, headers: Record<string, string>): Promise<PostJsonResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MILLISECONDS)
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    return { ok: true, response }
  } catch {
    // 这个控制器只有我们自己那个定时器会用，所以「信号已置位」就等于「是我们按的」。
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'error' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 读一次**失败**响应的正文，只为了日志。
 *
 * 「下游为什么拒收」只有下游自己说的那一句话能回答。状态码回答不了：400 可能是密钥不对、
 * 可能是一条事件超长、也可能是整批太大，三者的处置完全不同。
 *
 * 只读失败响应：成功那一边没有可读的东西，而多读一次正文就是多等一次下游。读不出来
 * （正文已被读过、连接在中途断了）返回 `null`——诊断信息的缺失不该把一个已经判定清楚的
 * 失败变成另一种失败。
 *
 * 正文可能很长（有的后端会回一整页 HTML），所以洗一遍再截断，且**只留一行**：它最终会被
 * 拼进一条日志里。
 */
export async function readErrorDetail(response: Response, maxLength = 200): Promise<string | null> {
  try {
    const text = (await response.text()).trim()
    return text === '' ? null : oneLine(text, maxLength)
  } catch {
    return null
  }
}
