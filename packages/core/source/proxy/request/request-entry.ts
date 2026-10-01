import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Protocol, RequestAttribute, TransportKind } from '@common/schemas'
import type { ClientDelivery, UpstreamTarget } from '@server/proxy/contracts'
import { generateId } from '@common/utils'
import { executeProxyRequest } from '../execution/attempt-executor'
import { formatTarget } from '../execution/attempt-outcome'
import { NodeProxyResponse, PROXY_ERROR_HEADERS, proxyErrorBody } from '../response/proxy-response'
import { createRequestContext } from './request-context'
import { proxyTargetPlanner } from '../planners/target-planner'
import { matchProtocolEndpoint } from '../protocols/registry'
import { NO_LANDING_DETAIL, planLandingTargets } from '../routing/landing-planner'
import { parseRouteBody, resolveRoute, toRouteHeaders } from '../routing/route-resolver'
import { resolveUpstreamTransport } from '../routing/upstream-url'
import { collectRequestAttributes, extractClientRequestId } from '@server/proxy/observability/request-attribute-collector'
import { liveRequestStore } from '../observability/live-request-store'
import { createProxyRequestSession, type ProxyRequestSession } from './request-session'

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
 * 把落点顺序渲染成人能读的一串「供应商/模型」。
 *
 * 日志是给人看的，而人脑子里记的是 `openai/gpt-4o` 这种名字，不是 `model_ab12cd`。
 * 只用名字也不行：同名落点是允许的，排障时得能把那一行对回数据库里的具体一行。
 * 所以两个都给——直接复用执行层同一个 `formatTarget`，免得两处格式各自漂移。
 */
function describeTargetOrder(targets: readonly UpstreamTarget[]): string {
  if (targets.length === 0) return 'none'
  return targets.map(target => formatTarget(target)).join(' -> ')
}

