import type { ModelTestResult, ModelTestRoundResult } from '@common/diagnostics'

/**
 * 多轮诊断的汇总口径。
 *
 * 这是「一次诊断的结论」的**唯一定义处**：界面不重新算一遍，服务端日志与面板上
 * 也不会出现两个数。口径本身见 `apps/docs/specs/operations/diagnostics.md` §6。
 */

/** 汇总后的顶层字段：目标身份（模型 / 渠道 / 模式）由调用方补上。 */
export type ModelTestSummary = Omit<ModelTestResult, 'modelId' | 'modelName' | 'providerId' | 'providerName' | 'mode'>

function averageOf(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * 把多轮明细压成顶层那一行。
 *
 * - `success` 取**全部通过**：跑三轮挂一轮仍然要红，否则「稳定通过」和「碰巧过一次」看起来一样。
 * - 状态码取**第一个失败轮**的：查错要看的是失败那次的 HTTP 码，不是最后一轮碰巧的 200。
 * - 耗时 / TTFT / Token 取各轮均值：多轮之后顶层那一格代表「这个目标的典型值」。
 * - 缓存命中同样取均值，与 `inputTokens` 取的是同一批轮次：命中率是两者的商，若分子分母
 *   各取各的轮次，算出来的比率就不属于任何一次真实请求。
 * - 速度保留两位小数：`formatOutputSpeed` 不负责截位，多轮均值会给出 12.3456789 这种
 *   在界面上毫无意义的精度。
 */
export function summarizeRounds(rounds: ModelTestRoundResult[]): ModelTestSummary {
  const failure = rounds.find(round => !round.success)
  const ttftValues = rounds
    .map(round => round.ttftMilliseconds)
    .filter((value): value is number => typeof value === 'number')
  const speedValues = rounds
    .map(round => round.tokensPerSecond)
    .filter((value): value is number => typeof value === 'number')
  const inputValues = rounds
    .map(round => round.inputTokens)
    .filter((value): value is number => typeof value === 'number')
  const outputValues = rounds
    .map(round => round.outputTokens)
    .filter((value): value is number => typeof value === 'number')
  const cachedValues = rounds
    .map(round => round.cachedInputTokens)
    .filter((value): value is number => typeof value === 'number')
  const ttft = averageOf(ttftValues)
  const speed = averageOf(speedValues)
  const inputTokens = averageOf(inputValues)
  const outputTokens = averageOf(outputValues)
  const cachedInputTokens = averageOf(cachedValues)
  return {
    success: rounds.every(round => round.success),
    statusCode: failure?.statusCode ?? rounds.at(-1)?.statusCode,
    durationMilliseconds: Math.round(averageOf(rounds.map(round => round.durationMilliseconds)) ?? 0),
    errorMessage: failure?.errorMessage,
    inputTokens: inputTokens === null ? null : Math.round(inputTokens),
    outputTokens: outputTokens === null ? null : Math.round(outputTokens),
    cachedInputTokens: cachedInputTokens === null ? null : Math.round(cachedInputTokens),
    ttftMilliseconds: ttft === null ? null : Math.round(ttft),
    tokensPerSecond: speed === null ? null : Math.round(speed * 100) / 100,
    rounds,
  }
}
