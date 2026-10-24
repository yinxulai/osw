import { generateId } from '@common/utils'
import { tokensPerSecondFromTotals } from '@common/metrics'
import type { ModelTestRoundResult } from '@common/diagnostics'
import type { ModelTestMode, Protocol } from '@common/schemas'
import { executeProxyRequest } from '../../proxy/execution/attempt-executor'
import { createRequestContext } from '../../proxy/request/request-context'
import type { buildUpstreamTarget } from '../../proxy/planners/target-planner'
import { buildDiagnosticBody, type DiagnosticBodyOptions } from './probe-request'
import { StreamProbeResponse } from './probe-response'

/**
 * 跑**一轮**渠道诊断。
 *
 * 它是诊断的「一次真实请求」这一层的唯一定义：请求体怎么拼交给 `probe-request`，
 * 流式怎么读交给 `probe-response`，这里只负责把两者接到代理执行器上，并把结果
 * 收成 {@link ModelTestRoundResult}。
 *
 * 故意**不吞异常之外的任何东西**：异常也收成本轮失败、不往上抛——多轮里挂一轮
 * 不该丢掉其余轮的结论。
 */

/** 诊断要走的那条已有链路的目标（规划器的输出）。 */
export type DiagnosticTarget = NonNullable<ReturnType<typeof buildUpstreamTarget>>

export interface DiagnosticRoundInput {
  /** 这次要打到的上游目标。已由规划器按保存的配置解析好，诊断不自己拼字段。 */
  target: DiagnosticTarget
  protocol: Protocol
  /** 写进请求体的模型名：用户要确认的正是「上游认不认这个名字」。 */
  modelName: string
  /** 这次请求会不会被协议转换层改写（决定要不要带输出上限）。 */
  converted: boolean
  mode: ModelTestMode
  bodyOptions: DiagnosticBodyOptions
  signal: AbortSignal
  /** 第几轮，从 1 开始。 */
  round: number
}

export async function runDiagnosticRound(input: DiagnosticRoundInput): Promise<ModelTestRoundResult> {
  const startedAt = Date.now()
  try {
    const testBody = buildDiagnosticBody(input.protocol, input.modelName, input.converted, input.mode, input.bodyOptions)
    // 诊断只有一种形态：流式。首字与用量都只存在于 SSE 里，而整包交付下这个读字节的
    // 出口根本收不到逐帧数据（出口会把整包攒完之后一次性写出去），两样读到的都是空。
    const probe = new StreamProbeResponse()
    await executeProxyRequest({
      context: createRequestContext({
        requestId: generateId('req_'),
        logicalModelId: 'diagnostic',
        clientProtocol: input.protocol,
        // 客户端跳的形态由我们声明：上游会照着这个形态回，而我们正是要看它照不照做。
        transport: 'http-stream',
        method: 'POST',
        path: `/diagnostic/${input.protocol}`,
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
        },
        requestBody: Buffer.from(testBody),
        signal: input.signal,
      }),
      targets: [input.target],
      response: probe,
      // 连接测试是内部执行：它的用量由 `provider_tested` 回答，不是客户端任务（见 `ExecutionOrigin`）。
      origin: 'internal',
    })
    const success = probe.statusCode >= 200 && probe.statusCode < 400
    // 流式的正文是 SSE，`readUsage` 那个「解一个 JSON」的读法在它面前永远是空的：
    // 用量由同一个累加器从流里读走（它也是唯一还在数首字的地方）。
    const usage = probe.usage()
    const durationMilliseconds = Date.now() - startedAt
    return {
      round: input.round,
      success,
      statusCode: probe.statusCode || undefined,
      durationMilliseconds,
      errorMessage: success ? undefined : describeFailure(probe),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      ttftMilliseconds: probe.firstOutputElapsed(startedAt),
      // 速度是**派生值**，不是「速度诊断才量得到的量」：分子（输出 Token）与分母
      // （本次尝试耗时）在每一种模式下都已经握在手里了，所以这里按 `@common/metrics`
      // 的唯一定义无条件算一次。按模式决定算不算，只会让默认的流式诊断在界面上
      // 整列 `—`——那不是「没测到」，是「测得出来却不填」。
      // 判据交给 `tokensPerSecondFromTotals`：没有输出 Token 就没有分子，耗时不正就没有
      // 分母，两者都返回 `null`（「没有速度」与「速度为零」仍然分得开）。
      // 失败的轮次不算：上游没交付，这个比值不描述任何真实速度。
      tokensPerSecond: success ? tokensPerSecondFromTotals(usage.outputTokens ?? 0, durationMilliseconds) : null,
    }
  } catch (error) {
    return {
      round: input.round,
      success: false,
      durationMilliseconds: Date.now() - startedAt,
      ttftMilliseconds: null,
      tokensPerSecond: null,
      errorMessage: (error as Error).message,
    }
  }
}

/** 上游失败时最有用的一句话：执行器记下的失败原因优先，其次是上游正文，最后才是状态码。 */
function describeFailure(response: StreamProbeResponse): string {
  if (response.failureMessage) return response.failureMessage
  try {
    const body = JSON.parse(response.body) as { errorMessage?: unknown; error?: { message?: unknown } }
    if (typeof body.errorMessage === 'string' && body.errorMessage.trim()) return body.errorMessage
    if (typeof body.error?.message === 'string' && body.error.message.trim()) return body.error.message
  } catch {
    // 非 JSON 的上游正文没有结构化说明，交给调用方回落成状态码。
  }
  return `HTTP ${response.statusCode || 502}`
}
