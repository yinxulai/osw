import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ProtocolSchema, type Protocol, type Provider } from '@common/schemas'
import { PROTOCOL_DISPLAY_NAMES, createProtocolAuthHeaders } from '@common/protocols'
import { coreNetworkClient } from '@server/infrastructure/network/core-network'
import { getProvider, listProviderEndpoints } from '@server/database/provider-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { HttpRouter } from '@server/http-router'
import { isWebSocketEndpoint } from '@server/proxy/routing/upstream-url'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import { buildTestBody } from './model-test'

/**
 * 供应商模型对话框里的「连接测试」。
 *
 * 与 `/api/model-test/run`（渠道诊断）是**两件事**，不是同一件事的两个入口：
 *
 * | | 渠道诊断 | 这里的连接测试 |
 * |---|---|---|
 * | 测的是什么 | **已经保存的**那一份配置 | 表单里**还没保存的**那一份草稿 |
 * | 一次测几个 | 一批目标 | 这次要提交的那一行 |
 * | 结果进观测吗 | 进（请求日志、用量、健康冷却） | **不进**（探针，不写任何库） |
 *
 * 第二列与第三列是硬约束，不是取向：草稿还没落库，没有 `providerModelId` 可挂，
 * 也没有「这个端点服务过一次真实请求」的事实可以记——一次握手既不该累积用量，
 * 更不该把用户从没启用过的端点推进冷却。
 *
 * 也正因为它不写库，它**不经过代理执行链**：转换适配器、改写规则、故障转移、
 * 观测写入这一整套在这里一件都用不上，而代价是它只测「原生协议连通性」，
 * 不测协议转换（转换是入站能力：客户端协议与端点协议不同才发生，本探测按端点
 * 自己的协议发一次原生请求）。用户要的是「这条地址配得对不对」，这个口径答的就是它。
 */
export const modelConnectivityRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/model/connectivity-test', handleTestModelConnectivity)

/** 一行草稿端点。刻意不是 `ProtocolEndpointSchema`：草稿里没有 id、没有自定义鉴权头，也不该有。 */
const DraftEndpointSchema = z.object({
  protocol: ProtocolSchema,
  /** 模型级覆盖地址；留空表示用供应商级地址。 */
  endpointUrl: z.string().default(''),
})

const TestModelConnectivitySchema = z.object({
  providerId: z.string(),
  /** 草稿里的模型名，原样写进请求体——用户要确认的正是「上游认不认这个名字」。 */
  modelName: z.string().trim().min(1),
  /** 这次提交里启用的端点。空数组不是错误，是「还没配」，由界面拦在保存之前。 */
  endpoints: z.array(DraftEndpointSchema).default([]),
})

export interface ModelConnectivityResult {
  protocol: Protocol
  /** 本次实际请求的地址；这一行没有任何可用地址时为 `null`。 */
  endpointUrl: string | null
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  /**
   * 可本地化的错误码。只有契约里有的失败才有码（缺地址、上游拒凭证、超时……）；
   * 上游原话式的失败（400 的报错正文）没有码，界面直接显示 `errorMessage`。
   */
  errorCode?: string
  /** `errorCode` 的模板变量。服务端不拼句子，界面按码取文案（见 `apps/docs/specs/i18n.md` §5）。 */
  errorParams?: Record<string, string>
  /** 上游原话或本地诊断原文（英文）。 */
  errorMessage?: string
}

