import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Protocol, RequestAttribute, TransportKind } from '@common/schemas'
import { getSettings } from '@server/database/settings-store'
import { generateId } from '@common/utils'
import { executeProxyRequest } from '../execution/attempt-executor'
import { initializeRequestLogger } from '../observability/logging'
import type { RequestLogger } from '../observability/logging-types'
import { NOOP_PROXY_OBSERVATION_HOOKS, type ProxyObservationHooks } from '../observability/hooks'
import { NodeProxyResponse } from '../response/proxy-response'
import { createRequestContext } from './request-context'
import { proxyTargetPlanner } from '../planners/target-planner'
import { matchProtocolEndpoint } from '../protocols/registry'
import { NO_LANDING_DETAIL, planLandingTargets } from '../routing/landing-planner'
import { parseRouteBody, resolveRoute, toRouteHeaders } from '../routing/route-resolver'
import { resolveUpstreamTransport } from '../routing/upstream-url'
import { collectRequestAttributes, extractClientRequestId } from '@server/proxy/observability/request-attribute-collector'
import { liveRequestStore } from '../observability/live-request-store'

/**
 * 一次交换在入口处就已确定、且不随拒绝原因变化的事实。
 *
 * 「没走进代理执行链路就被拒掉」的请求同样是用户真实发出的请求，也必须落库：
 * 如果这里不写日志，「日志里没有」就会被误读成「没有发过这个请求」。
 */
interface ExchangeIdentity {
  requestId: string
  method: string
  path: string
  headers: IncomingMessage['headers']
  attributes: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  startedAt: number
  hooks: ProxyObservationHooks
}

/** 入口阶段已解析出的事实；尚未解析到时为 `null`。 */
interface ExchangeResolution {
  /**
   * 这次请求路由到的逻辑模型；还没跑到路由求解时为 `null`。
   *
   * 图可以给出多个落点候选（先 A 再 B），此处记的是首选那个，即使它一个可用供应商都没有：
   * 日志要回答的是「这次请求本来该走谁」，而「没走成」由状态字段表达，不该让落点也变成空白。
   */
  logicalModelId: string | null
  /** 已识别出的客户端协议；连 API 路径都无法识别时为 `null`。 */
  clientProtocol: Protocol | null
  /** 已读到的请求体。客户端中途断开时是断开前已经收到的部分，可能不完整。 */
  requestBody: Buffer
  /** 客户端跳的传输形态。由接口的封装描述解析；接口都无法识别时为 `'http'`。 */
  transport: TransportKind
}

/** 我们回给客户端的拒绝响应。 */
interface ExchangeRefusal {
  statusCode: number
  errorCode: string
  errorMessage: string
}

interface RejectedExchange extends ExchangeIdentity, ExchangeResolution {
  refusal: ExchangeRefusal
}

type AbortedExchange = ExchangeIdentity & ExchangeResolution

/** 尚未读到请求体时的占位，避免在多个分支里重复分配。 */
const NO_REQUEST_BODY = Buffer.alloc(0)

/**
 * 读取客户端请求体的结果。
 *
 * 正文**不设大小上限**：代理必须整份读完才谈得上转发（协议转换、正文改写、模型名校验
 * 都要看完整正文），拿字节数拒掉「太大」的请求，等于替用户决定他的多模态请求能有多大。
 * 这是本地工具，不做资源消耗攻击假设——同一条判断在规则引擎里也是这么下的
 * （见 `docs/product/request-rewrite-rules.md`）。
 */
interface RequestBodyReadResult {
  /** 已读到的正文；`aborted` 时只保留到那一刻为止收到的部分。 */
  body: Buffer
  /** 客户端没把正文发完就断开了。 */
  aborted: boolean
}

/**
 * 处理一次 HTTP 代理请求。
 *
 * 走哪个逻辑模型不由调用方指定、也不写死在代码里：由当前生效的**工作流图**算出来。
 * 图读到的就是这次请求本身（路径 / 方法 / 头 / 体），产出一串按优先级排的落点逻辑模型，
 * 入口拿着这串落点去问规划器谁能用。策略是图，规则就只存在于图里。
 */
