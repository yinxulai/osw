import type { ModelTestRoundResult, ModelTestTaskItem, ModelTestTaskProgress, ModelTestTaskResult } from '@common/diagnostics'
import { ModelTestTaskItemSchema } from '@common/diagnostics'
import { reportTelemetryEvent } from '@server/telemetry'
import { runDiagnosticRound } from '../../diagnostics/run-round'
import { summarizeRounds } from '../../diagnostics/round-summary'
import { planDiagnosticTargets, type DiagnosticTargetPlan } from '../../diagnostics/target-plan'
import type { TaskKind } from '../queue'

/**
 * 渠道诊断这个 **kind**：把现有的诊断领域模块包成队列认识的一个任务。
 *
 * 它只做「翻译」：把队列的 `run(payload, ctx)` 翻译成「规划一个目标 → 按轮次跑 →
 * 每跑完一轮汇报一次进度 → 收尾给出汇总结论」。请求体怎么拼、流怎么读、多轮怎么汇总、
 * 哪些目标可测，仍然是原来那几个模块的事（`probe-request` / `probe-response` /
 * `run-round` / `round-summary` / `target-plan`），一行都没改。
 *
 * **通过 / 不通过只有一个定义处**：`summarizeRounds`。进度帧里的 `result` 与收尾的
 * `result` 都是它算出来的，界面与日志上不会出现第二个口径。
 */

/** 队列里这类任务的 `kind`。 */
export const MODEL_TEST_TASK_KIND = 'model-test'

/** 诊断任务的结果就等于一条诊断结论（加上协议，见 `@common/diagnostics`）。 */
export type { ModelTestTaskResult }

export const modelTestTaskKind: TaskKind<ModelTestTaskItem, ModelTestTaskResult, ModelTestTaskProgress> = {
  kind: MODEL_TEST_TASK_KIND,
  /**
   * 串行（默认 1）。
   *
   * 诊断量的是**延迟与首字**，同时打多个上游会互相污染读数（连接复用、出口带宽、
   * 上游侧排队）。串行是**诚实的默认**：一个数只有一次请求在飞时才说得清是谁的。
   * 需要更快就由界面把它显式调大，并接受读数被稀释的代价——见
   * `apps/docs/specs/task-queue.md`。
   */
  concurrency: 1,
  parse: input => ModelTestTaskItemSchema.parse(input),
  /** 去重键：同一个「模型 × 协议」不该同时在飞两份（那是一次真实的双倍计费）。 */
  keyOf: payload => `${payload.modelId}:${payload.protocol}`,
  run: runModelTestTask,
}

async function runModelTestTask(item: ModelTestTaskItem, context: TaskRunContext): Promise<ModelTestTaskResult> {
  const plans = await planDiagnosticTargets({
    protocol: item.protocol,
    providerIds: [item.providerId],
    modelIds: [item.modelId],
  })
  const plan = plans[0]
  const identity = identityOf(item, plan)

  // 规划不出目标（模型被停用、这个协议既没有原生端点也没有可转换端点）：这不是一次
  // 失败的上游请求，而是「没有可测的东西」——给一句说得清的话，不假装打了上游。
  if (!plan) {
    return {
      ...identity,
      success: false,
      durationMilliseconds: 0,
      errorMessage: `No testable target for model ${item.modelId} on protocol ${item.protocol}`,
    }
  }

  const bodyOptions = { prompt: item.prompt?.trim() || undefined, inputLength: item.inputLength }
  const roundResults = await runRounds({ item, plan, bodyOptions, context })

  const result: ModelTestTaskResult = { ...identity, ...summarizeRounds(roundResults) }
  // 被取消的那次不发事件：它没有结论，记成失败会把「用户点了取消」算进失败率里
  // （口径见 `apps/docs/specs/telemetry.md` §3）。
  if (!context.signal.aborted && roundResults.length > 0) {
    reportTelemetryEvent({ name: 'provider_tested', result: result.success ? 'success' : 'failed' })
  }
  return result
}

/** 运行上下文——引擎给的东西，这里只用得到取消信号、id 与进度写口。 */
type TaskRunContext = Parameters<TaskKind<ModelTestTaskItem, ModelTestTaskResult, ModelTestTaskProgress>['run']>[1]

/** 一条结论里的身份字段：优先用规划器解析出来的名字，规划不出来时退回 id。 */
function identityOf(item: ModelTestTaskItem, plan: DiagnosticTargetPlan | undefined) {
  return {
    modelId: item.modelId,
    modelName: plan?.modelName ?? item.modelId,
    providerId: item.providerId,
    providerName: plan?.providerName ?? '',
    protocol: item.protocol,
    mode: item.mode,
  }
}

interface RunRoundsInput {
  item: ModelTestTaskItem
  plan: DiagnosticTargetPlan
  bodyOptions: { prompt?: string; inputLength: number }
  context: TaskRunContext
}

/**
 * 一个目标的全部轮次。
 *
 * 没有上游地址时**不为每一轮都发一次**：同一个配置每一轮都会得到同样的结论，
 * 重复 N 次只是把同一个错误抄 N 遍（与旧路由同一条判断）。
 */
async function runRounds(input: RunRoundsInput): Promise<ModelTestRoundResult[]> {
  const { item, plan, context } = input
  const roundResults: ModelTestRoundResult[] = []

  if (!plan.target) {
    roundResults.push({
      round: 1,
      success: false,
      durationMilliseconds: 0,
      ttftMilliseconds: null,
      tokensPerSecond: null,
      errorMessage: `No upstream url is configured for protocol ${item.protocol}`,
    })
    context.report(progressOf(input, roundResults))
    return roundResults
  }

  for (let round = 1; round <= item.rounds; round += 1) {
    // 取消在**步边界**收：上游请求会随 `signal` 断掉，但这里也要停，否则会接着补下一轮。
    if (context.signal.aborted) break
    const roundResult = await runDiagnosticRound({
      target: plan.target,
      protocol: item.protocol,
      modelName: plan.modelName,
      converted: plan.converted,
      mode: item.mode,
      bodyOptions: input.bodyOptions,
      signal: context.signal,
      round,
    })
    // 被取消的那一轮不计入结论：它没有答案，记成失败会把「用户点了取消」算进失败率里。
    if (context.signal.aborted) break
    roundResults.push(roundResult)
    context.report(progressOf(input, roundResults))
  }
  return roundResults
}

/** 把「身份 + 已完成轮次 + 汇总结论」拼成一帧进度。结论仍由 `summarizeRounds` 唯一给出。 */
function progressOf(input: RunRoundsInput, roundResults: ModelTestRoundResult[]): ModelTestTaskProgress {
  const identity = identityOf(input.item, input.plan)
  return {
    ...identity,
    round: roundResults.length,
    totalRounds: input.item.rounds,
    result: roundResults.length === 0 ? null : { ...identity, ...summarizeRounds(roundResults) },
  }
}
