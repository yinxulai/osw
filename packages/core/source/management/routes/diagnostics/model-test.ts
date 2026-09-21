import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { listProviderEndpoints, listProviders } from '@server/database/provider-store'
import { listProviderModels } from '@server/database/model-store'
import { generateId } from '@common/utils'
import { findConvertibleEndpoint, findEndpoint } from '../../../proxy/routing/router'
import { buildUpstreamTarget } from '../../../proxy/planners/target-planner'
import { executeProxyRequest } from '../../../proxy/execution/attempt-executor'
import { createRequestContext } from '../../../proxy/request/request-context'
import { BufferedProxyResponse } from '../../../proxy/response/proxy-response'
import { HttpRouter } from '@server/http-router'
import { reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import type { Protocol } from '@common/schemas'

const TestModelsSchema = z.object({
  protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']),
  providerIds: z.array(z.string()).optional(),
  modelIds: z.array(z.string()).optional(),
})

export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
}

export const modelTestRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/model-test/run', handleTestModels)

async function handleTestModels(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { protocol, providerIds, modelIds } = TestModelsSchema.parse(body)
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
      const testBody = buildTestBody(protocol, model.modelName, !directEndpoint)
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
          success: false,
          durationMilliseconds: Date.now() - startedAt,
          // 这里只会是「两层都没有地址」：保存时的校验会拦住它，所以只有从旧版本继承下来的
          // 数据会走到这里（见 `packages/core/source/errors.ts` 的 `endpointUrlMissingError`）。
          errorMessage: `No upstream url is configured for protocol ${protocol}`,
        })
        continue
      }

      const response = new BufferedProxyResponse()
      await executeProxyRequest({
        context: createRequestContext({
          requestId: generateId('req_'),
          logicalModelId: 'diagnostic',
          clientProtocol: protocol,
          method: 'POST',
          path: `/diagnostic/${protocol}`,
          headers: {
            accept: 'application/json',
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
      const usage = readUsage(response.body)

      results.push({
        modelId: model.id,
        modelName: model.modelName,
        providerId: provider.id,
        providerName: provider.name,
        success,
        statusCode: response.statusCode || undefined,
        durationMilliseconds: Date.now() - startedAt,
        errorMessage: success ? undefined : getDiagnosticError(response),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
    } catch (error) {
      if (controller.signal.aborted) break
      results.push({
        modelId: model.id,
        modelName: model.modelName,
        providerId: provider.id,
        providerName: provider.name,
        success: false,
        durationMilliseconds: Date.now() - startedAt,
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

/** 导出仅供单测：诊断请求的默认正文是最容易被改错的一块。 */
export function buildTestBody(protocol: Protocol, modelId: string, converted: boolean): string {
  switch (protocol) {
    case 'openai-completions':
      return JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Hi' }],
      })
    case 'openai-responses':
      return JSON.stringify({
        model: modelId,
        input: [{ role: 'user', content: 'Hi' }],
      })
    case 'anthropic-messages':
      return JSON.stringify({
        model: modelId,
        // `/v1/messages` 把 max_tokens 当必填，不给就是 400；而且不给的话
        // 转换层会补一个 4096 的上限，一条「Hi」理论上有成本风险，所以这里自己压到最小。
        // 走协议转换时不加：转换后的目标多是 OpenAI 形态，o 系模型只认 max_completion_tokens，
        // 塞 max_tokens 反而会换来一个 400。
        ...(converted ? {} : { max_tokens: 16 }),
        messages: [{ role: 'user', content: 'Hi' }],
      })
  }
}
