import type { ModelTestResult, ModelTestRoundResult } from '@common/diagnostics'
import { formatMilliseconds, formatOutputSpeed, formatTokenCount } from '@common/metrics'
import type { TestRow, TestRowStatus } from './tasks'

/**
 * 结果表的**读法**：一行结论怎么写、一条明细怎么逐轮列出来。
 *
 * 这些函数原先长在 `components/model-test-panel.tsx` 里。它们看着像「格式化」，
 * 其实全是口径：未测量的首字耗时写 `—` 而不是 `0`、输出速度只在拿得到分子分母时才有值。
 * 口径写进渲染文件，就只能靠点开面板去验；写成纯函数，一个 `expect` 就说得清。
 *
 * 「这一批跑到哪了、有多少失败」这类**汇总**不在这里——任务的状态归服务端队列，
 * 汇总口径在 `./tasks.ts`（`summarizeTestRows`），挨着它的数据源。
 */

/**
 * 逐轮记录的**唯一来源**：服务端给的 `result.rounds`。没有 `rounds` 时（理论上不会）
 * 不编造明细，直接返回空——空表比一条假轮次诚实。
 */
export function getResultRounds(result: Pick<ModelTestResult, 'rounds'>): ModelTestRoundResult[] {
  return result.rounds ?? []
}

/** 成功率按整百分比四舍五入：明细里印的是「3/4 · 75%」，不是小数。 */
export function getRoundSuccessRate(rounds: readonly ModelTestRoundResult[]): number {
  if (rounds.length === 0) return 0
  const successCount = rounds.filter(round => round.success).length
  return Math.round((successCount / rounds.length) * 100)
}

/**
 * 输出列只放**上游报出来的输出 Token**。
 *
 * 没报就是没报：写 `—`，不补一个 `0`——「上游没说」和「一个字都没出」是两件事，
 * 按 0 展示会把前者算进后者的口径里。输出速度列的分母与它同源，两列并排读得通。
 */
export function getTaskTokenLabel(row: TestRow): string {
  return row.result ? formatTokenCount(row.result.outputTokens) : '—'
}

export function getTaskDurationLabel(row: TestRow): string {
  return row.result ? formatMilliseconds(row.result.durationMilliseconds) : '—'
}

/** 首字耗时只量得到流式：整包响应里没有「第一块」这个时刻，没量到就写 `—`，不编一个 0。 */
export function getTaskTtftLabel(row: TestRow): string {
  return row.result ? formatMilliseconds(row.result.ttftMilliseconds) : '—'
}

/** 出字速度只有拿得到分子分母时才有值：其余情况宁缺勿编。 */
export function getTaskSpeedLabel(row: TestRow): string {
  if (!row.result) return '—'
  const speed = formatOutputSpeed(row.result.tokensPerSecond)
  return speed === '—' ? '—' : `${speed} t/s`
}

/** 状态词的配色：成功绿、失败红、进行中主文色、取消与排队退到灰。 */
export function getTaskStatusClassName(status: TestRowStatus): string {
  if (status === 'success') return 'text-text-success'
  if (status === 'failed') return 'text-text-destructive'
  if (status === 'running') return 'text-text-primary'
  if (status === 'cancelled') return 'text-text-tertiary'
  return 'text-text-quaternary'
}

/**
 * 状态格的 `title`：把「上游到底回了什么」补上。
 *
 * 格子里只印短短的「失败」，因为状态列要能一眼竖着扫下来；HTTP 码是查错时的第一手
 * 线索（401 与 429 的处置完全不同），所以它退到悬浮提示里，不占列宽。
 * 错误原文本来就在行下方那条红框里，不必在这里再抄一遍。
 */
export function getTaskStatusTitle(row: TestRow, statusLabel: string): string {
  if (!row.result?.statusCode) return statusLabel
  return `${statusLabel} · HTTP ${row.result.statusCode}`
}
