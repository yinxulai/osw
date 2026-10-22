import type { IncomingMessage, ServerResponse } from 'node:http'
import { ModelTestRunRequestSchema, type ModelTestResult, type ModelTestRoundResult } from '@common/diagnostics'
import {
  MODEL_TEST_STREAM_PROTOCOL_VERSION,
  type ModelTestProgressMessage,
  type ModelTestStreamMessage,
} from '@common/model-test-stream'
import { HttpRouter } from '@server/http-router'
import { reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { runDiagnosticRound } from '../../diagnostics/run-round'
import { summarizeRounds, type ModelTestSummary } from '../../diagnostics/round-summary'
import { planDiagnosticTargets, type DiagnosticTargetPlan } from '../../diagnostics/target-plan'

/**
 * 渠道诊断：`POST /api/model-test/run`。
 *
 * 它测的是**用户此刻保存的那一份配置**，并且照实记账（请求日志、用量、健康冷却都进）。
 * 与「模型对话框里的连接测试」不是同一件事，两者的分工见
 * `apps/docs/specs/diagnostics.md` §2。
 *
 * 这个文件只做 HTTP 适配：校验入参、拿 abort 信号、编排「目标 × 轮次」的循环、
 * 把结果写回响应、发一条遥测。请求怎么拼、流怎么读、多轮怎么汇总、哪些目标可测，
 * 分别归 `diagnostics/` 下的四个模块——它们都不认识 HTTP，因此可以各自单独测。
 *
 * ## 响应是一条 NDJSON 流，不是一份最后才成形的 JSON
 *
 * 每一轮跑完写一条 `progress`，整批跑完写一条 `summary`，随后 `end()`（帧形状见
 * `@common/model-test-stream`）。理由是「快」的反面——**诚实**：一次诊断的每一轮都是
 * 一次真实的上游请求，慢上游下一整批能拖几十秒，而旧版把结论攒到最后才承认，界面在这
 * 期间只能显示「请求中」和一个 `—`。逐轮写出去之后，第一轮回来多久，界面上那一行就
 * 更新多久。
 *
 * ## 为什么不复用 `createFanout`（两条推送流的传输骨架）
 *
 * 骨架服务的是「一源多订阅者、每个订阅者看同一份快照」：台账变了推全量、没人看就收掉
 * 定时器。这里的数据源是**这一次请求自己**，且只追加不重放——一个订阅者的、一次性的、
 * 会结束的流。硬套骨架要给它造一个只为单次请求存在的「源」，得不偿失。共用的是分帧
 * 约定（一行一帧、行尾换行、`Content-Type: application/x-ndjson`），客户端侧也确实共用
 * 同一份分帧实现。
 *
 * 没有做写侧背压等待：每帧就是一行 JSON，总量由用户自己填的 `rounds × 目标数` 决定；
 * 被内核缓冲区挡下时 Node 会自行缓冲，而客户端断开时循环立刻随 `signal` 停手。
 */
export const modelTestRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/model-test/run', handleTestModels)

async function handleTestModels(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const request = ModelTestRunRequestSchema.parse(body)
  const { protocol, mode, rounds } = request
  const bodyOptions = { prompt: request.prompt?.trim() || undefined, inputLength: request.inputLength }

  const controller = new AbortController()
  const onClientAbort = () => controller.abort()
  /*
   * 两个都挂上，因为「客户端走了」在两个时代有两种说法：
   *
   * - `req` 的 `aborted` 是历史信号（Node 标为已废弃）；
   * - `res` 的 `close` 是现在的做法。实测（这条路由的真 HTTP 用例）客户端中断在飞的分块响应时
   *   **只有 `res` 的 `close` 会触发**，`req` 的 `aborted` 一次都不发。只挂前者的后果不是「取消
   *   晚一点生效」，而是取消根本传不到服务端：剩下的轮次会照跑、照计费。
   *
   * 正常收尾时 `close` 也会发，但那时循环已经结束、`end()` 已经调用，abort 是个空操作。
   */
  req.once('aborted', onClientAbort)
  res.once('close', onClientAbort)

  res.statusCode = 200
  // NDJSON 而不是 SSE：同样是分块文本，但不要求把消息包成 `data: `——这里推的是 JSON 对象
  // 本身，多一层包装只会让两边都要多写一个拆包/装包的实现（与两条推送流同一约定）。
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  // 这份数据只在「此刻」有意义：任何一层的缓存或转换缓冲都会把它变成过期快照。
  res.setHeader('Cache-Control', 'no-store, no-transform')

  const plans = await planDiagnosticTargets({ protocol, providerIds: request.providerIds, modelIds: request.modelIds })
  const results: ModelTestResult[] = []

  for (const plan of plans) {
    // 客户端断开时不再补后面的目标：上游请求已经随 `signal` 断掉，接着测只是白花钱。
    if (controller.signal.aborted) break
    const roundResults = await runRounds({
      plan,
      rounds,
      mode,
      bodyOptions,
      signal: controller.signal,
      onProgress: message => writeFrame(res, message),
    })
    if (roundResults.length === 0) continue
    results.push(toModelTestResult(plan, mode, summarizeRounds(roundResults)))
  }

  const aborted = controller.signal.aborted
  req.removeListener('aborted', onClientAbort)
  res.removeListener('close', onClientAbort)
  // 每个被测目标一条：界面侧把「测试全部模型」拆成若干次请求（一次请求只测一个目标，见
  // `packages/console/source/pages/model-management/hooks/use-model-test-runner.ts`），
  // 因此这里的一条 `result` 就是那一个目标的结论。
  // 被取消的那次不发——它没有结论，记成失败会把「用户点了取消」算进失败率里（契约注释）。
  if (!aborted && results.length > 0) {
    reportTelemetryEvent({ name: 'provider_tested', result: results.every(result => result.success) ? 'success' : 'failed' })
  }
  // 客户端断开后 socket 已经没了，再写回去只会多一次无意义的写失败；能写就写。
  // 汇总照旧发（哪怕 `results` 是空的）：空集与「一个目标都没跑成」是两回事，界面据此区分
  // 「筛选没命中」和「请求本身失败了」。
  writeFrame(res, { protocolVersion: MODEL_TEST_STREAM_PROTOCOL_VERSION, type: 'summary', results })
  if (!res.writableEnded && !res.destroyed) res.end()
}

/**
 * 写一帧。
 *
 * 客户端已经断开（`destroyed`）或响应已经收尾（`writableEnded`）时是空操作：这条流会在
 * 循环中途被取消，之后每一处写入都可能是「对着一个没有接收方的 socket 写」。
 */
function writeFrame(res: ServerResponse, message: ModelTestStreamMessage): void {
  if (res.writableEnded || res.destroyed) return
  res.write(`${JSON.stringify(message)}\n`)
}

/** 目标身份 + 汇总结论 = 线上那一行结论。进度帧与最终汇总用的是同一份拼法。 */
function toModelTestResult(plan: DiagnosticTargetPlan, mode: ModelTestResult['mode'], summary: ModelTestSummary): ModelTestResult {
  return {
    modelId: plan.modelId,
    modelName: plan.modelName,
    providerId: plan.providerId,
    providerName: plan.providerName,
    mode,
    ...summary,
  }
}

interface RunRoundsInput {
  plan: DiagnosticTargetPlan
  rounds: number
  mode: ModelTestResult['mode']
  bodyOptions: { prompt?: string; inputLength: number }
  signal: AbortSignal
  /** 每跑完一轮回调一次。进度帧在这一层构造：只有它知道「刚跑完的是第几轮、一共几轮」。 */
  onProgress: (message: ModelTestProgressMessage) => void
}

/**
 * 一个目标的全部轮次。
 *
 * 没有上游地址时**不为每一轮都发一次**：同一个配置每一轮都会得到同样的结论，
 * 重复 N 次只是把同一个错误抄 N 遍。那种情况下「第 1 轮」就是全部，所以这一帧的
 * 总轮数是 1 而不是用户填的 N——否则界面上那一行会显示「第 1/3 轮」，然后直接收尾。
 */
async function runRounds(input: RunRoundsInput): Promise<ModelTestRoundResult[]> {
  const { plan, signal } = input
  const roundResults: ModelTestRoundResult[] = []

  /**
   * 记下一轮的结论并立刻把「到目前为止」的汇总写出去。
   *
   * 汇总用的是 `summarizeRounds`（§6 的唯一定义处）而不是「拼一份临时的读数」：界面拿到的
   * 这一份必须与最终汇总、与服务端日志逐字同类，否则第一轮与整批跑完之后会出现两种口径。
   */
  const record = (roundResult: ModelTestRoundResult, totalRounds: number): void => {
    roundResults.push(roundResult)
    input.onProgress({
      protocolVersion: MODEL_TEST_STREAM_PROTOCOL_VERSION,
      type: 'progress',
      modelId: plan.modelId,
      providerId: plan.providerId,
      round: roundResult.round,
      totalRounds,
      result: toModelTestResult(plan, input.mode, summarizeRounds(roundResults)),
    })
  }

  if (!plan.target) {
    record({
      round: 1,
      success: false,
      durationMilliseconds: 0,
      ttftMilliseconds: null,
      tokensPerSecond: null,
      errorMessage: `No upstream url is configured for protocol ${plan.protocol}`,
    }, 1)
    return roundResults
  }

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
    // 被取消的那一轮不计入结论、也不写出去：`runDiagnosticRound` 会把中断收成一次失败，
    // 那条「失败」记的是用户点了取消，不是上游答错了（契约注释与 §8.3）。
    if (signal.aborted) break
    record(roundResult, input.rounds)
  }
  return roundResults
}
