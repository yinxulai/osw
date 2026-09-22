import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { listProviderEndpoints, listProviders } from '@server/database/provider-store'
import { listProviderModels } from '@server/database/model-store'
import { generateId } from '@common/utils'
import { findConvertibleEndpoint, findEndpoint } from '../../../proxy/routing/router'
import { buildUpstreamTarget } from '../../../proxy/planners/target-planner'
import { executeProxyRequest } from '../../../proxy/execution/attempt-executor'
import { createRequestContext } from '../../../proxy/request/request-context'
import { createUsageTracker } from '../../../proxy/observers/usage'
import { BufferedProxyResponse } from '../../../proxy/response/proxy-response'
import { HttpRouter } from '@server/http-router'
import { reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { tokensPerSecondFromTotals } from '@common/metrics'
import { ModelTestModeSchema, ProtocolSchema, type ModelTestMode, type Protocol } from '@common/schemas'

const TestModelsSchema = z.object({
  protocol: ProtocolSchema,
  // 不给模式就是连通性：老界面、老脚本发的请求仍然按原来的语义跑。
  mode: ModelTestModeSchema.default('connectivity'),
  providerIds: z.array(z.string()).optional(),
  modelIds: z.array(z.string()).optional(),
})

/**
 * 速度诊断的提示词与上限。
 *
 * 测速度需要一段**够长**的输出：一句话的回答里，出字快慢全被首字节和连接开销盖住。
 * 数数是最省事的长输出——它不需要模型「想」，也不需要采样温度，不同渠道之间可比。
 */
const SPEED_PROMPT = 'Count from 1 to 200, separated by single spaces. Output only the numbers.'
const SPEED_MAX_TOKENS = 512

export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  /** 这一次结果是按哪个模式测出来的。界面按它决定展示哪些列。 */
  mode: ModelTestMode
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
  /** 首字节耗时；只有流式/速度诊断量得到，其余模式与没收到正文时为 `null`。 */
  ttftMilliseconds?: number | null
  /** 输出速度；只有速度诊断且成功、且拿得到输出 Token 时才有值。 */
  tokensPerSecond?: number | null
}

export const modelTestRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/model-test/run', handleTestModels)