export async function handleProxyRequest(req: IncomingMessage, res: ServerResponse, hooks: ProxyObservationHooks = NOOP_PROXY_OBSERVATION_HOOKS): Promise<void> {
  const startedAt = Date.now()
  const requestId = generateId('req_')
  const method = req.method ?? 'POST'
  const path = req.url ?? '/'
  const attributes = collectRequestAttributes(req.headers)
  // 交换标识在这里一次绑好：下面所有拒绝分支共用同一份，不必逐条重复。
  const identity: ExchangeIdentity = { requestId, method, path, headers: req.headers, attributes, startedAt, hooks }
  // 台账在**第一件事**之前开张：这次请求从「连路径都还没认出来」开始就被人看着了。
  // 协议与形态此刻还不知道，解析出来后再补（见 `live.update`）。
  const live = liveRequestStore.begin({ id: requestId, method, path, transport: 'http', clientProtocol: null })
  /** 拒绝这次交换：回错误响应 + 记一条失败日志。台账跟着落定，否则它会一直挂在「进行中」。 */
  const reject = (refusal: ExchangeRefusal, resolution: ExchangeResolution) => {
    live.update(resolution)
    live.settle('failed', 'request.rejected', 'error', { errorCode: refusal.errorCode, httpStatus: refusal.statusCode })
    return rejectExchange(res, { ...identity, ...resolution, refusal })
  }
  /** 客户端中途断开：没有响应可写，只记一条已取消。 */
  const abort = (resolution: ExchangeResolution) => {
    live.update(resolution)
    live.settle('cancelled', 'request.aborted', 'warn')
    return recordAbortedExchange({ ...identity, ...resolution })
  }

  // 入口匹配一次，同时定下协议、接口与封装描述；后面的模型读写与流式判定都问这个结果。
  const endpoint = matchProtocolEndpoint(method, path)
  if (!endpoint) {
    console.warn(`[proxy] unknown API path method=${method} path=${path} requestId=${requestId}`)
    await reject({ statusCode: 404, errorCode: 'UNKNOWN_API_PATH', errorMessage: 'Unrecognized API path' }, { logicalModelId: null, clientProtocol: null, requestBody: NO_REQUEST_BODY, transport: 'http' })
    return
  }
  const protocol = endpoint.protocol
  const requestUrl = new URL(path, 'http://localhost')
  /** 封装描述的入参：模型读写与流式判定都只看这三样。 */
  const readEnvelope = (body: Buffer) => ({ headers: req.headers, body, url: requestUrl })

  const { body: requestBody, aborted } = await readRequestBody(req)
  if (aborted) {
    // 客户端在正文读完前断开：请求确实到达了代理，但我们既拿不到完整正文，
    // 也没有任何响应能写回客户端，只能记成「已取消」——但不能因此不记。
    console.debug(`[proxy] client request aborted requestId=${requestId} phase=read-body bodyBytes=${requestBody.length}`)
    await abort({ logicalModelId: null, clientProtocol: protocol, requestBody, transport: endpoint.envelope.resolveTransport(readEnvelope(requestBody)) })
    return
  }
  const clientRequestId = extractClientRequestId(req.headers)
  console.debug(`[proxy] request accepted requestId=${requestId} clientRequestId=${clientRequestId ?? 'none'} method=${req.method ?? 'POST'} path=${req.url ?? '/'} protocol=${protocol} endpoint=${endpoint.endpointId} bodyBytes=${requestBody.length}`)
  const envelopeInput = readEnvelope(requestBody)
  const transport = endpoint.envelope.resolveTransport(envelopeInput)
  const modelResult = endpoint.envelope.readModel(envelopeInput)
  if (!modelResult.ok) {
    console.warn(`[proxy] invalid model request requestId=${requestId} protocol=${protocol} reason=${modelResult.reason}`)
    await reject({ statusCode: 400, errorCode: 'INVALID_MODEL', errorMessage: modelResult.reason }, { logicalModelId: null, clientProtocol: protocol, requestBody, transport })
    return
  }

  // 路由决策：把这次请求交给当前生效的那一份路由定义（工作流图或规则表），
  // 拿回一串按优先级排的落点逻辑模型。生效的是哪一份由设置决定，入口不选、也不问。
  // 图是异步的（脚本节点会跳进沙箱、提示词节点会去调模型），因此落点在这一步之后才有。
  // 模型名**不进定义**，也不在这里另立一个变量：定义读到的就是请求本身（路径 / 方法 / 头 / 体），
  // 模型名在 `request.body.model` 上，由协议发现节点或规则条件按各自的方式声明。
  // 下面那两条日志**就地**引用上面那次模型校验读到的值，它不是第二份事实：
  // 「没落点」那条恰恰是持久化的请求日志里 `logicalModelId` 为空的场景，控制台不记就没人知道客户端要的是哪个模型。
  const route = await resolveRoute({
    request: { path: requestUrl.pathname, method, headers: toRouteHeaders(req.headers), body: parseRouteBody(requestBody) },
    clientProtocol: protocol,
    // 形态如实上报：这个入口就是 HTTP，客户端「要不要增量」由封装描述解析出的 `transport` 表达。
    // 图与代理层说的是同一个词、同一个取值集合。
    transport,
    traceId: requestId,
  })
  if (route.logicalModelIds.length === 0) {
    console.error(`[proxy] no landing logical model requestId=${requestId} clientModel=${modelResult.model.trim()} mode=${route.mode} definitionVersion=${route.definitionVersion} stopReason=${route.stopReason}`)
    await reject({ statusCode: 503, errorCode: 'NO_MODEL_CONFIGURED', errorMessage: NO_LANDING_DETAIL }, { logicalModelId: null, clientProtocol: protocol, requestBody, transport })
    return
  }
  console.debug(`[proxy] route resolved requestId=${requestId} clientModel=${modelResult.model.trim()} mode=${route.mode} definitionVersion=${route.definitionVersion} stopReason=${route.stopReason} landingModels=${route.logicalModelIds.join(',')}`)

  // 落点 → 候选：落点列表按优先级排，第一个有可用候选的落点胜出。
  // 协议取自图的决策而不是入口自己再记一份：两者同源才能保证「图说是什么就是什么」。
  // 形态**不传**：上游跳用什么形态是规划器对那个候选的决定（端点地址的 scheme），客户端偏好从不改变哪个端点合法。
  const plan = await planLandingTargets({ logicalModelIds: route.logicalModelIds, clientProtocol: route.protocol })
  console.debug(`[proxy] routing planned requestId=${requestId} landingModels=${route.logicalModelIds.join(',')} logicalModelId=${plan.logicalModelId ?? 'none'} protocol=${route.protocol} transport=${route.transport} planner=${proxyTargetPlanner.id} manualModelId=${plan.manualModelId ?? 'none'} reason=${plan.logicalModelId === null ? plan.reason : 'none'} targets=${plan.targets.length} targetOrder=${plan.targets.map(target => target.providerModelId).join(',') || 'none'} upstreamTransports=${plan.targets.map(target => resolveUpstreamTransport(target.url, route.transport)).join(',') || 'none'}`)
  if (plan.logicalModelId === null) {
    // 落点一个都没成，但图确实选过落点：日志照记首选落点，否则「路由到了谁」会被记成空白。
    const landing = route.logicalModelIds[0]
    if (plan.reason === 'manual-model-unavailable') {
      console.warn(`[proxy] manual provider model unavailable requestId=${requestId} protocol=${protocol} detail=${plan.detail}`)
      await reject({ statusCode: 409, errorCode: 'MANUAL_MODEL_UNAVAILABLE', errorMessage: plan.detail }, { logicalModelId: landing, clientProtocol: protocol, requestBody, transport })
      return
    }
    console.warn(`[proxy] no available upstream provider: ${method} ${path} (protocol=${protocol}, landingModels=${route.logicalModelIds.join(',')}, mode=${route.mode}, definitionVersion=${route.definitionVersion}, requestId=${requestId}, reason=${plan.reason}, detail=${plan.detail})`)
    await reject({ statusCode: 503, errorCode: 'NO_AVAILABLE_PROVIDER', errorMessage: `No available upstream provider: ${plan.detail}` }, { logicalModelId: landing, clientProtocol: protocol, requestBody, transport })
    return
  }

  const logicalModelId = plan.logicalModelId
  // 路由结论落进台账：这一步之后界面才谈得上「实时看见路由到了谁、按什么顺序试」。
  live.resolveRoute({ logicalModelId, clientProtocol: route.protocol, transport: route.transport, candidates: plan.targets })
  live.setPhase('connecting')
  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  res.once('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  const context = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    // 客户端跳的形态就是入口解析出来的那一个：换层不换词。
    transport,
    method,
    path,
    headers: req.headers,
    attributes,
    requestBody,
    signal: controller.signal,
  })

  console.debug(`[proxy] execution started requestId=${requestId} logicalModelId=${logicalModelId} targets=${plan.targets.length}`)
  await executeProxyRequest({ context, targets: plan.targets, response: new NodeProxyResponse(res), hooks, origin: 'client', live })
}

