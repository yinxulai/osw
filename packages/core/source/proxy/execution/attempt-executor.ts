import type { TransportKind } from '@common/schemas'
import type { ExecutionOrigin, UpstreamTarget } from '@server/proxy/contracts'
import { bodyDeliveryShape, createDeliveryDecisionRef } from '@server/proxy/contracts'
import { isEventStreamResponse } from '@server/proxy/adapters/http-response-sink'
import { runAttempts } from '@server/proxy/execution/attempt-runner'
import { relayAttempt, type RelayAttemptResult } from '@server/proxy/kernel/relay'
import type { LiveRequestHandle } from '@server/proxy/observability/live-request-store'
import type { RequestContext } from '@server/proxy/request/request-context'
import { createProxyRequestSession, type ProxyRequestSession } from '@server/proxy/request/request-session'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import { classifyUpstreamStatus, type UpstreamStatusDisposition } from '@server/proxy/response/response'
import { ClientRequestCancelledError, isClientRequestCancelled, LocalAttemptError } from './attempt-errors'
import { concludeDeliveredAttempt, concludeInterruptedAttempt, concludeUndeliverableAttempt, type AttemptConclusionInput } from './attempt-conclusion'
import type { AttemptOutcome } from './attempt-outcome'
import { prepareAttempt, type PreparedAttempt } from './attempt-preparation'
import { createRequestFinalizer } from './request-finalizer-handlers'
import { extractUpstreamRequestId } from './request-id'

export interface ProxyExecutionOptions {
  context: RequestContext
  targets: readonly UpstreamTarget[]
  response: ProxyResponse
  /**
   * 请求生命周期快照。入口请求会传入在读取正文前创建的 session；内部执行未传时
   * 在这里创建，保证设置、起始时间与日志器仍然只有一个来源。
   */
  session?: ProxyRequestSession
  /** 客户端请求与产品内部执行的口径在这里分叉。 */
  origin: ExecutionOrigin
  /** 进行中请求台账；内部执行不传。 */
  live?: LiveRequestHandle
}

export async function executeProxyRequest(options: ProxyExecutionOptions): Promise<void> {
  const { context, targets, response, origin, live } = options
  const session = options.session ?? await createProxyRequestSession(context)
  console.debug(`[proxy] attempt sequence started requestId=${context.requestId} targets=${targets.length} captureContent=${session.settings.captureRequestContent}`)
  const finalizer = createRequestFinalizer({
    context,
    targets,
    response,
    requestLogger: session.logger,
    captureRequestContent: session.settings.captureRequestContent,
    startedAt: session.startedAt,
    origin,
    live,
  })
  await runAttempts<UpstreamTarget, AttemptOutcome>({
    signal: context.signal,
    targets,
    attempt: (target, attemptIndex) => attemptRequest({ context, response, target, attemptIndex, origin, live, session }),
    onSuccess: finalizer.onSuccess,
    onTerminal: finalizer.onTerminal,
    onFailover: finalizer.onFailover,
    onError: finalizer.onError,
    onCancelled: finalizer.onCancelled,
    onExhausted: finalizer.onExhausted,
  })
}

interface AttemptRequestOptions {
  context: RequestContext
  response: ProxyResponse
  target: UpstreamTarget
  attemptIndex: number
  origin: ExecutionOrigin
  live?: LiveRequestHandle
  session: ProxyRequestSession
}

interface AttemptExecution {
  readonly relay: RelayAttemptResult
  readonly statusCode: number
  readonly disposition: UpstreamStatusDisposition
  readonly upstreamTransport: TransportKind | null
  readonly transportMismatch: boolean
  readonly upstreamRequestId: string | null
  readonly durationMilliseconds: number
}

/**
 * 执行一次尝试。
 *
 * 这个函数只保留四步：建立尝试级取消信号，准备请求，执行上游搬运，按结果收尾。
 * 请求协议、规则、修改器与观察者都在准备阶段组装；响应状态、切换与落库由收尾阶段决定。
 */