async function handleTestModelConnectivity(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = TestModelConnectivitySchema.parse(body)
  const provider = await getProvider(input.providerId)
  if (!provider) {
    sendError(res, 'NOT_FOUND', `Provider not found: ${input.providerId}`, 404, { providerId: input.providerId })
    return
  }

  const controller = new AbortController()
  const onClientAbort = () => controller.abort()
  req.once('aborted', onClientAbort)

  // 供应商级地址一次查够：每一行草稿都可能要借它当默认地址或相对地址的基准。
  const providerUrls = new Map(
    (await listProviderEndpoints(provider.id))
      .filter(endpoint => endpoint.enabled && endpoint.url.trim().length > 0)
      .map(endpoint => [endpoint.protocol, endpoint.url.trim()] as const),
  )
  // 真正被拒的不是 apiKey 而是凭证；一次测试一行，取一次就够，失败按行内错误报。
  const apiKey = await getSecretStore().get(provider.apiKeyReference)

  const results: ModelConnectivityResult[] = []
  for (const endpoint of input.endpoints) {
    if (controller.signal.aborted) break
    results.push(await probeEndpoint({
      provider,
      apiKey,
      providerUrl: providerUrls.get(endpoint.protocol) ?? '',
      modelName: input.modelName,
      protocol: endpoint.protocol,
      draftUrl: endpoint.endpointUrl,
      signal: controller.signal,
    }))
  }

  req.removeListener('aborted', onClientAbort)
  // 客户端断开后 socket 已经没了。停手不只是省一次写入：这条探测本来就没有接收方了，
  // 再往下走（算分、拼结果）都是在替一个不在的人干活。
  if (!controller.signal.aborted && !res.writableEnded && !res.destroyed) sendSuccess(res, { results })
}

interface ProbeInput {
  provider: Provider
  apiKey: string | null
  providerUrl: string
  modelName: string
  protocol: Protocol
  draftUrl: string
  signal: AbortSignal
}

async function probeEndpoint(input: ProbeInput): Promise<ModelConnectivityResult> {
  const { provider, protocol } = input
  const startedAt = Date.now()
  const fail = (error: Omit<ModelConnectivityResult, 'protocol' | 'success' | 'durationMilliseconds' | 'endpointUrl'>): ModelConnectivityResult => ({
    protocol,
    endpointUrl: null,
    success: false,
    durationMilliseconds: Date.now() - startedAt,
    ...error,
  })

  const url = resolveProbeUrl(input.draftUrl, input.providerUrl)
  if (url === null) {
    // 「还没配地址」与「配错了」必须分开说：前者用户去填地址，后者用户去改地址。
    // 用 `VALIDATION_ERROR` 含混过去在界面上只会显示一句「输入内容不合法」，等于没说。
    return fail({
      errorCode: 'ENDPOINT_URL_MISSING',
      errorParams: { providerName: provider.name, protocols: PROTOCOL_DISPLAY_NAMES[protocol] },
      errorMessage: `Provider ${provider.name} has no upstream url for ${protocol}`,
    })
  }
  if (isWebSocketEndpoint(url)) {
    // 探针是「一问一答」的 HTTP 请求（见 `coreNetworkClient.requestHttpBuffered`），
    // 拿它去打一个 WebSocket 端点只会得到一句莫名其妙的失败，不如直说不支持。
    return fail({
      errorCode: 'TRANSPORT_NOT_IMPLEMENTED',
      errorMessage: 'The connectivity test does not support websocket endpoints',
    })
  }

  const parsed = parseProbeUrl(url)
  if (parsed === null) {
    return fail({ errorCode: 'VALIDATION_ERROR', errorMessage: `Invalid upstream url: ${url}` })
  }

  try {
    // `requestHttpBuffered` 的入参 `url` 只用于选出网方式（代理选择、TLS），**真正连
    // 到哪里由 options 里的 hostname/port/path 决定**（见 `core-network.ts` 与
    // `proxy/transports/http.ts`、`diagnostics/provider-models-fetch.ts` 的同样写法）。
    // 只传 url 不填 options 会静默连到 localhost，得到一句没有信息量的连接失败。
    const response = await coreNetworkClient.requestHttpBuffered(
      parsed,
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          ...createProtocolAuthHeaders(protocol, input.apiKey, null),
          accept: 'application/json',
          'content-type': 'application/json',
        },
        timeout: provider.timeoutMilliseconds,
        // 探针不跟随重定向：跟着跳一次就变成了在测另一个地址，用户填的那条到底通不通就没结论了。
        signal: input.signal,
      },
      Buffer.from(buildTestBody(protocol, input.modelName, false)),
    )

    const success = response.statusCode >= 200 && response.statusCode < 400
    return {
      protocol,
      endpointUrl: url,
      success,
      statusCode: response.statusCode,
      durationMilliseconds: Date.now() - startedAt,
      ...(success ? {} : describeStatusFailure(response.statusCode, response.body)),
    }
  } catch (error) {
    return fail({
      ...classifyProbeError(error),
    })
  }
}

