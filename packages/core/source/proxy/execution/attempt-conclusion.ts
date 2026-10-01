import type { Protocol, TransportKind } from '@common/schemas'
import type { BodyDeliveryShape } from '@server/proxy/contracts'
import type { HttpResponseSink } from '@server/proxy/adapters/http-response-sink'
import type { AttemptObserver } from '@server/proxy/observers/attempt-observer'
import type { AttemptLogger, UpstreamContentInput } from '@server/proxy/observability/logging-types'
import { serializeCapturedHeaders } from '@server/proxy/response/headers'
import type { UpstreamStatusDisposition } from '@server/proxy/response/response'
import { ProtocolConversionError } from '@server/proxy/protocols/shared/conversion-error'
import { RecordedAttemptError } from './attempt-errors'
import { type ClientResponseCapture, type DeliveredAttemptOutcome, type DiscardedAttemptOutcome } from './attempt-outcome'
import { extractRequestIdFromBody } from './request-id'

/**
 * 一次尝试收尾所需的全部事实。
 *
 * 这些事实在搬运过程中被逐步确定（状态码、是否流式、上游请求 id……），收尾时一次性
 * 交给下面的判定函数。把「落库载荷的形状」集中在这里，编排代码就只剩流程。
 */
export interface AttemptConclusionInput {
  /** 尝试级日志器：唯一知道「真正发往上游的请求」的写入点。 */
  readonly attemptLogger: AttemptLogger
  /** 上游视角观察者：上游返回了什么从它取。 */
  readonly observer: AttemptObserver
  /**
   * 客户端出口：客户端真正收到了什么由它决定。
   *
   * 刻意不接受 `ProxyResponse`：出口已经把「状态码 + 响应头 + 正文 + 完整与否」收成一个
   * 快照（{@link HttpResponseSink.delivery}），收尾再拿响应对象自己拼一遍，等于同一件
   * 事实有两个源，而它们会分叉（头已发出 / 正文只搬了一半，就是两种不同的分叉）。
   */
  readonly sink: HttpResponseSink
  readonly statusCode: number
  readonly disposition: UpstreamStatusDisposition
  /** 上游跳实际是什么形态。**纯上游事实**，与客户端跳的要求无关。 */
  readonly upstreamTransport: TransportKind | null
  /** 上游跳没有兼现客户端跳要求的形态（2xx 但要 `http-stream` 却回了非 SSE，或反之）。 */
  readonly transportMismatch: boolean
  /** 上游回了 2xx，正文却只搬了一半就断了（失败的事实不在状态码里）。 */
  readonly streamInterrupted: boolean
  readonly upstreamRequestId: string | null
  readonly durationMilliseconds: number
  /** 真正发往上游的协议；只有发生了协议转换时非空。 */
  readonly upstreamProtocol: Protocol | null
  /** 本次尝试在响应阶段命中的改写规则 id。 */
  readonly responseRewriteRuleIds: string[]
}

/** 中断收尾：上游已经发过响应头，搬运中途断了。 */
export interface InterruptedAttemptInput extends AttemptConclusionInput {
  readonly failure: Error
  /** 本次尝试是否已经真正开始向客户端交付；为假表示响应头都还没写出。 */
  readonly deliveryStarted: boolean
}

/** 交付收尾：响应确实写出了客户端。 */
export interface DeliveredAttemptInput extends AttemptConclusionInput {
  /**
   * 这次交付的正文形态（见 `BodyDeliveryShape`）。
   *
   * 「交付完不完整」不在这里：那个事实已经随 {@link HttpResponseSink.delivery} 从出口
   * 一起交出来——它是唯一知道「收尾跑完了没有」的地方，调用方转述只会多一处可能说错的转述。
   */
  readonly mode: BodyDeliveryShape
}

function upstreamContent(captureStatus: 'captured' | 'partial', statusCode: number, observer: AttemptObserver, body: string | null): UpstreamContentInput {
  return {
    captureStatus,
    responseStatus: statusCode,
    responseHeaders: observer.head()?.headers ?? null,
    responseBody: body,
  }
}

/**
 * 把出口交出的交付事实装箱成客户端视角正文。
 *
 * 两个字段同进同出：出口说没发过头，就没有「客户端视角的响应」——头与正文一起为 `null`，
 * 不能一边写「客户端收到了 200」一边写「正文不知道」。
 */
function clientCapture(sink: HttpResponseSink): ClientResponseCapture {
  const delivered = sink.delivery()
  if (!delivered) return { captureStatus: 'partial', responseHeaders: null, responseBody: null }
  return {
    // 半截正文不是完整采集：这份记录存在的意义就是告诉详情页「你看到的正文是半截的」，
    // 标成 captured 等于把它伪装成一份完整记录。
    captureStatus: delivered.complete ? 'captured' : 'partial',
    responseHeaders: serializeCapturedHeaders(delivered.headers),
    responseBody: delivered.body,
  }
}

/**
 * 中断收尾。
 *
 * 「已经交付」与「已经放弃」的差别只有一个事实：客户端有没有收到内容。因此两条分支
 * 的 `servesRequest`、用量与客户端视角快照必须跟着这个事实走，不能靠状态码猜。
 */