/**
 * 读取客户端请求体的结果。
 *
 * 正文**不设大小上限**：代理必须整份读完才谈得上转发（协议转换、正文改写、模型名校验
 * 都要看完整正文），拿字节数拒掉「太大」的请求，等于替用户决定他的多模态请求能有多大。
 * 这是本地工具，不做资源消耗攻击假设——同一条判断在规则引擎里也是这么下的
 * （见 `apps/docs/specs/request-rewrite-rules.md`）。
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
export async function handleProxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startedAt = Date.now()
  const requestId = generateId('req_')
  const method = req.method ?? 'POST'
  const path = req.url ?? '/'
  const attributes = collectRequestAttributes(req.headers)
  // 交换标识在这里一次绑好：下面所有拒绝分支共用同一份，不必逐条重复。
  const identity: ExchangeIdentity = { requestId, method, path, headers: req.headers, attributes, startedAt }
  // 台账在**第一件事**之前开张：这次请求从「连路径都还没认出来」开始就被人看着了。
  // 协议与形态此刻还不知道，解析出来后再补（见 `live.update`）。
  const live = liveRequestStore.begin({ id: requestId, method, path, transport: 'http', clientProtocol: null })
  const controller = new AbortController()
  const abortRequest = () => controller.abort()
  req.once('aborted', abortRequest)
  res.once('close', () => {
    if (!res.writableEnded) abortRequest()
  })
  if (req.aborted || res.destroyed) abortRequest()
  const session = await createProxyRequestSession({
    requestId,
    logicalModelId: null,
    clientProtocol: null,
    method,
    path,
    headers: req.headers,
    attributes,
    requestBody: NO_REQUEST_BODY,
    transport: 'http',
    startedAt,
  })
  /** 拒绝这次交换：回错误响应 + 记一条失败日志。台账跟着落定，否则它会一直挂在「进行中」。 */
  const reject = async (refusal: ExchangeRefusal, resolution: ExchangeResolution) => {
    live.update(resolution)
    live.settle('failed', 'request.rejected', 'error', { errorCode: refusal.errorCode, httpStatus: refusal.statusCode })
    return rejectExchange(res, { ...identity, ...resolution, refusal }, session)
  }
  /** 客户端中途断开：没有响应可写，只记一条已取消。 */
  const abort = async (resolution: ExchangeResolution) => {
    live.update(resolution)
    live.settle('cancelled', 'request.aborted', 'warn')
    return recordAbortedExchange({ ...identity, ...resolution }, session)
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
  console.debug(`[proxy] request accepted requestId=${requestId} clientRequestId=${clientRequestId ?? 'none'} method=${req.method ?? 'POST'} path=${req.url ?? '/'} protocol=${protocol} bodyBytes=${requestBody.length}`)
  const envelopeInput = readEnvelope(requestBody)
  const transport = endpoint.envelope.resolveTransport(envelopeInput)
  await session.logger.updateRequest({ logicalModelId: null, clientProtocol: protocol, method, path, headers: req.headers, requestBody, transport })
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
  if (controller.signal.aborted) {
    await abort({ logicalModelId: route.logicalModelIds[0] ?? null, clientProtocol: route.protocol, requestBody, transport: route.transport })
    return
  }
  if (route.logicalModelIds.length === 0) {
    console.error(`[proxy] no landing logical model requestId=${requestId} clientModel=${modelResult.model.trim()} mode=${route.mode} definitionVersion=${route.definitionVersion} stopReason=${route.stopReason}`)
    await reject({ statusCode: 503, errorCode: 'NO_MODEL_CONFIGURED', errorMessage: NO_LANDING_DETAIL }, { logicalModelId: null, clientProtocol: route.protocol, requestBody, transport: route.transport })
    return
  }
  console.debug(`[proxy] route resolved requestId=${requestId} clientModel=${modelResult.model.trim()} mode=${route.mode} definitionVersion=${route.definitionVersion} stopReason=${route.stopReason} landingModels=${route.logicalModelIds.join(',')}`)

  // 落点 → 候选：落点列表按优先级排，第一个有可用候选的落点胜出。
  // 协议取自图的决策而不是入口自己再记一份：两者同源才能保证「图说是什么就是什么」。
  // 形态**不传**：上游跳用什么形态是规划器对那个候选的决定（端点地址的 scheme），客户端偏好从不改变哪个端点合法。
  // 会话键在入口已经解出来（`clientRequestId`），多个落点共用同一个：亲和是会话级的事实，不是落点级的。
  const plan = await planLandingTargets({ logicalModelIds: route.logicalModelIds, clientProtocol: route.protocol, sessionKey: clientRequestId })
  console.debug(`[proxy] routing planned requestId=${requestId} landingModels=${route.logicalModelIds.join(',')} logicalModelId=${plan.logicalModelId ?? 'none'} protocol=${route.protocol} transport=${route.transport} planner=${proxyTargetPlanner.id} manualModelId=${plan.manualModelId ?? 'none'} reason=${plan.logicalModelId === null ? plan.reason : 'none'} targets=${plan.targets.length} targetOrder=${describeTargetOrder(plan.targets)} upstreamTransports=${plan.targets.map(target => resolveUpstreamTransport(target.url, route.transport)).join(',') || 'none'}`)
  if (plan.logicalModelId === null) {
    // 落点一个都没成，但图确实选过落点：日志照记首选落点，否则「路由到了谁」会被记成空白。
    const landing = route.logicalModelIds[0]
    if (plan.reason === 'manual-model-unavailable') {
      console.warn(`[proxy] manual provider model unavailable requestId=${requestId} protocol=${route.protocol} detail=${plan.detail}`)
      await reject({ statusCode: 409, errorCode: 'MANUAL_MODEL_UNAVAILABLE', errorMessage: plan.detail }, { logicalModelId: landing, clientProtocol: route.protocol, requestBody, transport: route.transport })
      return
    }
    console.warn(`[proxy] no available upstream provider: ${method} ${path} (protocol=${route.protocol}, landingModels=${route.logicalModelIds.join(',')}, mode=${route.mode}, definitionVersion=${route.definitionVersion}, requestId=${requestId}, reason=${plan.reason}, detail=${plan.detail})`)
    await reject({ statusCode: 503, errorCode: 'NO_AVAILABLE_PROVIDER', errorMessage: `No available upstream provider: ${plan.detail}` }, { logicalModelId: landing, clientProtocol: route.protocol, requestBody, transport: route.transport })
    return
  }
  if (controller.signal.aborted) {
    await abort({ logicalModelId: plan.logicalModelId, clientProtocol: route.protocol, requestBody, transport: route.transport })
    return
  }

  const logicalModelId = plan.logicalModelId
  // 路由结论落进台账：这一步之后界面才谈得上「实时看见路由到了谁、按什么顺序试」。
  live.resolveRoute({ logicalModelId, clientProtocol: route.protocol, transport: route.transport, candidates: plan.targets })
  live.setPhase('connecting')
  const context = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: route.protocol,
    // 客户端跳的形态就是入口解析出来的那一个：换层不换词。
    transport: route.transport,
    method,
    path,
    headers: req.headers,
    // 成功收尾要用它刷新缓存亲和的绑定：与规划用的是同一个键，两处不能各解一份。
    sessionKey: clientRequestId,
    attributes,
    requestBody,
    signal: controller.signal,
  })

  console.debug(`[proxy] execution started requestId=${requestId} logicalModelId=${logicalModelId} targets=${plan.targets.length}`)
  await executeProxyRequest({ context, targets: plan.targets, response: new NodeProxyResponse(res), session, origin: 'client', live })
}

/** 拒绝收尾：回一条错误响应，再记一条失败日志。入口处所有拒绝分支共用。 */
async function rejectExchange(res: ServerResponse, input: RejectedExchange, session: ProxyRequestSession): Promise<void> {
  await session.logger.updateRequest(input)
  await session.logger.finalizeLocalErrorContent(writeJsonError(res, input.refusal))
  await session.logger.finalizeRequestLog('failed', session.startedAt)
}

/** 中断收尾：写入一条被客户端中断的记录，没有响应写出，因此不写客户端正文的响应侧。 */
async function recordAbortedExchange(input: AbortedExchange, session: ProxyRequestSession): Promise<void> {
  await session.logger.updateRequest(input)
  await session.logger.finalizeRequestLog('cancelled', session.startedAt)
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

/**
 * 写出一条拒绝响应，并交回它的交付事实。
 *
 * 这入口里唯一的响应写出点，因此也是唯一需要记账的地方：交回的快照就是客户端收到的
 * 状态码、响应头与正文。**不能**用 `res.getHeaders()` 事后回读——它是宿主内部状态，
 * 而客户端视角的记录要的是我们交出去的那一份。
 */
function writeJsonError(res: ServerResponse, refusal: ExchangeRefusal): ClientDelivery {
  const body = proxyErrorBody(refusal.errorCode, refusal.errorMessage)
  const headers = PROXY_ERROR_HEADERS
  res.statusCode = refusal.statusCode
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  res.end(body)
  // 代理自己生成的拒绝响应必定是完整的一份：它在本进程里一次成形。
  return { statusCode: refusal.statusCode, headers, body, complete: true }
}
