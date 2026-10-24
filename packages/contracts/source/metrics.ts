/**
 * 请求观测指标的口径。
 *
 * 同一批数据会在三层各写一遍：SQL 聚合、接口映射、界面展示。三层各自凭印象算一遍，
 * 结果就是同一件事在不同页面显示成不同的数字。**这个文件是这些数值唯一的定义处**：
 * 谁要展示延迟和速度，都必须从这里取公式与格式，不得就地重写一份。
 *
 * 耗时的分解：
 *
 * ```
 * 尝试耗时 attemptDuration ──┬─ 首字延迟 ttft      （从发出请求到上游第一个真正内容）
 *                            └─ 出字时段           （首字之后，直到这次尝试结束）
 * ```
 *
 * 速度（TPS）的分母是**整段尝试耗时**，不是扣掉首字之后的出字时段——理由见
 * {@link tokensPerSecondFromTotals}。首字延迟只回答「多久开始出字」，不参与速度。
 *
 * 请求总耗时是另一条轴上的第四个量：它是整条链路的长度，不等于任何一次尝试的耗时。
 */

import type { RequestLogEntry, RequestLogEntryAttempt } from './schemas'

/** 一次尝试里与输出速度有关的两个值，同一条尝试记录上的同一批样本。 */
export interface OutputSpeedSample {
  /** 这次尝试产出的输出 Token；上游没报时为 `null`（没报不等于 0）。 */
  outputTokens: number | null
  /** 这次尝试的端到端耗时，即 `request_attempts.durationMilliseconds`。 */
  attemptDurationMilliseconds: number
}

/**
 * 服务该请求的那次尝试：尝试顺序里的**最后一条**。
 *
 * 故障转移一旦交付就停止，被放弃的尝试不会排在它后面，客户端拿到的响应或最终错误
 * 都由它产生。请求级的派生值——用量镜像、首字延迟、输出速度——都按它现算，
 * 不落库，避免出现第二份会漂移的副本。
 *
 * 取历次尝试的**最小值**是错的：被放弃的尝试从没向客户端写出过一个字节。
 */
export function servingAttemptOf(log: RequestLogEntry): RequestLogEntryAttempt | null {
  return log.attempts[log.attempts.length - 1] ?? null
}

/**
 * 一条请求的输出速度样本，口径与 {@link servingAttemptOf} 一致。
 *
 * 请求级用量本来就是服务该请求那次尝试镜像过来的一份，所以分子取请求级、分母取那次尝试，
 * 两者是同一次尝试的两个视角，不是两次统计。整条请求都没走到上游时才退回请求级总耗时。
 */
export function outputSpeedSampleOf(log: RequestLogEntry): OutputSpeedSample {
  const attempt = servingAttemptOf(log)
  return {
    outputTokens: log.outputTokens,
    attemptDurationMilliseconds: attempt?.durationMilliseconds ?? log.totalDurationMilliseconds,
  }
}

/** 一条请求的输出速度。 */
export function requestOutputTokensPerSecond(log: RequestLogEntry): number | null {
  return outputTokensPerSecond(outputSpeedSampleOf(log))
}

/**
 * 首字等待占整条请求的比重：首字延迟 ÷ 请求总耗时。
 *
 * 单看 `TTFT 800ms` 说不出这次请求是「等得久」还是「本来就大」：总耗时 60s 的请求里
 * 800ms 可以忽略，总耗时 1s 的请求里它占了八成。这个比值回答的是**慢在等开始，
 * 还是慢在传完**——它与输出速度分别站在时间轴的两端，缺一个就只剩半张账。
 *
 * 分母取请求总耗时而不是尝试耗时：读者关心的是客户端等了多久，那是整条链路。
 * 因此有重试的请求会把前面被放弃的尝试也算进分母，得到一个偏低的占比——那是对的，
 * 那部分时间确实不是「等第一个字」。
 *
 * 三种情况返回 `null`：没有首字样本、总耗时不正（没有可分配的时间）、
 * 首字延迟竟然超过总耗时（两侧起点不同造成的测量边界）。**不写出一个超过 100% 的比值**，
 * 那会被读成「等待比整个请求还长」这种不存在的事实。
 */