/**
 * 打开这次交换的日志器，并补齐「是否采集正文」这个唯一来自设置的字段。
 *
 * 入口阶段的两条出口（拒绝、中断）都从这里拿日志器，保证这个判断只有一个点。
 */
async function openExchangeLogger(input: ExchangeIdentity & ExchangeResolution): Promise<RequestLogger> {
  const settings = await getSettings()
  return initializeRequestLogger({
    requestId: input.requestId,
    logicalModelId: input.logicalModelId,
    clientProtocol: input.clientProtocol,
    method: input.method,
    path: input.path,
    headers: input.headers,
    attributes: input.attributes,
    requestBody: input.requestBody,
    transport: input.transport,
    captureRequestLogs: settings.captureRequestLogs,
    captureRequestContent: settings.captureRequestContent,
    hooks: input.hooks,
  })
}

/** 拒绝收尾：回一条错误响应，再记一条失败日志。入口处所有拒绝分支共用。 */
async function rejectExchange(res: ServerResponse, input: RejectedExchange): Promise<void> {
  const responseBody = writeJsonError(res, input.refusal.statusCode, input.refusal.errorCode, input.refusal.errorMessage)
  const logger = await openExchangeLogger(input)
  await logger.finalizeLocalErrorContent(input.refusal.statusCode, res.getHeaders(), responseBody)
  await logger.finalizeRequestLog('failed', input.startedAt)
}