async function attemptRequest(options: AttemptRequestOptions): Promise<AttemptOutcome> {
  const { context, response, target, attemptIndex, origin, live, session } = options
  if (context.signal.aborted || response.destroyed) throw new ClientRequestCancelledError()

  const controller = new AbortController()
  const abortAttempt = () => controller.abort()
  context.signal.addEventListener('abort', abortAttempt, { once: true })
  const delivery = createDeliveryDecisionRef()
  const attemptStartedAt = Date.now()
  const liveAttempt = live?.startAttempt(target) ?? null
  let liveFailureMessage: string | null = null

  try {
    const prepared = await prepareAttempt({
      context,
      response,
      target,
      attemptIndex,
      attemptStartedAt,
      origin,
      live,
      liveAttempt,
      session,
      controller,
      delivery,
    })
    const execution = await executeRelay(prepared)
    liveFailureMessage = execution.relay.error?.message ?? null
    return await concludeAttempt(prepared, execution)
  } catch (error) {
    liveFailureMessage = error instanceof Error ? error.message : String(error)
    if (error instanceof LocalAttemptError && isClientRequestCancelled(error.cause)) {
      throw new ClientRequestCancelledError()
    }
    throw error
  } finally {
    context.signal.removeEventListener('abort', abortAttempt)
    if (liveAttempt !== null) {
      liveAttempt.patch({
        state: delivery.decision.kind === 'deliver' && delivery.decision.successful
          ? 'success'
          : context.signal.aborted || controller.signal.aborted
            ? 'cancelled'
            : 'failed',
        endedAt: Date.now(),
        ...(liveFailureMessage === null ? {} : { errorMessage: liveFailureMessage }),
      })
    }
  }
}

async function executeRelay(prepared: PreparedAttempt): Promise<AttemptExecution> {
  const { context, target, attemptIndex, exchange, attempt, transport, sink, responseModifiers, observers, delivery, live, liveAttempt } = prepared
  const { requestId } = context
  let statusCode = 502
  let disposition: UpstreamStatusDisposition = 'terminal'
  let upstreamTransport: TransportKind | null = null
  let transportMismatch = false
  let upstreamRequestId: string | null = null

  let relay: RelayAttemptResult
  try {
    relay = await relayAttempt({
      exchange,
      request: { ...exchange, body: prepared.preparedRequest.body, headers: prepared.preparedRequest.headers },
      attempt,
      target,
      transport,
      sink,
      modifiers: responseModifiers,
      observers,
      startedAt: prepared.attemptStartedAt,
      onHead: head => {
        statusCode = head.status
        upstreamTransport = isEventStreamResponse(head.headers) ? 'http-stream' : 'http'
        disposition = classifyUpstreamStatus(statusCode)
        transportMismatch = disposition === 'success'
          && (context.transport === 'http-stream') !== (upstreamTransport === 'http-stream')
        if (transportMismatch) {
          disposition = 'failover'
          console.warn(`[proxy] transport mismatch requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} transport=${context.transport} upstreamTransport=${upstreamTransport} upstreamContentType=${String(head.headers['content-type'] ?? '')}`)
        }
        delivery.decision = disposition === 'failover'
          ? { kind: 'discard', reason: transportMismatch ? 'transport-mismatch' : 'status' }
          : { kind: 'deliver', successful: disposition === 'success' }
        const deliverable = delivery.decision.kind === 'deliver'
        if (!deliverable) sink.discard()
        upstreamRequestId = extractUpstreamRequestId(head.headers)
        liveAttempt?.patch({ httpStatus: statusCode, upstreamTransport, state: deliverable ? 'streaming' : 'failed' })
        if (deliverable) live?.setPhase('awaiting-first-byte')
        live?.pushEvent('upstream.head', disposition === 'success' ? 'success' : 'warn', {
          attempt: attemptIndex + 1,
          httpStatus: statusCode,
          disposition,
          upstreamTransport,
          transportMismatch,
          upstreamRequestIdPresent: upstreamRequestId !== null,
        })
        console.debug(`[proxy] upstream response received requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} status=${statusCode} disposition=${disposition} transport=${context.transport} transportMismatch=${transportMismatch} upstreamTransport=${upstreamTransport} upstreamRequestIdPresent=${upstreamRequestId !== null} responseLatency=${Date.now() - prepared.attemptStartedAt}ms`)
      },
    })
  } catch (error) {
    if (isClientRequestCancelled(error)) throw new ClientRequestCancelledError()
    throw error instanceof Error
      ? new LocalAttemptError(error, prepared.attemptLogger)
      : new LocalAttemptError(new Error(String(error)), prepared.attemptLogger)
  }

  return {
    relay,
    statusCode,
    disposition,
    upstreamTransport,
    transportMismatch,
    upstreamRequestId,
    durationMilliseconds: Date.now() - prepared.attemptStartedAt,
  }
}