export function firstTokenShareOf(log: RequestLogEntry): number | null {
  const { ttftMilliseconds, totalDurationMilliseconds } = log
  if (ttftMilliseconds == null || !(totalDurationMilliseconds > 0)) return null
  if (ttftMilliseconds < 0 || ttftMilliseconds > totalDurationMilliseconds) return null
  return ttftMilliseconds / totalDurationMilliseconds
}

/**
 * 故障转移吃掉了多少时间：请求里**被放弃的那些尝试**的耗时之和。
 *
 * 这个数在用量报文和任何一行尝试记录里都读不出来，但它正是排障时最先要回答的问题：
 * 一次 8s 的请求，是上游那一次尝试就花了 8s，还是前面两次被放弃的尝试加起来吃掉了 6s？
 * 同一个总耗时，前者是上游慢，后者是故障转移在起作用——两种完全不同的结论，
 * 而只看总耗时与最终落点，这两种情况长得一模一样。
 *
 * 只加被放弃的尝试，不含网关自身的排队与序列化：把那些混进来，
 * 「重试贵不贵」会变成一个说不清的综合数。服务该请求的是最后一条（见
 * {@link servingAttemptOf}），其余都在交付前被放弃。
 *
 * 只有一次尝试时返回 0（不是 `null`）——「一次就通、没重试过」是真实的测得零；
 * 整条记录里没有尝试时返回 `null`，那时相减没有意义。
 */
export function failoverDurationOf(log: RequestLogEntry): number | null {
  if (log.attempts.length === 0) return null
  let milliseconds = 0
  for (const attempt of log.attempts.slice(0, -1)) {
    milliseconds += attempt.durationMilliseconds
  }
  return milliseconds
}

/**
 * 速度公式本体：同一批样本的输出 Token 合计 ÷ **同一批样本的尝试耗时**合计。
 *
 * 单条尝试与多条尝试的平均走的都是这一步，只是合计来自一条还是多条。
 * 判据只有一条：**分子与分母必须来自同一批样本**——哪个样本的输出 Token 进了分子，
 * 它的耗时就必须进分母；反过来，算不出耗时的样本的输出 Token 也不能只留在分子里。
 *
 * ## 分母为什么是整段尝试耗时，而不是扣掉首字之后的出字时段
 *
 * 「输出 Token ÷ 出字时段」看着更贴切，实际会算出不可能的数值，而且错得不只是边界情形：
 *
 * 1. **分子里的 Token 是整段尝试产出的，不是首字之后才产出的。** 上游报的输出 Token
 *    （`completion_tokens` / `output_tokens`）**包含推理 Token**，而推理 Token 恰恰是在
 *    「首字延迟」那段时间里产出的。把这段时间挖掉、把 Token 留下，分子与分母就不同源了：
 *    一次 8000ms 思考出 8000 个推理 Token、再用 2000ms 出 200 个正文 Token 的尝试，
 *    会显示成 8200 ÷ 2s = 4100 TPS。这不是采集误差，是公式本身算错了。
 * 2. **首字迟到的响应会让分母缩成碎屑。** 上游或中间层把内容攒到末尾一次性下发时，
 *    首字帧紧贴结束，`耗时 − 首字` 只剩几十毫秒，除出几千 TPS。**分母趋近 0 不是极高速度，
 *    是没有速度**——这是本项目最典型的口径错误。
 * 3. **减掉首字让两种传输形态不可比。** 首字延迟在整包响应（非流式）里不存在，只能按 0 处理，
 *    于是流式样本被挖掉一段时间、非流式样本一点不挖，同一条公式在两种形态下其实不同。
 *
 * 代价是语义：得到的是**端到端出字速度**，包含首字等待。首字慢的模型 TPS 更低——但那正是
 * 用户实际感受到的速度，而「多久开始出字」由首字延迟单独回答，两个维度并没有被合并。
 *
 * ## 什么时候算不出速度
 *
 * 不满足时返回 `null`，而不是一个数：没有输出 Token 就是没有分子；耗时不正说明这次尝试
 * 根本没有可度量的时长。**「没有速度」与「速度为零」是两件事。**
 */
