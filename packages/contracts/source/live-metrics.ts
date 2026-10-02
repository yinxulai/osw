/**
 * 实时指标的数据契约与模板引擎。
 *
 * 「指标」本身是**标准的**：一组已经算成最终数值的字段（{@link LiveMetrics}） +
 * 一份由用户书写的模板。它**不**绑定任何一个展示面——菜单栏标题、应用窗口上的角标，
 * 只是同一个指标的两块画布。所以这个文件里没有任何「托盘」字样：谁要把指标画到哪儿，
 * 是调用方的事，不是指标的事。
 *
 * 三件事在这里定死，别处一律从这里取：
 *
 * 1. **指标快照的形状**（{@link LiveMetrics}）：服务进程算好，其它进程/进程内直接拿去渲染。
 *    它只放「已经算成最终数值」的字段，不放任何原始台账——渲染方不该再理解一遍口径。
 * 2. **模板变量的清单与取值**（{@link LIVE_METRIC_VARIABLES}）：变量名面向人而不是面向代码，
 *    因为用户要在设置里手写模板。清单同时是设置界面的变量说明来源，杜绝「文档说的变量
 *    和引擎认识的变量」两份。
 * 3. **渲染函数**（{@link renderLiveMetric}）：纯函数，输入模板与快照，输出一行文本。
 *
 * ## 为什么变量名是显式枚举（`liveTps` / `activeRequests`）而不是含糊的 `tps`
 *
 * 用户要的是几件**明确**的事：最近一次已知的输出速度、此刻并发请求。写成
 * `tps` / `requests` 会把不同口径的东西压成含糊的词——是单条还是合计，读不出来。所以变量名
 * 本身就把口径说完：`liveTps` 是「最近一次已知的输出速度」、`activeRequests` 是此刻并发数。
 *
 * ## 速度口径：优先在途请求，回落最近一条已落定请求
 *
 * 菜单栏/角标只有一格。用户刚发出的那条正是他此刻在等的，有在途请求时显示它的实时 TPS
 * 最符合直觉：合计会把并发压成一个与任何单条都对不上的数，取最大则会在用户切去看另一条时
 * 突然跳到别的请求上。而「字节/秒」虽然更容易在途取到（每个分块一到达就已知），却衡量的是
 * 响应体量而非 Token 产出——对 AI 来说，用户真正关心的是每秒出多少个 Token，所以坚持 TPS。
 * 一条请求刚跑完、新的还没来时，回落到内存里最近一条已落定请求的最终速度，而不是立刻翻成
 * `--`——「我这条到底多快」是同一个问题的另一种问法。但这条回落**有时限**（
 * {@link LIVE_METRIC_SETTLED_TTL_MILLISECONDS}）：实时数据的时间语义是「此刻」，一条早就跑完
 * 的请求在几秒后还占着那一格，读起来像「现在正这么跑」——那是错的。过了时限就翻回 `--`，
 * 让「此刻没有」重新如实。
 *
 * 代价是：上游常在收尾那一帧才报输出 Token（见 `apps/docs/specs/observability.md`），一个
 * 刚开始、还没吐字的请求本来取不到速度。两条兜底让这一格几乎不空着：正文一旦开始流动，
 * 观察者会用**正文估算**的输出 Token 顶上（真实用量到达后立刻覆盖）；连在途速度都没有时，
 * 回落到内存里**最近一条已落定请求**跑出的最终速度——但只在这条请求刚落下不久、还在时限内
 * 时才显示。只有内存里一条算得出速度、且还在时限内的请求都没有，才显示 `--`——**没有速度**
 * 和**速度为零**本来就该分开。
 *
 * ## 取值口径
 *
 * - 输出速度公式只有一份，在 `@common/metrics`（{@link tokensPerSecondFromTotals}）；
 *   本文件不重写，只调用。
 * - 没有值（没有在途速度、也没有时限内算得出速度的已落定请求）的变量渲染成 `--`。**零也渲染成 `--`**：指标条上
 *   一个 `0` 分不清「真的没有在跑」还是「页面没接上数」，而 `--` 明确指向「此刻没有」。
 *   它是一条给眼睛扫的状态条，不是一个要对账的计数。
 *
 * 主进程、服务进程、渲染进程三边都会 import 这个文件，所以它必须保持零 Node 依赖。
 */

