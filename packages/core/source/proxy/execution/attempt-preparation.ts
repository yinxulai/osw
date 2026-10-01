import { resolveProtocolAuthHeaders } from '@common/protocols'
import type { RequestRewriteRule } from '@common/schemas'
import { listRulesForProviderModel } from '@server/database/request-rewrite-rule-store'
import type {
  AttemptView,
  BufferedPayload,
  DeliveryDecisionRef,
  ExchangeView,
  ExecutionOrigin,
  Modifier,
  Observer,
  Transport,
  UpstreamTarget,
} from '@server/proxy/contracts'
import { createHttpResponseSink, type HttpResponseSink } from '@server/proxy/adapters/http-response-sink'
import { formatTarget } from '@server/proxy/execution/attempt-outcome'
import { bodyDeliveryShape } from '@server/proxy/contracts'
import { notifyObservers } from '@server/proxy/kernel/observer-notifications'
import { createRequestModifiers, type RewriteEvaluation } from '@server/proxy/modifiers/request-modifiers'
import { createResponseModifiers } from '@server/proxy/modifiers/response-modifiers'
import { createAttemptObserver, type AttemptObserver } from '@server/proxy/observers/attempt-observer'
import { createAttemptLogger } from '@server/proxy/observability/logging'
import type { AttemptLogger } from '@server/proxy/observability/logging-types'
import { createLiveAttemptObserver } from '@server/proxy/observability/live-request-observer'
import type { LiveAttemptHandle, LiveRequestHandle } from '@server/proxy/observability/live-request-store'
import { protocolAdapters } from '@server/proxy/protocols/registry'
import { ToolNameRegistry } from '@server/proxy/protocols/shared/tool-name-registry'
import { createRequestContext, type RequestContext } from '@server/proxy/request/request-context'
import type { ProxyRequestSession } from '@server/proxy/request/request-session'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import { resolveUpstreamTransport } from '@server/proxy/routing/upstream-url'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { reportTelemetryEvent } from '@server/telemetry'
import { pipeBuffered } from '@server/proxy/kernel/buffered-pipe'
import { resolveTransportImplementation } from '@server/proxy/transports/registry'

export interface PrepareAttemptInput {
  readonly context: RequestContext
  readonly response: ProxyResponse
  readonly target: UpstreamTarget
  readonly attemptIndex: number
  /** 尝试整体开始时刻；准备、中继、TTFT 与落库共用同一起点。 */
  readonly attemptStartedAt: number
  readonly origin: ExecutionOrigin
  readonly live?: LiveRequestHandle
  readonly liveAttempt: LiveAttemptHandle | null
  readonly session: ProxyRequestSession
  readonly controller: AbortController
  readonly delivery: DeliveryDecisionRef
}

/**
 * 已完成请求侧准备、但尚未联系上游的一次尝试。
 *
 * 这里刻意只暴露后续阶段真正需要的对象，不把适配器、规则列表、工具名注册表等准备期
 * 中间物继续带着走。生命周期结束后的收尾只需要观察者、出口、日志器与请求侧事实。
 */
export interface PreparedAttempt {
  readonly context: RequestContext
  readonly target: UpstreamTarget
  readonly attemptIndex: number
  readonly attemptStartedAt: number
  readonly origin: ExecutionOrigin
  readonly live?: LiveRequestHandle
  readonly liveAttempt: LiveAttemptHandle | null
  readonly session: ProxyRequestSession
  readonly controller: AbortController
  readonly delivery: DeliveryDecisionRef
  readonly exchange: ExchangeView
  readonly attempt: AttemptView
  readonly preparedRequest: BufferedPayload
  readonly rules: readonly RequestRewriteRule[]
  readonly observer: AttemptObserver
  readonly observers: readonly Observer[]
  readonly sink: HttpResponseSink
  readonly attemptLogger: AttemptLogger
  readonly responseModifiers: readonly Modifier[]
  readonly responseEvaluation: RewriteEvaluation
  readonly transport: Transport
}

/**
 * 请求侧准备。
 *
 * 这个阶段只产生「一次尝试需要发送什么」和「响应回来时由谁观察/改写/写出」，
 * 不决定失败后是否切换候选。切换是执行器的职责，准备阶段一旦失败直接向上抛。
 */