async function concludeAttempt(prepared: PreparedAttempt, execution: AttemptExecution): Promise<AttemptOutcome> {
  const { context, target, attemptIndex, sink, observer, attemptLogger, responseEvaluation, delivery } = prepared
  const { requestId } = context
  const mode = bodyDeliveryShape(context.transport)
  const failure = execution.relay.error
  const deliverable = delivery.decision.kind === 'deliver'
  const deliveredSuccessfully = delivery.decision.kind === 'deliver' && delivery.decision.successful
  const conclusion: AttemptConclusionInput = {
    attemptLogger,
    observer,
    sink,
    statusCode: execution.statusCode,
    disposition: execution.disposition,
    upstreamTransport: execution.upstreamTransport,
    transportMismatch: execution.transportMismatch,
    streamInterrupted: failure !== null && deliveredSuccessfully,
    upstreamRequestId: execution.upstreamRequestId,
    durationMilliseconds: execution.durationMilliseconds,
    upstreamProtocol: prepared.attempt.endpointProtocol === context.clientProtocol ? null : prepared.attempt.endpointProtocol,
    responseRewriteRuleIds: responseEvaluation.appliedRuleIds,
  }

  if (isClientRequestCancelled(failure) || (failure === null && !execution.relay.ended && context.signal.aborted)) {
    if (execution.relay.head !== null && deliveredSuccessfully) {
      console.debug(`[proxy] client finished early requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} duration=${execution.durationMilliseconds}ms`)
      return await concludeDeliveredAttempt({ ...conclusion, mode, streamInterrupted: false })
    }
    throw new ClientRequestCancelledError()
  }
  if (failure !== null && delivery.decision.kind === 'pending') throw new LocalAttemptError(failure, attemptLogger)
  if (failure !== null) {
    await concludeInterruptedAttempt({
      ...conclusion,
      failure,
      deliveryStarted: deliverable && (sink.delivery() !== null),
    })
  }
  if (!deliverable) return await concludeUndeliverableAttempt(conclusion)

  // 规则是否生效是**交付形态**的函数，不是「客户端跳的形态是不是 http」的函数：
  // 两者在今天的取值域里同义，但那条同义是巧合，而这里说的是规则引擎真正的前提。
  if (mode === 'incremental') {
    console.debug(`[proxy] response rewrite skipped requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} mode=${mode} rules=${prepared.rules.length} reason=modifier-not-applicable`)
  } else {
    console.debug(`[proxy] response rewrite evaluated requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} mode=${mode} rules=${prepared.rules.length} applied=${responseEvaluation.appliedRuleIds.length} skipped=${responseEvaluation.skippedRuleIds.length} appliedRuleIds=${responseEvaluation.appliedRuleIds.join(',') || 'none'}`)
  }
  return await concludeDeliveredAttempt({ ...conclusion, mode })
}