export async function concludeInterruptedAttempt(input: InterruptedAttemptInput): Promise<never> {
  const partialBody = input.observer.upstreamBody()
  const errorCode = input.failure instanceof ProtocolConversionError
    ? input.failure.code
    : 'UPSTREAM_STREAM_ERROR'
  const responseConversionFailed = input.failure instanceof ProtocolConversionError
  if (!input.deliveryStarted) {
    await input.attemptLogger.finalizeAttempt({
      status: 'failed',
      httpStatus: input.statusCode,
      retryable: true,
      upstreamTransport: input.upstreamTransport,
      // 本次尝试已被放弃，客户端未收到任何响应，因此不承担请求级用量。
      servesRequest: false,
      errorCode,
      errorMessage: input.failure.message,
      upstreamRequestId: input.upstreamRequestId,
      upstreamContent: upstreamContent('partial', input.statusCode, input.observer, partialBody),
    })
    throw new RecordedAttemptError(input.failure, {
      delivery: 'discarded',
      disposition: 'failover',
      statusCode: input.statusCode,
      durationMilliseconds: input.durationMilliseconds,
      upstreamRequestId: input.upstreamRequestId,
      upstreamResponseBody: partialBody,
      transportMismatch: input.transportMismatch,
      responseConversionFailed,
    })
  }
  await input.attemptLogger.finalizeAttempt({
    status: 'failed',
    httpStatus: input.statusCode,
    retryable: false,
    upstreamTransport: input.upstreamTransport,
    // 响应已经开始写出客户端，部分内容已经到达，因此它仍然是服务这个请求的尝试。
    servesRequest: true,
    errorCode,
    errorMessage: input.failure.message,
    upstreamRequestId: input.upstreamRequestId,
    usage: input.observer.usage(),
    upstreamContent: upstreamContent('partial', input.statusCode, input.observer, partialBody),
    responseRewriteRuleIds: input.responseRewriteRuleIds,
    ttftMilliseconds: input.observer.ttftMilliseconds(),
  })
  throw new RecordedAttemptError(input.failure, {
    delivery: 'delivered',
    disposition: input.disposition,
    statusCode: input.statusCode,
    durationMilliseconds: input.durationMilliseconds,
    upstreamRequestId: input.upstreamRequestId,
    upstreamResponseBody: partialBody,
    streamInterrupted: input.streamInterrupted,
    responseConversionFailed,
    // 中断的交付永远是「半截」：它没有收尾，正文只搬了一部分。这里不读出口的快照，
    // 因为出口还会说「这是我记的全部正文」，而这一段对话的完整度已经由这个事实定死了。
    clientResponse: { ...clientCapture(input.sink), captureStatus: 'partial' },
  })
}

/**
 * 上游返回了「不该交付给客户端」的状态码。
 *
 * 这种尝试必须能被下一次尝试接替，因此它不承担请求级用量，也不带客户端视角快照：
 * 客户端什么都没收到。健康度判定用的是上游原文，所以结果里回传原文。
 */
export async function concludeUndeliverableAttempt(input: AttemptConclusionInput): Promise<DiscardedAttemptOutcome> {
  const upstreamBody = input.observer.upstreamBody()
  const upstreamRequestId = input.upstreamRequestId ?? extractRequestIdFromBody(input.observer.rawBody())
  await input.attemptLogger.finalizeAttempt({
    status: 'failed',
    httpStatus: input.statusCode,
    retryable: true,
    upstreamTransport: input.upstreamTransport,
    servesRequest: false,
    errorCode: `Status_${input.statusCode}`,
    errorMessage: `Upstream responded with ${input.statusCode}`,
    upstreamRequestId,
    upstreamContent: upstreamContent('captured', input.statusCode, input.observer, upstreamBody),
  })
  // 本次尝试已被放弃，客户端未收到任何响应，因此不携带 clientResponse。
  return {
    delivery: 'discarded',
    disposition: 'failover',
    statusCode: input.statusCode,
    durationMilliseconds: input.durationMilliseconds,
    upstreamRequestId,
    upstreamResponseBody: input.observer.rawBody(),
    transportMismatch: input.transportMismatch,
  }
}

/**
 * 交付收尾：上游响应已经（或正在）完整交给客户端。
 *
 * 「上游视角正文」与「健康度判定用的正文」在下发流式时并不相同：前者是分块快照，
 * 后者是原文。因此成功尝试用快照，非成功尝试用原文——健康度需要看到完整错误信息。
 */
export async function concludeDeliveredAttempt(input: DeliveredAttemptInput): Promise<DeliveredAttemptOutcome> {
  const successful = input.disposition === 'success'
  const client = clientCapture(input.sink)
  const upstreamBody = input.observer.upstreamBody()
  const resolvedBody = successful ? upstreamBody : input.observer.rawBody()
  const upstreamRequestId = input.upstreamRequestId ?? extractRequestIdFromBody(resolvedBody)
  const ttftMilliseconds = input.observer.ttftMilliseconds()
  await input.attemptLogger.finalizeAttempt({
    status: successful ? 'success' : 'failed',
    httpStatus: input.statusCode,
    retryable: false,
    upstreamTransport: input.upstreamTransport,
    // 响应已经写出客户端，因此它就是服务这个请求的那次尝试。
    servesRequest: true,
    errorCode: successful ? undefined : `Status_${input.statusCode}`,
    errorMessage: successful ? undefined : `Upstream responded with ${input.statusCode}`,
    upstreamRequestId,
    usage: input.observer.usage(),
    upstreamContent: upstreamContent(client.captureStatus, input.statusCode, input.observer, upstreamBody),
    responseRewriteRuleIds: input.responseRewriteRuleIds,
    ttftMilliseconds,
  })
  return {
    delivery: 'delivered',
    disposition: input.disposition,
    statusCode: input.statusCode,
    durationMilliseconds: input.durationMilliseconds,
    upstreamRequestId,
    ttftMilliseconds: ttftMilliseconds ?? undefined,
    upstreamProtocol: input.upstreamProtocol,
    upstreamResponseBody: resolvedBody,
    clientResponse: client,
  }
}