import { formatOutputSpeed, tokensPerSecondFromTotals } from './metrics'
import type { LiveRequest, LiveRequestAttempt } from './schemas'

/** 指标里「这个变量此刻没有值」的统一写法。用户可读、宽度稳定、不会与数字混淆。 */
export const LIVE_METRIC_UNAVAILABLE = '--'

/**
 * 默认模板：最近一次已知的输出速度 + `TPS` 单位。
 *
 * 用户没配过模板时就是它，设置页里也拿它当占位示例——两处共用同一个常量，
 * 不会出现「默认值和界面上写的示例不一致」。
 *
 * `TPS` 单位写在模板里而不是变量里：数值本身只是一串数字，单位是用户对这段文本的排版选择，
 * 想只留数字、或换成 `t/s` 都在模板这一层决定。
 */
export const DEFAULT_LIVE_METRIC_TEMPLATE = '{liveTps} TPS'

/**
 * 模板允许的最大长度。
 *
 * 菜单栏是系统共享的、窗口角标也只是一条窄带，一段过长的文本会把旁边的状态挤走。
 * 64 个字符足够写下「速度 + 并发数 + 累计用量」几件事，又不至于失控；超长由渲染函数
 * 直接截断，而不是把一个撑爆的字符串交给调用方。
 */
export const MAX_LIVE_METRIC_LENGTH = 64

/**
 * 已落定请求的速度还能顶替多显示一会儿的时限（毫秒）。
 *
 * 回落是为了让「刚跑完」的那一格不立刻翻成 `--`，但实时数据的语义是**此刻**：一条几秒前
 * 就跑完的请求还挂在上面，读起来会像「现在正这么跑」。所以回落带一条短时限——一条请求落定
 * 超过这么久，就不再拿它的速度充数，格子如实回到 `--`。5 秒够覆盖「刚发完、下一条还没来」
 * 的空窗（人眼对「刚刚」的判定大致就是这个量级），又不至于让旧值赖着不走。
 */
export const LIVE_METRIC_SETTLED_TTL_MILLISECONDS = 5_000

/**
 * 指标快照。
 *
 * 所有字段都是「已经算完的数」：`null` 表示此刻取不到（没有在途请求 / 还没有输出 Token），
 * 与 `0`（真值为零）是两件事。渲染层不做任何再计算。
 */
export interface LiveMetrics {
  /**
   * 最近一次**已知**的输出速度（TPS）。
   *
   * 有在途请求时是它的实时速度；没有在途速度时回落到内存里最近一条已落定请求的最终速度，
   * 但**仅在这条已落定请求落定后 {@link LIVE_METRIC_SETTLED_TTL_MILLISECONDS} 以内**。内存里
   * 没有任何算得出速度、且还在时限内的请求时为 `null`。这个数回答「刚发的那条现在多快，或最近
   * 一条到底多快」，是全应用唯一的速度口径——不再有「最大 / 合计」两套聚合。
   */
  liveTps: number | null
  /** 此刻正在进行、且已进入上游阶段的请求条数。 */
  activeRequests: number
}

/** 请求的最新一次尝试；没有任何尝试时为 `null`。故障转移时最新一次才是「正在跑」的那条。 */
function liveAttemptOf(request: LiveRequest): LiveRequestAttempt | null {
  return request.attempts[request.attempts.length - 1] ?? null
}

/**
 * 此刻「最近一个在途请求」：所有还没落定（`pending`）的请求里，开始时间最晚的那条。
 *
 * 为什么锤定「最近一个」而不是「最快的」或「合计的」：菜单栏只有一格，用户刚发出的那条正是
 * 他此刻在等的。合计会把并发请求压成一个与任何单条都对不上的数；取最大则会在用户切去看另一条
 * 时突然跳到另一个请求上。没有在途请求时返回 `null`。
 *
 * 并列（`startedAt` 相同）时保留先遇到的那条：台账按开始时间倒序给出，先遇到的即最新的。
 */