export function tokensPerSecondFromTotals(outputTokens: number, attemptDurationMilliseconds: number): number | null {
  if (!(outputTokens > 0) || !(attemptDurationMilliseconds > 0)) return null
  return outputTokens / (attemptDurationMilliseconds / 1000)
}

/**
 * 单条尝试的输出速度（TPS）：输出 Token ÷ 尝试耗时。
 *
 * 够不够格给出速度由 {@link tokensPerSecondFromTotals} 判定。
 */
export function outputTokensPerSecond(sample: OutputSpeedSample): number | null {
  const { outputTokens, attemptDurationMilliseconds } = sample
  if (outputTokens == null) return null
  return tokensPerSecondFromTotals(outputTokens, attemptDurationMilliseconds)
}

/**
 * 一组尝试的平均输出速度。
 *
 * 用「先各自求和、再相除」，而不是「先算每条的速度、再取算术平均」。后者让每个样本等权：
 * 一次 20 Token 的短响应和一次 4000 Token 的长响应会占同样的分量，均值被短样本带着走。
 * 求和把分子与分母放在同一个口径上，长响应自然拿到它应有的权重。
 *
 * 两个合计值必须由**同一批样本**产生：耗时不正或没有输出 Token 的样本，分子分母一起剔。
 * 没有任何一个样本够格时返回 `null`，而不是 0——没有速度和有速度但为零是两件事。
 */
export function averageOutputTokensPerSecond(samples: readonly OutputSpeedSample[]): number | null {
  let outputTokens = 0
  let duration = 0
  for (const sample of samples) {
    if (sample.outputTokens == null || sample.outputTokens <= 0) continue
    if (!(sample.attemptDurationMilliseconds > 0)) continue
    outputTokens += sample.outputTokens
    duration += sample.attemptDurationMilliseconds
  }
  return tokensPerSecondFromTotals(outputTokens, duration)
}

/**
 * 延迟的展示分解：显示的数值、单位与小数位。
 *
 * {@link formatMilliseconds} 是它的文本形态，两者共用同一个「不足一秒写毫秒」的规则。
 * 需要数字动画而不是一段文本的界面用这个，避免第二条规则冒出来。
 */
export function millisecondsDisplayParts(milliseconds: number): { value: number; decimalPlaces: number; unit: 'ms' | 's' } {
  return milliseconds < 1000
    ? { value: milliseconds, decimalPlaces: 0, unit: 'ms' }
    : { value: milliseconds / 1000, decimalPlaces: 1, unit: 's' }
}

/**
 * 延迟的展示值：不足一秒写毫秒，一秒以上写秒。
 *
 * 毫秒与秒的分界点是 1000 而不是 1024：这是给人看的耗时，不是存储单位换算。
 * 没有样本时为 `—`，不写 `0ms`——「没测到」和「测得 0」必须在界面上分得开。
 */
export function formatMilliseconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const parts = millisecondsDisplayParts(value)
  return `${parts.value.toFixed(parts.decimalPlaces)}${parts.unit}`
}

/**
 * Token 计数的展示分解：数值与进位后缀。
 *
 * 拆成两半是给「后缀要单独改小一号」的界面用的——请求日志的 `1.2K` 里那个 `K`
 * 比数字淡一档，需要自己拼装。数值与后缀的分界只此一处，各处不再各自 `toFixed`。
 */
export interface TokenCountParts {
  /** 数值部分，不含后缀。 */
  value: string
  /** 进位后缀；未进位时是空串，「1.2k」与「9700」因此共用同一条拼装规则。 */
  suffix: string
}

/**
 * Token 计数的展示值：一万及以上折成 `1.2k`，以下原样。
 *
 * 与输出速度的 {@link formatOutputSpeed} 分开，因为两者回答的不是同一类问题：
 * 速度是**比率**，量级决定小数位（10 以下留一位，10 以上取整）；这里是**计数**，
 * 一位小数只在进位之后才有意义——「1.2k 个 Token」里那个 0.2 是量级信息，
 * 而 1234 写成 `1234.0` 只多占了两个字符。
 *
 * 阈值取 10 000 而不是 1 000：四位以内的数写成 `9.7k` 比 `9700` 更难读，
 * 而 9700 在列里也只占四个字符。进位用 1000 而不是 1024：Token 是**数的**，
 * 不是存储量换算（对比 `formatBytes` 的 1024）。
 *
 * `null` 写 `—`、0 写 `0`：没有样本与测得为零是两件事，这个区别在整份界面里保持一致。
 */