/** 中断收尾：写入一条被客户端中断的记录，没有响应写出，因此不写客户端正文的响应侧。 */
async function recordAbortedExchange(input: AbortedExchange): Promise<void> {
  const logger = await openExchangeLogger(input)
  await logger.finalizeRequestLog('cancelled', input.startedAt)
}

/**
 * 读取客户端请求体。
 *
 * 不用 reject 表达「读不完」：调用方拿到 reject 只会让它抛出请求入口，于是这次请求
 * 在记录里彻底消失（客户端那边却真实地失败了一次）。把结果交回调用方，才能记「已取消」。
 */
function readRequestBody(req: IncomingMessage): Promise<RequestBodyReadResult> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let settled = false
    const finish = (aborted: boolean) => {
      if (settled) return
      settled = true
      resolve({ body: Buffer.concat(chunks), aborted })
    }
    req.on('data', chunk => {
      if (settled) return
      chunks.push(chunk)
    })
    req.on('end', () => finish(false))
    req.on('aborted', () => finish(true))
    req.on('error', () => finish(true))
    // 已经发过的事件不会重发：漏掉 `aborted` 会让这个 Promise 永远挂着，于是这次
    // 请求永远不会被记录。
    if (req.aborted) finish(true)
  })
}

function writeJsonError(res: ServerResponse, statusCode: number, errorCode: string, errorMessage: string): string {
  const responseBody = JSON.stringify({ success: false, errorCode, errorMessage })
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(responseBody)
  return responseBody
}