function liveRequestOf(requests: readonly LiveRequest[]): LiveRequest | null {
  let latest: LiveRequest | null = null
  for (const request of requests) {
    if (request.status !== 'pending') continue
    if (latest === null || request.startedAt > latest.startedAt) latest = request
  }
  return latest
}

/** 一条已落定请求的最终输出速度，连同它落定的时刻：输出 Token ÷ 那段**已经冻结**的尝试耗时。 */
function settledSpeedOf(request: LiveRequest): { at: number; tps: number } | null {
  if (request.status === 'pending') return null
  const attempt = liveAttemptOf(request)
  if (attempt === null || attempt.outputTokens === null) return null
  const endedAt = attempt.endedAt ?? request.endedAt
  if (endedAt === null) return null
  const tps = tokensPerSecondFromTotals(attempt.outputTokens, endedAt - attempt.startedAt)
  if (tps === null) return null
  return { at: endedAt, tps }
}

/**
 * 内存里最近一条已落定、算得出速度、且**还在时限内**的请求的速度；没有时返回 `null`。
 *
 * 时限是这条回落的**全部要点**：实时数据回答「此刻」，一条落定超过
 * {@link LIVE_METRIC_SETTLED_TTL_MILLISECONDS} 的请求已经不属于「此刻」，再拿它的速度充数
 * 就等于把「刚才」说成「现在」。判据用请求自己的落定时刻算，与进程跑了多久无关。
 */
function mostRecentSettledTps(requests: readonly LiveRequest[], now: number): number | null {
  let latest: { at: number; tps: number } | null = null
  for (const request of requests) {
    const speed = settledSpeedOf(request)
    if (speed === null) continue
    if (latest === null || speed.at > latest.at) latest = speed
  }
  if (latest === null) return null
  if (now - latest.at > LIVE_METRIC_SETTLED_TTL_MILLISECONDS) return null
  return latest.tps
}

/**
 * 最近一次**已知**的输出速度（TPS）。
 *
 * 优先取「此刻」：有在途请求时，是那条请求**最新一次尝试**的输出 Token ÷ `now - startedAt`，
 * 数值随请求进行而收敛，正是「实时」的含义。取不到在途速度（没有在途请求、或那条请求还没读到
 * 输出 Token）时，回落到内存里**最近一条已落定请求**的最终速度（输出 Token ÷ 那段已冻结的
 * 尝试耗时）——菜单栏/角标只有一格，一条请求刚跑完，显示它刚跑出的速度，比立刻翻成 `--` 更
 * 符合「我这条到底多快」的直觉。但这条回落**只在这条请求落定后
 * {@link LIVE_METRIC_SETTLED_TTL_MILLISECONDS} 以内**成立：实时数据的时间语义是「此刻」，一条
 * 早已跑完的请求还占着那一格，读起来像「现在正这么跑」。
 *
 * 分子分母必须同源（见 `metrics.ts`）：没有输出 Token 就没有分子，耗时不正就没有分母。
 * 两档都取不到（没有在途速度、也没有时限内算得出速度的已落定请求）时返回 `null`，渲染成
 * `--`——**没有速度**和**速度为零**是两件事。时长口径与落库侧的
 * `requestOutputTokensPerSecond` 完全一致。
 */
export function liveTps(requests: readonly LiveRequest[], now: number): number | null {
  const request = liveRequestOf(requests)
  if (request !== null) {
    const attempt = liveAttemptOf(request)
    if (attempt !== null && attempt.outputTokens !== null) {
      const speed = tokensPerSecondFromTotals(attempt.outputTokens, now - attempt.startedAt)
      if (speed !== null) return speed
    }
  }
  return mostRecentSettledTps(requests, now)
}

/**
 * 此刻在途、且已进入上游阶段的请求条数。
 *
 * 比速度判据宽一档：`connecting`（刚建连、还没吐字）也算「正在进行」——
 * 用户问的是「有几条在跑」，不是「有几条已经在出字」。
 */
