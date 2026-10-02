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
 * ## 为什么变量名是显式枚举（`liveMaxTps` / `liveTotalTps` / …）而不是含糊的 `tps`
 *
 * 用户要的是几件**明确**的事：实时最大输出速度、实时合计输出速度、此刻并发请求。写成
 * `tps` / `requests` 会把不同口径的东西压成含糊的词——是最大还是合计，读不出来。所以变量名
 * 本身就把口径说完：`liveMaxTps` 是「在途请求里最快的那条有多快」、`liveTotalTps` 是「在途请求
 * 合起来现在多快」、`activeRequests` 是此刻并发数。
 *
 * ## 取值口径
 *
 * - 速度公式只有一份，在 `@common/metrics`；本文件不重写，只调用。
 * - 没有值（没有在途请求、没有样本）的变量渲染成 `--`。**零也渲染成 `--`**：指标条上
 *   一个 `0` 分不清「真的没有在跑」还是「页面没接上数」，而 `--` 明确指向「此刻没有」。
 *   它是一条给眼睛扫的状态条，不是一个要对账的计数。
 *
 * 主进程、服务进程、渲染进程三边都会 import 这个文件，所以它必须保持零 Node 依赖。
 */

import { formatOutputSpeed, tokensPerSecondFromTotals } from './metrics'
import type { LiveRequest } from './schemas'

/** 指标里「这个变量此刻没有值」的统一写法。用户可读、宽度稳定、不会与数字混淆。 */
export const LIVE_METRIC_UNAVAILABLE = '--'

/**
 * 默认模板：实时最大输出速度 + `TPS` 单位。
 *
 * 用户没配过模板时就是它，设置页里也拿它当占位示例——两处共用同一个常量，
 * 不会出现「默认值和界面上写的示例不一致」。
 */
export const DEFAULT_LIVE_METRIC_TEMPLATE = '{liveMaxTps} TPS'

/**
 * 模板允许的最大长度。
 *
 * 菜单栏是系统共享的、窗口角标也只是一条窄带，一段过长的文本会把旁边的状态挤走。
 * 64 个字符足够写下「速度 + 并发数 + 累计用量」几件事，又不至于失控；超长由渲染函数
 * 直接截断，而不是把一个撑爆的字符串交给调用方。
 */
export const MAX_LIVE_METRIC_LENGTH = 64

/**
 * 指标快照。
 *
 * 所有字段都是「已经算完的数」：`null` 表示此刻取不到（没有在途请求 / 没有样本 /
 * 用量还没读回来），与 `0`（真值为零）是两件事。渲染层不做任何再计算。
 */
export interface LiveMetrics {
  /**
   * 实时最大输出速度（TPS）：在途请求里**最大**的那个速度。
   *
   * 没有在途请求、或没有一个够格算速度的样本时为 `null`。取最大值而不是求和：
   * 这个数回答「现在跑得最快的那条有多快」，求和会稀释掉那条快请求。
   */
  liveMaxTps: number | null
  /**
   * 实时合计输出速度（TPS）：在途请求速度的**和**。
   *
   * 没有在途请求、或没有一个够格算速度的样本时为 `null`。这个数回答「此刻整体吞吐有多快」，
   * 与 {@link LiveMetrics.liveMaxTps} 是同一批样本的两种聚合，缺一不可。
   */
  liveTotalTps: number | null
  /** 此刻正在进行、且已进入上游阶段的请求条数。 */
  activeRequests: number
}

/** 判据：这次请求此刻是否正「在上游跑着」，且已进入上游阶段。三个速度/并发口径共用它。 */
function liveAttemptOf(request: LiveRequest): { outputTokens: number | null; startedAt: number } | null {
  if (request.status !== 'pending') return null
  const attempt = request.attempts[request.attempts.length - 1]
  if (attempt === undefined) return null
  if (attempt.state !== 'streaming' && attempt.state !== 'awaiting-upstream') return null
  return { outputTokens: attempt.outputTokens ?? null, startedAt: attempt.startedAt }
}

/**
 * 算出所有在途请求当下的输出速度样本。
 *
 * 只认「此刻真的在上游跑着」的尝试（`streaming` / `awaiting-upstream`），且要用到该尝试
 * 当下的输出 Token 读数与已经过去的时长。分子分母必须同源（见 `metrics.ts`）：时长取
 * `now - startedAt`，这是**此刻**的端到端耗时，不是一个已经落定的最终值——所以它随请求进行
 * 而收敛，正是「实时」的含义。
 *
 * 输入是台账快照（{@link LiveRequest}），输出是一批数：口径只在这里写一遍，服务进程、
 * 渲染进程、测试都从这拿。
 */
function liveOutputSpeeds(requests: readonly LiveRequest[], now: number): number[] {
  const speeds: number[] = []
  for (const request of requests) {
    const attempt = liveAttemptOf(request)
    if (attempt === null) continue
    const tps = tokensPerSecondFromTotals(attempt.outputTokens ?? 0, now - attempt.startedAt)
    if (tps === null) continue
    speeds.push(tps)
  }
  return speeds
}

/** 在途请求的实时**最大**输出速度；没有一个够格样本时为 `null`（没有速度，不是零）。 */
export function liveMaxOutputTokensPerSecond(requests: readonly LiveRequest[], now: number): number | null {
  const speeds = liveOutputSpeeds(requests, now)
  if (speeds.length === 0) return null
  return Math.max(...speeds)
}

/** 在途请求的实时**合计**输出速度；没有一个够格样本时为 `null`。 */
export function liveTotalOutputTokensPerSecond(requests: readonly LiveRequest[], now: number): number | null {
  const speeds = liveOutputSpeeds(requests, now)
  if (speeds.length === 0) return null
  return speeds.reduce((sum, speed) => sum + speed, 0)
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
    liveMaxTps: liveMaxOutputTokensPerSecond(requests, now),
    liveTotalTps: liveTotalOutputTokensPerSecond(requests, now),
    activeRequests: activeRequestCount(requests),
  }
}

/**
 * 模板变量的名字，是引擎唯一认识的集合。
 *
 * 写成字面量联合而不是 `string`：设置界面要靠它把「变量名 → 说明文案」做成一张编译期
 * 可穷尽的表，漏一个变量会在类型层面直接报出来，而不是等到界面上出现一个空的说明。
 */
export type LiveMetricVariableName = 'liveMaxTps' | 'liveTotalTps' | 'activeRequests'

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
  { name: 'liveMaxTps', sample: '42' },
  { name: 'liveTotalTps', sample: '86' },
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
      case 'liveMaxTps':
        return metrics.liveMaxTps === null || metrics.liveMaxTps === 0 ? LIVE_METRIC_UNAVAILABLE : formatOutputSpeed(metrics.liveMaxTps)
      case 'liveTotalTps':
        return metrics.liveTotalTps === null || metrics.liveTotalTps === 0 ? LIVE_METRIC_UNAVAILABLE : formatOutputSpeed(metrics.liveTotalTps)
      case 'activeRequests':
        return asUnavailable(metrics.activeRequests)
      default:
        return match
    }
  })
  return rendered.trim().slice(0, MAX_LIVE_METRIC_LENGTH)
}