async function handleTestModels(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { protocol, mode, providerIds, modelIds } = TestModelsSchema.parse(body)
  // 流式与速度都必须在流式形态下跑：速度诊断要的首字节时刻在整包响应里根本不存在，
  // 所以「测速度」不是「连通性 + 多测几个数」，而是另一种请求写法。
  const streaming = mode !== 'connectivity'
  const controller = new AbortController()
  const onClientAbort = () => controller.abort()
  req.once('aborted', onClientAbort)

  const models = (await listProviderModels()).map(model => ({
    id: model.id,
    providerId: model.providerId,
    modelName: model.modelName,
    endpoints: model.endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      endpointUrl: endpoint.url ?? '',
      customAuthHeader: null,
      protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled),
    })),
    priority: 0,
    enabled: model.enabled,
    createdTime: model.createdTime,
    updatedTime: model.updatedTime,
    deletedTime: model.deletedTime,
  }))
  const providers = await listProviders()
  const providerMap = new Map(providers.map(p => [p.id, p]))
  const providerEndpoints = new Map(
    await Promise.all(providers.map(async provider => [
      provider.id,
      new Map((await listProviderEndpoints(provider.id)).filter(endpoint => endpoint.enabled).map(endpoint => [endpoint.protocol, endpoint.url])),
    ] as const)),
  )
  const providerFilter = providerIds ? new Set(providerIds) : null
  const modelFilter = modelIds ? new Set(modelIds) : null

  const testableModels = models.filter(model =>
    model.enabled &&
    (findEndpoint(model, protocol) || findConvertibleEndpoint(model, protocol)) &&
    (!providerFilter || providerFilter.has(model.providerId)) &&
    (!modelFilter || modelFilter.has(model.id)),
  )

  const results: ModelTestResult[] = []

  for (const model of testableModels) {
    // 客户端断开时不再补后面的目标：上游请求已经随 `signal` 断掉，接着测只是白花钱。
    if (controller.signal.aborted) break
    const provider = providerMap.get(model.providerId)
    if (!provider) continue

    const directEndpoint = findEndpoint(model, protocol)
    const endpoint = directEndpoint || findConvertibleEndpoint(model, protocol)
    if (!endpoint) continue

    const startedAt = Date.now()
    try {
      const testBody = buildTestBody(protocol, model.modelName, !directEndpoint, mode)
      // 诊断要测的是「用户当下保存的那一份」：端点 URL 为空时借用供应商级配置，
      // 与真实请求的区别只在这里，因此直接复用规划器的目标映射，不自己拼字段。
      const candidate = {
        model: {
          ...model,
          endpoints: model.endpoints.map(candidate => ({
            ...candidate,
            endpointUrl: candidate.endpointUrl.trim() || providerEndpoints.get(provider.id)?.get(candidate.protocol) || '',
          })),
        },
        provider,
      }
      const target = buildUpstreamTarget(candidate, protocol)
      if (!target) {
        results.push({
          modelId: model.id,
          modelName: model.modelName,
          providerId: provider.id,
          providerName: provider.name,
          mode,
          success: false,
          durationMilliseconds: Date.now() - startedAt,
          ttftMilliseconds: null,
          tokensPerSecond: null,
          // 这里只会是「两层都没有地址」：保存时的校验会拦住它，所以只有从旧版本继承下来的
          // 数据会走到这里（见 `packages/core/source/errors.ts` 的 `endpointUrlMissingError`）。
          errorMessage: `No upstream url is configured for protocol ${protocol}`,
        })
        continue
      }

      const probe = streaming ? new StreamProbeResponse() : null
      const response: BufferedProxyResponse = probe ?? new BufferedProxyResponse()
      await executeProxyRequest({
        context: createRequestContext({
          requestId: generateId('req_'),
          logicalModelId: 'diagnostic',
          clientProtocol: protocol,
          // 客户端跳的形态由我们声明：上游会照着这个形态回，而我们正是要看它照不照做。
          transport: streaming ? 'http-stream' : 'http',
          method: 'POST',
          path: `/diagnostic/${protocol}`,
          headers: {
            accept: streaming ? 'text/event-stream' : 'application/json',
            'content-type': 'application/json',
          },
          requestBody: Buffer.from(testBody),
          signal: controller.signal,
        }),
        targets: [target],
        response,
        // 连接测试是内部执行：它的用量由 `provider_tested` 回答，不是客户端任务（见 `ExecutionOrigin`）。
        origin: 'internal',
      })
      const success = response.statusCode >= 200 && response.statusCode < 400
      // 流式的正文是 SSE，`readUsage` 那个「解一个 JSON」的读法在它面前永远是空的：
      // 用量由同一个累加器从流里读走（它也是唯一还在数首字的地方）。
      const usage = probe ? probe.usage() : readUsage(response.body)
      const durationMilliseconds = Date.now() - startedAt

      results.push({
        modelId: model.id,
        modelName: model.modelName,
        providerId: provider.id,
        providerName: provider.name,
        mode,
        success,
        statusCode: response.statusCode || undefined,
        durationMilliseconds,
        errorMessage: success ? undefined : getDiagnosticError(response),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ttftMilliseconds: probe ? probe.firstOutputElapsed(startedAt) : null,
        tokensPerSecond: success && mode === 'speed' ? tokensPerSecondFromTotals(usage.outputTokens ?? 0, durationMilliseconds) : null,
      })
    } catch (error) {
      if (controller.signal.aborted) break
      results.push({
        modelId: model.id,
        modelName: model.modelName,
        providerId: provider.id,
        providerName: provider.name,
        mode,
        success: false,
        durationMilliseconds: Date.now() - startedAt,
        ttftMilliseconds: null,
        tokensPerSecond: null,
        errorMessage: (error as Error).message,
      })
    }
  }

  const aborted = controller.signal.aborted
  req.removeListener('aborted', onClientAbort)
  // 每个被测目标一条：界面侧把「测试全部模型」拆成若干次请求（一次请求只测一个目标，见
  // `model-test-panel.tsx` 的 `runTasks`），因此这里的一条 `result` 就是那一个目标的结论。
  // 被取消的那次不发——它没有结论，记成失败会把「用户点了取消」算进失败率里（契约注释）。
  if (!aborted && results.length > 0) {
    reportTelemetryEvent({ name: 'provider_tested', result: results.every(result => result.success) ? 'success' : 'failed' })
  }
  // 客户端断开后 socket 已经没了，再写回去只会多一次无意义的写失败；能写就写。
  if (!res.writableEnded && !res.destroyed) sendSuccess(res, { results })
}

/**
 * 从诊断响应里读出用量：三种协议的字段名不同，但都只给「输入 / 输出」两个数。
 * 读不到就返回 `null`，界面用 `—` 占位——诊断面板宁可显示未知，也不编一个 0 出来。
 *
 * 导出仅供单测。
 */
export function readUsage(body: string): { inputTokens: number | null; outputTokens: number | null } {
  const empty = { inputTokens: null, outputTokens: null }
  try {
    const usage = (JSON.parse(body) as { usage?: Record<string, unknown> }).usage
    if (!usage) return empty
    // 与 `observers/usage.ts` 同一口径：有些网关在同一个 usage 里既给 Chat 风格字段
    // （占位 0）又给 Responses 风格字段（真实值），按顺序取「第一个数字」会先撞上占位 0。
    // 因此优先取正数，一个都没有时才回落到 0。
    const pick = (...keys: string[]): number | null => {
      let fallback: number | null = null
      for (const key of keys) {
        const value = usage[key]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        if (value > 0) return value
        if (fallback === null) fallback = value
      }
      return fallback
    }
    return {
      inputTokens: pick('prompt_tokens', 'input_tokens'),
      outputTokens: pick('completion_tokens', 'output_tokens'),
    }
  } catch {
    return empty
  }
}