export function activeRequestCount(requests: readonly LiveRequest[]): number {
  let count = 0
  for (const request of requests) {
    if (request.status !== 'pending') continue
    const attempt = request.attempts[request.attempts.length - 1]
    if (attempt === undefined) continue
    if (attempt.state === 'connecting' || attempt.state === 'awaiting-upstream' || attempt.state === 'streaming') count += 1
  }
  return count
}

/**
 * 把台账快照合成一份指标快照。
 *
 * 这是**唯一的合成点**：服务进程（推给主进程渲染托盘、塞进 HTTP 推送流给窗口）与
 * 渲染进程（直接算）都调它，保证同一个模板在任何画布上取到同一批数。
 */
export function computeLiveMetrics(requests: readonly LiveRequest[], now: number): LiveMetrics {
  return {
    liveTps: liveTps(requests, now),
    activeRequests: activeRequestCount(requests),
  }
}

/**
 * 模板变量的名字，是引擎唯一认识的集合。
 *
 * 写成字面量联合而不是 `string`：设置界面要靠它把「变量名 → 说明文案」做成一张编译期
 * 可穷尽的表，漏一个变量会在类型层面直接报出来，而不是等到界面上出现一个空的说明。
 */
export type LiveMetricVariableName = 'liveTps' | 'activeRequests'

/**
 * 模板变量的声明。
 *
 * `name` 是模板里 `{name}` 用的标识；`sample` 是它在设置界面变量说明里展示的示例文本。
 * 两样放在同一处，界面直接遍历渲染，不需要另写一份说明。
 */
export interface LiveMetricVariable {
  name: LiveMetricVariableName
  sample: string
}

/** 模板可用的全部变量，顺序即设置界面的展示顺序。 */
export const LIVE_METRIC_VARIABLES: readonly LiveMetricVariable[] = [
  { name: 'liveTps', sample: '42' },
  { name: 'activeRequests', sample: '3' },
]

const KNOWN_VARIABLE_NAMES = new Set<string>(LIVE_METRIC_VARIABLES.map(variable => variable.name))

/** `{name}` 占位符；与 i18n 的插值正则同形，便于同一套心智。 */
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g

/** 模板里出现的变量名（去重、保序）。未知变量也会被列出，供界面做提示。 */
export function liveMetricVariablesOf(template: string): string[] {
  const names: string[] = []
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

/** 模板里是否出现了引擎不认识的变量名。 */
export function hasUnknownLiveMetricVariable(template: string): boolean {
  return liveMetricVariablesOf(template).some(name => !KNOWN_VARIABLE_NAMES.has(name))
}

/**
 * 把一个原始计数翻成展示文本：没有值、或值为零时都写 `--`。
 *
 * `null` 是「没有值」，`0` 是「真的没有」——对一条给眼睛扫的状态条来说两者没有区别，都会
 * 被读成「现在没有」。一个孤零零的 `0` 反而多出第三种解读（页面没接上数），所以零也归到
 * `--`。见文件头「取值口径」。
 */
function asUnavailable(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value === 0) return LIVE_METRIC_UNAVAILABLE
  return String(value)
}

/**
 * 把指标快照渲染成一行文本。
 *
 * - 已知变量替换成格式化的取值；没有值、或值为零时写 `--`。
 * - 未知变量**原样保留**（连同花括号）：与其静默吞掉，不如让用户一眼看出自己拼错了。
 * - 结果首尾去空白；超过 {@link MAX_LIVE_METRIC_LENGTH} 直接截断。
 * - 空模板或纯空白模板返回空串——那是「不显示指标」，由调用方决定要不要画。
 */
export function renderLiveMetric(template: string, metrics: LiveMetrics): string {
  const rendered = template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    switch (name) {
      case 'liveTps':
        return metrics.liveTps === null || metrics.liveTps === 0 ? LIVE_METRIC_UNAVAILABLE : formatOutputSpeed(metrics.liveTps)
      case 'activeRequests':
        return asUnavailable(metrics.activeRequests)
      default:
        return match
    }
  })
  return rendered.trim().slice(0, MAX_LIVE_METRIC_LENGTH)
}