/**
 * 把草稿地址补全成可请求的绝对地址；这一行没有任何可用地址时返回 `null`。
 *
 * 模型级覆盖地址常常只是同一个域下的另一条路径，用户写 `/v1beta/...` 这种相对写法
 * 很自然，而真实链路里上游地址必须是绝对地址（`new URL(target.url)`）。相对地址就
 * 以**该协议的供应商级地址**为基准补全——用户想覆盖的就是那个供应商的那条接口。
 * 没有基准时原样返回，交给 `parseProbeUrl` 报「地址不合法」：那正是事实。
 */
export function resolveProbeUrl(draftUrl: string, providerUrl: string): string | null {
  const draft = draftUrl.trim()
  const base = providerUrl.trim()
  if (draft === '') return base === '' ? null : base
  if (base === '') return draft
  try {
    new URL(draft)
    return draft
  } catch {
    try {
      return new URL(draft, base).toString()
    } catch {
      return draft
    }
  }
}

function parseProbeUrl(url: string): URL | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 上游回了个失败状态码时的结论。
 *
 * 只把能确定说清的两类翻成错误码（凭证被拒 / 其它上游故障），其余一律落到
 * `UPSTREAM_ERROR`：探测本身无法判断 400 是「模型名不对」还是「参数不对」，
 * 那时候上游的正文比我们编的句子准确得多，所以把它原样带出去。
 */
function describeStatusFailure(statusCode: number, body: string): Pick<ModelConnectivityResult, 'errorCode' | 'errorMessage'> {
  const detail = readUpstreamMessage(body)
  if (statusCode === 401 || statusCode === 403) {
    return {
      errorCode: 'UPSTREAM_AUTH_FAILED',
      errorMessage: detail ?? 'The upstream rejected the credentials',
    }
  }
  return {
    errorCode: 'UPSTREAM_ERROR',
    errorMessage: detail ?? `HTTP ${statusCode}`,
  }
}

/** 上游正文里的错误说明。三种协议的字段名不同，读不到就是 `null`。 */
function readUpstreamMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { errorMessage?: unknown; error?: { message?: unknown } | string; message?: unknown }
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
    if (typeof parsed.error === 'object' && parsed.error !== null && typeof parsed.error.message === 'string' && parsed.error.message.trim()) return parsed.error.message
    if (typeof parsed.errorMessage === 'string' && parsed.errorMessage.trim()) return parsed.errorMessage
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message
  } catch {
    // 非 JSON 的上游正文没有结构化说明，交给调用方回落成状态码。
  }
  return null
}

/**
 * 连接阶段的失败分类。
 *
 * 与传输层同一口径：超时的判据是文本（`transports/http.ts` 的 `Connection timeout`
 * / `Idle timeout` 就是从这里出去的），其余连接失败统一算上游不可达。
 */
function classifyProbeError(error: unknown): Pick<ModelConnectivityResult, 'errorCode' | 'errorMessage'> {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('CLIENT_REQUEST_ABORTED')) {
    return { errorCode: 'CLIENT_REQUEST_ABORTED', errorMessage: 'The connectivity test was cancelled' }
  }
  if (/timeout/i.test(message)) {
    return { errorCode: 'UPSTREAM_TIMEOUT', errorMessage: message }
  }
  return { errorCode: 'UPSTREAM_ERROR', errorMessage: message }
}
