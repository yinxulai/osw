import type { IncomingMessage, ServerResponse } from 'node:http'
import { ModelTestRunRequestSchema, type ModelTestResult, type ModelTestRoundResult } from '@common/diagnostics'
import { HttpRouter } from '@server/http-router'
import { reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { runDiagnosticRound } from '../../diagnostics/run-round'
import { summarizeRounds } from '../../diagnostics/round-summary'
import { planDiagnosticTargets, type DiagnosticTargetPlan } from '../../diagnostics/target-plan'

/**
 * 渠道诊断：`POST /api/model-test/run`。
 *
 * 它测的是**用户此刻保存的那一份配置**，并且照实记账（请求日志、用量、健康冷却都进）。
 * 与「模型对话框里的连接测试」不是同一件事，两者的分工见
 * `apps/docs/specs/operations/diagnostics.md` §2。
 *
 * 这个文件只做 HTTP 适配：校验入参、拿 abort 信号、编排「目标 × 轮次」的循环、
 * 把结果写回响应、发一条遥测。请求怎么拼、流怎么读、多轮怎么汇总、哪些目标可测，
 * 分别归 `diagnostics/` 下的四个模块——它们都不认识 HTTP，因此可以各自单独测。
 */
export const modelTestRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/model-test/run', handleTestModels)

async function handleTestModels(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const request = ModelTestRunRequestSchema.parse(body)
  const { protocol, mode, rounds } = request
  const bodyOptions = { prompt: request.prompt?.trim() || undefined, inputLength: request.inputLength }

  const controller = new AbortController()
  const onClientAbort = () => controller.abort()
  req.once('aborted', onClientAbort)

  const plans = await planDiagnosticTargets({ protocol, providerIds: request.providerIds, modelIds: request.modelIds })
  const results: ModelTestResult[] = []

  for (const plan of plans) {
    // 客户端断开时不再补后面的目标：上游请求已经随 `signal` 断掉，接着测只是白花钱。
    if (controller.signal.aborted) break
    const roundResults = await runRounds({ plan, rounds, mode, bodyOptions, signal: controller.signal })
    if (roundResults.length === 0) continue
    results.push({
      modelId: plan.modelId,
      modelName: plan.modelName,
      providerId: plan.providerId,
      providerName: plan.providerName,
      mode,
      ...summarizeRounds(roundResults),
    })
  }

  const aborted = controller.signal.aborted
  req.removeListener('aborted', onClientAbort)
  // 每个被测目标一条：界面侧把「测试全部模型」拆成若干次请求（一次请求只测一个目标，见
  // `packages/console/source/pages/model-management/hooks/use-model-test-runner.ts`），
  // 因此这里的一条 `result` 就是那一个目标的结论。
  // 被取消的那次不发——它没有结论，记成失败会把「用户点了取消」算进失败率里（契约注释）。
  if (!aborted && results.length > 0) {
    reportTelemetryEvent({ name: 'provider_tested', result: results.every(result => result.success) ? 'success' : 'failed' })
  }
  // 客户端断开后 socket 已经没了，再写回去只会多一次无意义的写失败；能写就写。
  if (!res.writableEnded && !res.destroyed) sendSuccess(res, { results })
}

interface RunRoundsInput {
  plan: DiagnosticTargetPlan
  rounds: number
  mode: ModelTestResult['mode']
  bodyOptions: { prompt?: string; inputLength: number }
  signal: AbortSignal
}

/**
 * 一个目标的全部轮次。
 *
 * 没有上游地址时**不为每一轮都发一次**：同一个配置每一轮都会得到同样的结论，
 * 重复 N 次只是把同一个错误抄 N 遍。
 */
async function runRounds(input: RunRoundsInput): Promise<ModelTestRoundResult[]> {
  const { plan, signal } = input
  if (!plan.target) {
    return [{
      round: 1,
      success: false,
      durationMilliseconds: 0,
      ttftMilliseconds: null,
      tokensPerSecond: null,
      errorMessage: `No upstream url is configured for protocol ${plan.protocol}`,
    }]
  }

  const roundResults: ModelTestRoundResult[] = []
  for (let round = 1; round <= input.rounds; round += 1) {
    // 客户端断开时不再补后面的轮次：上游请求已经随 `signal` 断掉，接着测只是白花钱。
    if (signal.aborted) break
    const roundResult = await runDiagnosticRound({
      target: plan.target,
      protocol: plan.protocol,
      modelName: plan.modelName,
      converted: plan.converted,
      mode: input.mode,
      bodyOptions: input.bodyOptions,
      signal,
      round,
    })
    // 被取消的那一轮不计入结论：它没有答案，记成失败会把「用户点了取消」算进失败率里。
    if (signal.aborted) break
    roundResults.push(roundResult)
  }
  return roundResults
}