function getDiagnosticError(response: BufferedProxyResponse): string {
  if (response.failureMessage) return response.failureMessage
  try {
    const body = JSON.parse(response.body) as { errorMessage?: unknown; error?: { message?: unknown } }
    if (typeof body.errorMessage === 'string' && body.errorMessage.trim()) return body.errorMessage
    if (typeof body.error?.message === 'string' && body.error.message.trim()) return body.error.message
  } catch {
    // Non-JSON upstream responses fall back to their HTTP status.
  }
  return `HTTP ${response.statusCode || 502}`
}

/**
 * 流式诊断的出口：它同时也是这次诊断的字节读者。
 *
 * `BufferedProxyResponse` 只攒正文、不留时刻，而流式诊断要回答「第一个字隔了多久才到」。
 * 这里刻意不记「第一块字节」而记「第一段真实生成内容」，与代理落库的首字延迟同一口径
 * （见 `proxy/observers/attempt-observer.ts`）：上游先回一帧 role、再回一帧用量，都不是
 * 用户看到的字；按字节打点会让同一个渠道在诊断面板里的首字比观测页上低一截。
 *
 * 用量也从同一段流里读：SSE 的 usage 散在若干帧上（多数渠道只挂在收尾帧），
 * 能读懂它的只有那个累加器，所以不为「流式」另写一份拆帧逻辑。
 *
 * 形态对不对（上游到底有没有按 SSE 分帧）不在这里判——那是执行器的职责，上游回整包时
 * 这次尝试会被直接判成失败，因此「测得出首字」本身就意味着帧真的是逐块到的。
 *
 * 导出仅供单测。
 */
export class StreamProbeResponse extends BufferedProxyResponse {
  private readonly tracker = createUsageTracker()
  private firstOutputAt: number | null = null

  override write(chunk: string): boolean {
    if (this.tracker.consumeSseChunk(chunk) && this.firstOutputAt === null) this.firstOutputAt = Date.now()
    return super.write(chunk)
  }

  /** 首字耗时；上游一个真实内容都没给过时返回 `null`——没测到不是测得 0。 */
  firstOutputElapsed(startedAt: number): number | null {
    return this.firstOutputAt === null ? null : this.firstOutputAt - startedAt
  }

  /** 上游在流里上报的用量；读不到就是 `null`，界面用 `—` 占位。 */
  usage(): { inputTokens: number | null; outputTokens: number | null } {
    this.tracker.flush()
    const usage = this.tracker.usage()
    return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
  }
}

/** 导出仅供单测：诊断请求的默认正文是最容易被改错的一块。 */
export function buildTestBody(protocol: Protocol, modelId: string, converted: boolean, mode: ModelTestMode = 'connectivity'): string {
  // 速度诊断要一段足够长的输出，否则出字快慢全被首字节和连接开销盖住；
  // 其余模式只问「通不通」，一句话就够，也就没有成本风险。
  const prompt = mode === 'speed' ? SPEED_PROMPT : 'Hi'
  // 流式与否写在请求体里，不是写在头上：三种协议都靠 `stream: true` 表达这件事，
  // 上游也只认这个字段（Anthropic 同样是给 `stream` 才回 SSE）。速度诊断也要流式，
  // 否则量不到首字节与出字。
  const stream = mode !== 'connectivity'
  switch (protocol) {
    case 'openai-completions':
      return JSON.stringify({
        model: modelId,
        ...(stream ? { stream: true } : {}),
        messages: [{ role: 'user', content: prompt }],
      })
    case 'openai-responses':
      return JSON.stringify({
        model: modelId,
        ...(stream ? { stream: true } : {}),
        input: [{ role: 'user', content: prompt }],
      })
    case 'anthropic-messages':
      return JSON.stringify({
        model: modelId,
        // `/v1/messages` 把 max_tokens 当必填，不给就是 400；而且不给的话
        // 转换层会补一个 4096 的上限，一条「Hi」理论上有成本风险，所以这里自己压到最小。
        // 走协议转换时不加：转换后的目标多是 OpenAI 形态，o 系模型只认 max_completion_tokens，
        // 塞 max_tokens 反而会换来一个 400。
        ...(converted ? {} : { max_tokens: mode === 'speed' ? SPEED_MAX_TOKENS : 16 }),
        ...(stream ? { stream: true } : {}),
        messages: [{ role: 'user', content: prompt }],
      })
  }
}