export async function prepareAttempt(input: PrepareAttemptInput): Promise<PreparedAttempt> {
  const { context, response, target, attemptIndex, attemptStartedAt, origin, live, liveAttempt, session, controller, delivery } = input
  const { requestId, logicalModelId, clientProtocol: protocol, requestBody } = context
  const endpointProtocol = target.protocol
  const requestContext = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    transport: context.transport,
    method: context.method,
    path: context.path,
    headers: context.headers,
    requestBody,
    signal: controller.signal,
  })
  const adapter = protocolAdapters.resolve(protocol, endpointProtocol)
  if (origin === 'client' && adapter.kind === 'conversion') {
    reportTelemetryEvent({ name: 'protocol_conversion_used', from: protocol, to: endpointProtocol })
  }

  const [apiKey, rules] = await Promise.all([
    getSecretStore().get(target.apiKeyReference),
    listRulesForProviderModel(target.providerModelId),
  ])
  const toolNames = new ToolNameRegistry()
  const attempt: AttemptView = { index: attemptIndex, endpointId: target.endpointId, endpointProtocol }
  const exchange: ExchangeView = {
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    transport: context.transport,
    method: context.method,
    path: context.path,
    headers: context.headers,
    body: requestBody,
    signal: controller.signal,
  }
  const requestEvaluation: RewriteEvaluation = {
    appliedRuleIds: [],
    skippedRuleIds: [],
    bodyBytesBefore: requestBody.length,
    bodyBytesAfter: requestBody.length,
  }
  const responseEvaluation: RewriteEvaluation = {
    appliedRuleIds: [],
    skippedRuleIds: [],
    bodyBytesBefore: 0,
    bodyBytesAfter: 0,
  }
  const observer = createAttemptObserver({
    exchange,
    attempt,
    captureEnabled: session.settings.captureRequestContent,
    startedAt: attemptStartedAt,
  })
  const liveObserver = createLiveAttemptObserver({
    handle: liveAttempt,
    streaming: context.transport === 'http-stream',
    startedAt: attemptStartedAt,
    onFirstByte: ttftMilliseconds => {
      live?.setPhase('streaming')
      live?.pushEvent('upstream.first-byte', 'info', { attempt: attemptIndex + 1, ttftMilliseconds })
    },
  })
  const observers = [observer, liveObserver]
  const sink = createHttpResponseSink({
    response,
    // 交付形态在这里算一次、往下传：出口与响应修改器必须得到同一个答案，
    // 各判一次就会分叉（见 `BodyDeliveryShape`）。
    mode: bodyDeliveryShape(context.transport),
    captureEnabled: session.settings.captureRequestContent,
    onDeliveredChunk: chunk => notifyObservers(observers, current => current.onDownstreamChunk?.(exchange, attempt, chunk)),
  })

  const requestModifiers = createRequestModifiers({
    adapter,
    requestContext,
    providerModelName: target.providerModelName,
    auth: resolveProtocolAuthHeaders(endpointProtocol, apiKey, target.customAuthHeader),
    rules,
    toolNames,
    onRewriteEvaluated: result => { Object.assign(requestEvaluation, result) },
  })
  const responseModifiers = createResponseModifiers({
    adapter,
    delivery,
    rules,
    toolNames,
    onRewriteEvaluated: result => { Object.assign(responseEvaluation, result) },
  })
  const requestPipe = await pipeBuffered({
    payload: { body: requestBody, headers: context.headers },
    context: { exchange, attempt, direction: 'request', clientProtocol: protocol, upstreamProtocol: endpointProtocol, upstreamHead: null },
    modifiers: requestModifiers,
  })
  if (!requestPipe.payload) {
    throw new Error(`The request was dropped by a request modifier before forwarding: ${target.providerModelName}`)
  }
  const preparedRequest = requestPipe.payload
  liveAttempt?.patch({
    requestBytes: preparedRequest.body.length,
    state: 'awaiting-upstream',
    requestRewriteRuleNames: ruleNamesOf(rules, requestEvaluation.appliedRuleIds),
  })
  live?.setPhase('awaiting-upstream')
  if (requestEvaluation.appliedRuleIds.length > 0 || adapter.kind === 'conversion') {
    live?.pushEvent('request.prepared', 'info', {
      attempt: attemptIndex + 1,
      protocolConverted: adapter.kind === 'conversion',
      requestBytes: preparedRequest.body.length,
    })
  }

  console.debug(`[proxy] attempt prepared requestId=${requestId} attempt=${attemptIndex} target=${formatTarget(target)} clientProtocol=${protocol} upstreamProtocol=${endpointProtocol} conversion=${adapter.kind === 'conversion'} requestBytes=${requestBody.length} upstreamRequestBytes=${preparedRequest.body.length} timeout=${target.timeoutMilliseconds}ms`)
  console.debug(`[proxy] request rewrite evaluated requestId=${requestId} attempt=${attemptIndex} target=${formatTarget(target)} rules=${rules.length} applied=${requestEvaluation.appliedRuleIds.length} skipped=${requestEvaluation.skippedRuleIds.length} appliedRuleIds=${requestEvaluation.appliedRuleIds.join(',') || 'none'} bodyBytesBefore=${requestEvaluation.bodyBytesBefore} bodyBytesAfter=${requestEvaluation.bodyBytesAfter}`)

  const attemptLogger = createAttemptLogger({
    requestId,
    attemptIndex,
    startedAt: attemptStartedAt,
    target,
    upstreamRequestHeaders: preparedRequest.headers,
    upstreamRequestBody: preparedRequest.body,
    requestRewriteRuleIds: requestEvaluation.appliedRuleIds,
    customAuthHeader: target.customAuthHeader,
    captureRequestContent: session.settings.captureRequestContent,
  })
  const transport = resolveTransportImplementation({
    transport: resolveUpstreamTransport(target.url, context.transport),
    resolveIdleTimeoutMilliseconds: () => session.settings.idleTimeoutMilliseconds,
  })
  return {
    context,
    target,
    attemptIndex,
    attemptStartedAt,
    origin,
    live,
    liveAttempt,
    session,
    controller,
    delivery,
    exchange,
    attempt,
    preparedRequest,
    rules,
    observer,
    observers,
    sink,
    attemptLogger,
    responseModifiers,
    responseEvaluation,
    transport,
  }
}

function ruleNamesOf(rules: readonly RequestRewriteRule[], ids: readonly string[]): string[] {
  const names = new Map(rules.map(rule => [rule.id, rule.name]))
  return ids.map(id => names.get(id) ?? id)
}