export function formatTokenCount(value: number | null | undefined): string {
  const parts = formatTokenCountParts(value)
  return parts === null ? '—' : `${parts.value}${parts.suffix}`
}

/** {@link formatTokenCount} 的分解形态；没有样本时返回 `null` 而不是 `{ value: '—' }`。 */
export function formatTokenCountParts(value: number | null | undefined): TokenCountParts | null {
  if (value == null || !Number.isFinite(value)) return null
  if (Math.abs(value) < 10_000) return { value: String(value), suffix: '' }
  return { value: (value / 1000).toFixed(1), suffix: 'k' }
}

/**
 * 量级决定的小数位：10 及以上取整，10 以下保留一位小数。
 *
 * 10 以下的差别是有信息的（3.3 与 4.7 是两种速度），10 以上再带小数只剩噪声。
 * 这条规则同时管着输出速度与平均输出——**同一个数在一处写 `24.0`、在另一处写 `24`
 * 就会被读成两个数**，所以取舍只能有一处。
 */
export function magnitudeDecimalPlaces(value: number): number {
  return value >= 10 ? 0 : 1
}

/** 输出速度的展示小数位（取舍规则见 {@link magnitudeDecimalPlaces}）。 */
export function outputSpeedDecimalPlaces(tokensPerSecond: number): number {
  return magnitudeDecimalPlaces(tokensPerSecond)
}

/**
 * 输出速度的展示值。
 *
 * 展示规则只有这一处，避免同一个数在排行榜写 `24.0`、在详情写 `24`。
 */
export function formatOutputSpeed(tokensPerSecond: number | null | undefined): string {
  if (tokensPerSecond == null || !Number.isFinite(tokensPerSecond)) return '—'
  return tokensPerSecond.toFixed(outputSpeedDecimalPlaces(tokensPerSecond))
}

/**
 * 每次调用的平均输出 Token：某个口径下的输出 Token 总量 ÷ 产出这些输出的调用数。
 *
 * 请求级与尝试级是同一个式子的两个口径：窗口整体是「输出总量 ÷ 请求总数」，
 * 排行里一行是「该模型成功调用的输出总量 ÷ 成功调用数」。两处的判据是同一条：
 * **分母数的是谁，分子就得是这批调用产出的输出**——拿只含成功样本的分子去除以全部
 * 调用数，比值会被单方面压低，得到的数既不描述成功的那批，也不描述全部。
 *
 * 它回答「一次调用平均产出多少内容」，与响应体量成正比不是缺陷，正是它的定义。
 *
 * 调用数为 0 时返回 `null` 而不是 0：没调用就是「没测到」，不是「平均输出为零」。
 * 有调用但输出为 0 时返回 0，那是真实的「测得 0」。
 */
export function averageOutputTokensPerCall(outputTokens: number, callCount: number): number | null {
  if (!(callCount > 0)) return null
  return outputTokens / callCount
}

/**
 * 缓存命中率：缓存读取 Token ÷ 输入 Token 总量。
 *
 * 分子本就是分母的一部分——输入 Token 总量含缓存读取（缓存只是计费便宜，上下文该读进去的
 * 字节一个不少），两者同一口径相除才是命中率。换一个分母（例如输入与缓存相加）会把比率
 * 稀释成另一个数。
 *
 * 输入为 0 时返回 `null` 而不是 0：没有输入就是「没测到」，不是「一次都没命中」。
 * 输入为正但一次没命中时返回 0，那是真实的「测得 0」。
 */
export function cacheHitRate(cachedInputTokens: number, inputTokens: number): number | null {
  if (!(inputTokens > 0)) return null
  return cachedInputTokens / inputTokens
}

/**
 * 平均输出的文本形态。
 *
 * 小数位取舍见 {@link magnitudeDecimalPlaces}：同一个数在排行榜写 `80`、在别处写 `80.3`
 * 会被读成两个数。没有样本时写 `—`，不写 `0`——「没测到」和「测得 0」必须在界面上分得开。
 */
export function formatAverageOutput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(magnitudeDecimalPlaces(value))
}
