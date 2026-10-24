/**
 * 上报链路的**下游接口**：一个后端就是一个实现，一个后端就是一个文件。
 *
 * 这一层存在的理由是**把「我们采集了什么」与「它被存到哪里」分开**（telemetry.md §6）。
 * `index.ts` 只负责收——路由、校验——它不知道下游是谁，也不该知道；换分析后端时，
 * 收报文这一侧一行都不用动。
 *
 * 于是「换后端」的成本被压到两处：
 *
 * 1. 在 `source/sinks/` 下新写一个实现（它只做「我们的数据 → 它的形状」这一件纯事）；
 * 2. 改 `index.ts` 里的 `createSink` —— 全 Worker 唯一知道「选的是哪个后端」的地方。
 *
 * 接口刻意只接受两样东西：**已经校验过的事件**（契约的形状，见 `@common/telemetry`）与
 * **只有服务端才知道的事实**（`TelemetryForwardContext`）。不给 `Request`、不给原始报文：
 * 适配器不该有能力看到 HTTP 细节。它拿到的是语义，不是传输。
 *
 * 反过来，接口**不承诺下游怎么用这些字段**。事件名直接沿用契约名、属性怎么摆、时间戳写哪、
 * 回溯窗口多长、要不要凭证，都是下游自己的事（上一版的下游有一整套保留属性与一天的
 * 时间窗；这一版是 Cloudflare 的数据集，两者没有任何共同形状）。任何「因为下游 A 要那样
 * 所以契约里加个字段」的改动都应该被拒绝：那是适配器的事。
 *
 * ## 这一版把「等一个下游」整个删掉了
 *
 * 上一版的下游是一个外部 HTTP 服务，于是这一层有过 `Fetcher`、`postJson`（带超时）、
 * `readErrorDetail`、`FORWARD_TIMEOUT_MILLISECONDS`，以及「连不上」与「被拒收」两种失败。
 * 这一版的下游是**同一个账号里的一个数据集**，写入是一次本地调用（见
 * `sinks/analytics-engine.ts`）：没有地址、没有凭证、没有网络往返，也就没有超时。
 *
 * 所以那些机制**被删掉而不是留着不用**。留着的代价不是那几行代码，而是它们会让读的人以为
 * 「下游可能很慢」「下游可能拒收我们」这两件事仍然成立——而它们已经不成立了。
 *
 * 唯一从上一版留下来的东西是 `TelemetryForwardContext`：它描述的是「服务端才知道的事」，
 * 与下游是哪种形态无关。
 */

import { type TelemetryEvent } from '@common/telemetry'

/**
 * 服务端在转发那一刻知道、而客户端不知道（或不该由客户端说了算）的事实。
 *
 * 只有两项，因为它们就是仅有的两项：
 * - **服务器时钟**：客户端改系统时间伪造不出「什么时候收到的」；
 * - **来源国家**：client 的地址从头到尾没有被读过，所以存储侧不可能自己推出来。
 *   拿不到时为 `null`（`CF-IPCountry` 缺失，或 Cloudflare 判的是「不知道」），
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
 * 一次转发（写入）的结果。**两态，而失败只有一种。**
 *
 * 上一版是三态，因为「连不上」与「对方收了但拒了」对运维是两件事。这一版只剩一件事会失败：
 * **这次调用没能把数据点交出去**。写入绑定不回答任何东西，所以没有状态码、没有对方的解释，
 * 也就没有可以再分的一类。
 *
 * 这不是「把细节简化掉了」，而是下游真的不再产生这些细节：没有网络，就没有网络故障。
 * 因此失败时不带任何补充字段——留一个恒为 `null` 的 `status` 只会让人以为某条路径会填它。
 *
 * ⚠️ 反过来，`ok: true` **只说明数据点交出去了，不说明它入库了**：不合法的数据点会被运行时
 * 静默丢掉（见 `sinks/analytics-engine.ts` 的文件头）。这一层没有能力回答那个问题，任何后端
 * 也都没有——验收看的是存储侧的查询结果，不是端点的状态码（telemetry.md §10）。
 */
export type TelemetryForwardOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: 'not_delivered' }

/** 一个下游。 */
export interface TelemetrySink {
  /**
   * 后端名，只用于日志（`status=502 error=not_delivered sink=analytics-engine events=12`）。
   * 将来同时挂两个下游时，靠它把两行分开。
   */
  readonly name: string

  /**
   * 把一批事件交给这个后端。
   *
   * **不抛异常**：写入失败是返回值。劫持一个异常上去会在 Cloudflare 那边变成一次 500 与一条栈，
   * 把一次普通的下游故障描述成一个 bug，而调用方本来只想把这次失败记进日志、回一个 502。
   */
  forward(events: readonly TelemetryEvent[], context: TelemetryForwardContext): Promise<TelemetryForwardOutcome>
}
