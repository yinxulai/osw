import type { TelemetryFailoverAttemptBucket } from '@common/telemetry'
import { CLIENT_REQUEST_ABORTED, UPSTREAM_ERROR } from '@common/error-codes'
import { isOutboundProxyConnectionError } from '@server/infrastructure/network/outbound-connector'
import type { ExecutionOrigin, UpstreamTarget } from '@server/proxy/contracts'
import { createAttemptLogger } from '@server/proxy/observability/logging'
import type { LiveRequestHandle } from '@server/proxy/observability/live-request-store'
import type { RequestLogger } from '@server/proxy/observability/logging-types'
import type { RequestContext } from '@server/proxy/request/request-context'
import { RequestRewriteError } from '@server/proxy/request-rewrite/request-rewrite-engine'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import { isClientAttributableStatus, type HealthFailureScope } from '@server/proxy/response/response'
import { markProviderModelSuccess, markProviderSuccess } from '@server/proxy/upstream/health'
import { recordAffinityProviderModelId } from '@server/proxy/upstream/affinity'
// 统计埋点直连遥测入口，**不经过请求日志器**：记录日志是用户可关的调试功能（观测口径），
// 而「处理了多少任务」是产品口径，两者开关不同、保留期不同、字段要求相反（telemetry.md §5.4）。
import { reportTelemetryEvent } from '@server/telemetry'
import { isClientRequestCancelled, LocalAttemptError, RecordedAttemptError, serializeLocalFailure } from './attempt-errors'
import { formatTarget, healthFailureHints, recordHealthFailure, toRequestContentOutcome } from './attempt-outcome'
import type { DeliveredAttemptOutcome, DiscardedAttemptOutcome } from './attempt-outcome'

/**
 * 请求级收尾的统一入口。
 *
 * 执行器只按顺序试，试完把结局交给这里；六类结局各自独立、不共享控制流，
 * 每种只负责把自己的事实写进日志、健康度与实时台账。
 */
export interface RequestFinalizer {
  onSuccess(target: UpstreamTarget, outcome: DeliveredAttemptOutcome, attemptIndex: number): Promise<void>
  onTerminal(target: UpstreamTarget, outcome: DeliveredAttemptOutcome, attemptIndex: number): Promise<void>
  onFailover(target: UpstreamTarget, outcome: DiscardedAttemptOutcome, attemptIndex: number): Promise<void>
  onError(target: UpstreamTarget, error: unknown, attemptIndex: number): Promise<boolean>
  onCancelled(target: UpstreamTarget, attemptIndex: number): Promise<void>
  onExhausted(lastError: Error | null): Promise<void>
}

export interface RequestFinalizerOptions {
  context: RequestContext
  /** 计划中的全部上游，顺序即优先级；收尾只看「下一个是谁」。 */
  targets: readonly UpstreamTarget[]
  response: ProxyResponse
  requestLogger: RequestLogger
  captureRequestContent: boolean
  startedAt: number
  /** 见 `ProxyExecutionOptions.origin`：统计只把客户端请求算作「处理了一个任务」。 */
  origin: ExecutionOrigin
  /**
   * 进行中请求台账的写口。收尾是这次请求在**内存台账里**的最后一个动作：
   * `finalizeRequestLog` 把事实落进数据库，`settle` 把它从「进行中」列表里拿下。
   * 两者成对出现，不让任何一条分支只做一半——只落库不 settle 会在界面上留下永远
   * 不会结束的请求，只 settle 不落库会把这次请求从记录里抹掉。
   */
  live?: LiveRequestHandle
}

/**
 * 请求级收尾的六个结局各自独立，不共享控制流，只共享一份“最后一次失败”的归因状态。
 * 执行器只负责按顺序试；这里只负责把最终事实写进日志、健康度与实时台账。
 */
export function createRequestFinalizer(options: RequestFinalizerOptions): RequestFinalizer {
  const runtime = createRuntime(options)
  return {
    onSuccess: createSuccessHandler(runtime),
    onTerminal: createTerminalHandler(runtime),
    onFailover: createFailoverHandler(runtime),
    onError: createErrorHandler(runtime),
    onCancelled: createCancelledHandler(runtime),
    onExhausted: createExhaustedHandler(runtime),
  }
}

interface FinalizerRuntime {
  readonly context: RequestFinalizerOptions['context']
  readonly targets: RequestFinalizerOptions['targets']
  readonly response: RequestFinalizerOptions['response']
  readonly requestLogger: RequestFinalizerOptions['requestLogger']
  readonly captureRequestContent: boolean
  readonly startedAt: number
  readonly origin: RequestFinalizerOptions['origin']
  readonly live: LiveRequestHandle | undefined
  readonly requestId: string
  readonly logicalModelId: string | null
  readonly protocol: RequestFinalizerOptions['context']['clientProtocol']
  lastUpstreamFailure: UpstreamFailureSummary | null
  lastClientAttributableFailure: UpstreamFailureSummary | null
}

function createRuntime(options: RequestFinalizerOptions): FinalizerRuntime {
  const { context } = options
  return {
    context,
    targets: options.targets,
    response: options.response,
    requestLogger: options.requestLogger,
    captureRequestContent: options.captureRequestContent,
    startedAt: options.startedAt,
    origin: options.origin,
    live: options.live,
    requestId: context.requestId,
    logicalModelId: context.logicalModelId,
    protocol: context.clientProtocol,
    lastUpstreamFailure: null,
    lastClientAttributableFailure: null,
  }
}

/**
 * `failover_happened.attempts` 的分桶。
 *
 * 入参是**转移之后要进行的第几次尝试**，因此它的下限就是 `2`：转移本身意味着还有下一个候选。
 * 精确值对产品决策没有额外信息量，却是更细的行为指纹，所以四层以上合并成一桶
 * （见 `TELEMETRY_FAILOVER_ATTEMPT_BUCKETS`）。
 */
export function failoverAttemptBucket(attempts: number): TelemetryFailoverAttemptBucket {
  if (attempts >= 4) return '4+'
  return attempts === 3 ? '3' : '2'
}

function createSuccessHandler(runtime: FinalizerRuntime): RequestFinalizer['onSuccess'] {
  return async (target, outcome, attemptIndex) => {
    if (outcome.disposition !== 'success') return
    const { context, protocol, requestId, requestLogger, startedAt, origin, live } = runtime
    console.info(
      `[proxy] request forwarded requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} upstreamProtocol=${outcome.upstreamProtocol ?? protocol} attempt=${attemptIndex} attempts=${attemptIndex + 1} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms totalDuration=${Date.now() - startedAt}ms`,
    )
    await markProviderSuccess(target.providerId)
    await markProviderModelSuccess(target.providerModelId)
    // 缓存亲和：成功即刷新（或建立）会话绑定，failover 之后的成功在这里自然完成改绑。
    // 没有会话键（内部执行、探测）或功能关闭时，写入自身不生效。
    if (context.sessionKey) await recordAffinityProviderModelId(context.logicalModelId, context.sessionKey, target.providerModelId)
    await requestLogger.finalizeRequestContent(toRequestContentOutcome(outcome))
    // 用量不在请求级收尾里写：它随着「服务该请求的那次尝试」一起落库。
    await requestLogger.finalizeRequestLog('success', startedAt)
    settleLive({
      live,
      status: 'success',
      kind: 'request.completed',
      level: 'success',
      detail: { attempt: attemptIndex + 1, httpStatus: outcome.statusCode, durationMilliseconds: outcome.durationMilliseconds },
    })
    // 本地任务量就在这里计：一次成功的转发就是一次被处理的任务，发一条、不带属性。
    // 内部执行不算任务：连接测试与工作流里的模型节点走的是同一条收尾，但它们不是
    // 「代理替客户端处理的一次请求」（见 `ExecutionOrigin`）。
    if (origin === 'client') reportTelemetryEvent({ name: 'request_completed' })
  }
}

function createTerminalHandler(runtime: FinalizerRuntime): RequestFinalizer['onTerminal'] {
  return async (target, outcome, attemptIndex) => {
    const { context, protocol, requestId, requestLogger, startedAt, live } = runtime
    console.warn(
      `[proxy] upstream request terminated without retry requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} attempts=${attemptIndex + 1} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms totalDuration=${Date.now() - startedAt}ms`,
    )
    await requestLogger.finalizeRequestContent(toRequestContentOutcome(outcome))
    await requestLogger.finalizeRequestLog('failed', startedAt)
    settleLive({
      live,
      status: 'failed',
      kind: 'request.failed',
      level: 'error',
      detail: { attempt: attemptIndex + 1, httpStatus: outcome.statusCode },
    })
  }
}

function createFailoverHandler(runtime: FinalizerRuntime): RequestFinalizer['onFailover'] {
  return async (target, outcome, attemptIndex) => {
    const { context, targets, protocol, requestId, origin, live } = runtime
    const nextTarget = targets[attemptIndex + 1]
    const failure: UpstreamFailureSummary = { statusCode: outcome.statusCode, body: outcome.upstreamResponseBody ?? null }
    runtime.lastUpstreamFailure = failure
    // 转移发生一次发一条。`attemptIndex + 2` 是「转移之后落在第几次尝试上」：
    // `attemptIndex` 从 0 起，第一次尝试失败后要试的是第 2 个候选（见 `failoverAttemptBucket`）。
    // 没有下一个候选时不算转移——那是「候选耗尽」，不是转移（见 `onExhausted`）。
    if (origin === 'client' && nextTarget) {
      reportTelemetryEvent({ name: 'failover_happened', attempts: failoverAttemptBucket(attemptIndex + 2) })
    }
    // 只要出现过一次请求格式类 4xx，客户端的请求就已经被上游判定为「不成立」，
    // 这个结论不会因为后面某家网络不通而失效；若后面又是同类 4xx，覆盖成最近那一条，
    // 因为正文要交给客户端的是最近一次上游原文。
    if (isClientAttributableStatus(failure.statusCode)) runtime.lastClientAttributableFailure = failure
    const healthScope = await recordHealthFailure(target, outcome.statusCode, healthFailureHints(outcome))
    live?.pushEvent('route.failover', 'warn', {
      attempt: attemptIndex + 1,
      httpStatus: outcome.statusCode,
      // 没有下一家时**不带这个键**，而不是带 `null`：`LiveRequestEvent.detail` 的值只允许标量，
      // 而界面读「键不存在」与读「值是 null」是同一件事。
      ...(nextTarget ? { nextProviderModelName: nextTarget.providerModelName } : {}),
      healthFailureScope: healthScope,
    })
    console.warn(
      `[proxy] upstream failover scheduled requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms nextProviderModelId=${nextTarget?.providerModelId ?? 'none'} healthFailureScope=${healthScope}`,
    )
  }
}

function createErrorHandler(runtime: FinalizerRuntime): RequestFinalizer['onError'] {
  return async (target, error, attemptIndex) => {
    const { context, targets, response, requestLogger, captureRequestContent, startedAt, requestId, protocol, live } = runtime
    // 本地失败外层只负责把「实际发往上游的请求」带出来；判断与分类仍按原始错误做。
    const localFailure = error instanceof LocalAttemptError ? error : null
    const rootError = localFailure ? localFailure.cause : error
    const lastError = error instanceof Error ? error : new Error(String(error))

    if (rootError instanceof RequestRewriteError) {
      console.warn(`[proxy] request rewrite rejected requestId=${requestId} providerModelId=${target.providerModelId} ruleId=${rootError.ruleId ?? 'unknown'} error=${rootError.message}`)
      if (!response.headersSent) {
        // 响应体确实写给了客户端，就必须留证：否则这次失败在记录里只剩一个「failed」
        // 状态，看不出代理回了什么，也就无从判断客户端为什么报错。
        // 状态码、响应头、正文一并从出口取回：它们是**同一次交付**的三个字段。
        await requestLogger.finalizeLocalErrorContent(response.fail(422, rootError.code, rootError.message))
      }
      await requestLogger.finalizeRequestLog('failed', startedAt)
      settleLive({
        live,
        status: 'failed',
        kind: 'request.rewrite_rejected',
        level: 'error',
        detail: { errorCode: rootError.code, httpStatus: 422 },
      })
      return false
    }

    if (isClientRequestCancelled(rootError)) {
      console.debug(`[proxy] client request cancelled requestId=${requestId} attempt=${attemptIndex}`)
      await recordCancelledAttempt(runtime, target, attemptIndex, lastError)
      await requestLogger.finalizeRequestLog('cancelled', startedAt)
      settleLive({ live, status: 'cancelled', kind: 'request.cancelled', level: 'warn', detail: { attempt: attemptIndex + 1 } })
      return false
    }

    const nextTarget = targets[attemptIndex + 1]
    console.warn(
      `[proxy] upstream attempt failed requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} failover=${!response.headersSent && nextTarget !== undefined} nextProviderModelId=${nextTarget?.providerModelId ?? 'none'} error=${lastError.message}`,
    )
    await recordFailedAttempt({
      runtime,
      target,
      attemptIndex,
      error,
      localFailure,
      lastError,
      captureRequestContent,
    })

    const recordedOutcome = error instanceof RecordedAttemptError ? error.outcome : null
    // 上游明确回了「请求不成立」的状态码、随后正文搬运中断时，这条尝试是作为异常
    // （`RecordedAttemptError`）抛出来的，不会经过 `onFailover`。事实不能因此漏收：
    // 漏掉它，客户端就会在这个永远不可能成功的请求上拿到一个「可重试」的 502。
    if (recordedOutcome !== null && isClientAttributableStatus(recordedOutcome.statusCode)) {
      runtime.lastClientAttributableFailure = { statusCode: recordedOutcome.statusCode, body: recordedOutcome.upstreamResponseBody ?? null }
    }
    let healthScope: HealthFailureScope = 'none'
    if (!isOutboundProxyConnectionError(rootError)) {
      healthScope = await recordHealthFailure(target, recordedOutcome?.statusCode ?? null, recordedOutcome === null ? {} : healthFailureHints(recordedOutcome))
    }
    if (healthScope !== 'none') {
      console.debug(
        `[proxy] health failure recorded requestId=${requestId} attempt=${attemptIndex} providerId=${target.providerId} providerModelId=${target.providerModelId} scope=${healthScope} status=${recordedOutcome?.statusCode ?? 'none'}`,
      )
    }
    if (response.headersSent) {
      if (error instanceof RecordedAttemptError && error.outcome.clientResponse) {
        await requestLogger.finalizeRequestContent(toRequestContentOutcome(error.outcome))
      }
      response.destroy(lastError)
      await requestLogger.finalizeRequestLog('failed', startedAt)
      settleLive({
        live,
        status: 'failed',
        kind: 'request.failed',
        level: 'error',
        detail: { attempt: attemptIndex + 1, errorCode: UPSTREAM_ERROR },
      })
      return false
    }
    return true
  }
}

function createCancelledHandler(runtime: FinalizerRuntime): RequestFinalizer['onCancelled'] {
  return async (_target, attemptIndex) => {
    const { requestId, requestLogger, startedAt, live } = runtime
    console.debug(`[proxy] request execution cancelled requestId=${requestId} attempt=${attemptIndex} attempts=${attemptIndex + 1} totalDuration=${Date.now() - startedAt}ms`)
    await requestLogger.finalizeRequestLog('cancelled', startedAt)
    settleLive({ live, status: 'cancelled', kind: 'request.cancelled', level: 'warn', detail: { attempt: attemptIndex + 1 } })
  }
}

function createExhaustedHandler(runtime: FinalizerRuntime): RequestFinalizer['onExhausted'] {
  return async lastError => {
    const { context, targets, response, requestLogger, startedAt, requestId, logicalModelId, protocol, live } = runtime
    if (!response.headersSent) {
      const message = describeExhaustion(lastError, runtime.lastClientAttributableFailure, runtime.lastUpstreamFailure)
      // 状态码保留上游失败的性质，而不是一律折叠成 502：
      // 上游说「这个请求不成立」时回它原本的 4xx，客户端才能据此修正请求而不是无限重试；
      // 失败属于服务端/连接层时才回 `502 ALL_PROVIDERS_FAILED`（本项目的网关语义）。
      // `errorCode` 不变：它说的是代理层的结论（没有任何候选能服务这个请求），
      // 机器可读的「责任归属」由 HTTP 状态码承担。
      const statusCode = runtime.lastClientAttributableFailure?.statusCode ?? 502
      console.error(
        `[proxy] all providers failed requestId=${requestId} method=${context.method} path=${context.path} clientProtocol=${protocol} logicalModelId=${logicalModelId} attempts=${targets.length} clientStatus=${statusCode} lastUpstreamStatus=${runtime.lastUpstreamFailure?.statusCode ?? 'none'} totalDuration=${Date.now() - startedAt}ms error=${message}`,
      )
      const delivered = response.fail(statusCode, 'ALL_PROVIDERS_FAILED', message)
      await requestLogger.finalizeLocalErrorContent(delivered)
    }
    await requestLogger.finalizeRequestLog('failed', startedAt)
    settleLive({
      live,
      status: 'failed',
      kind: 'request.exhausted',
      level: 'error',
      detail: {
        attempts: targets.length,
        // 没有上游回过头时省略字段；界面不需要一个与真实状态码同形状的字符串哨兵。
        ...(runtime.lastUpstreamFailure === null ? {} : { lastUpstreamStatus: runtime.lastUpstreamFailure.statusCode }),
      },
    })
  }
}

async function recordCancelledAttempt(runtime: FinalizerRuntime, target: UpstreamTarget, attemptIndex: number, error: Error): Promise<void> {
  try {
    await createAttemptLogger({
      requestId: runtime.requestId,
      attemptIndex,
      startedAt: runtime.startedAt,
      target,
      upstreamRequestHeaders: {},
      upstreamRequestBody: Buffer.alloc(0),
      captureRequestContent: false,
    }).finalizeAttempt({
      status: 'cancelled',
      httpStatus: null,
      retryable: false,
      // 客户端取消时上游未必已响应，因此不知道上游跳是什么形态。
      upstreamTransport: null,
      // 客户端什么都没收到，因此不承担请求级用量。
      servesRequest: false,
      errorCode: CLIENT_REQUEST_ABORTED,
      errorMessage: error.message,
    })
  } catch (logError) {
    console.error(`[proxy] failed to write the cancelled attempt log: ${(logError as Error).message}`)
  }
}

interface FailedAttemptInput {
  runtime: FinalizerRuntime
  target: UpstreamTarget
  attemptIndex: number
  error: unknown
  localFailure: LocalAttemptError | null
  lastError: Error
  captureRequestContent: boolean
}

async function recordFailedAttempt(input: FailedAttemptInput): Promise<void> {
  const { runtime, target, attemptIndex, error, localFailure, lastError, captureRequestContent } = input
  try {
    if (error instanceof RecordedAttemptError) return
    // 本地失败用这次尝试自己的日志器：只有它知道真正发往上游的请求头与请求体。
    // 换成空壳会让上游视角看起来像「什么都没发出去」。
    const attemptLogger = localFailure?.attemptLogger ?? createAttemptLogger({
      requestId: runtime.requestId,
      attemptIndex,
      startedAt: runtime.startedAt,
      target,
      upstreamRequestHeaders: {},
      upstreamRequestBody: Buffer.alloc(0),
      captureRequestContent,
    })
    await attemptLogger.finalizeAttempt({
      status: 'failed',
      httpStatus: null,
      retryable: !runtime.response.headersSent,
      // 连接层面的失败往往连响应头都没拿到，无从判断上游跳是什么形态。
      upstreamTransport: null,
      servesRequest: false,
      errorCode: UPSTREAM_ERROR,
      errorMessage: lastError.message,
      upstreamContent: {
        captureStatus: 'partial',
        responseStatus: null,
        responseHeaders: null,
        responseBody: serializeLocalFailure(lastError),
      },
    })
  } catch (logError) {
    console.error(`[proxy] failed to write the request attempt log: ${(logError as Error).message}`)
  }
}

interface LiveSettlement {
  live: LiveRequestHandle | undefined
  status: 'success' | 'failed' | 'cancelled'
  kind: string
  level: 'info' | 'success' | 'warn' | 'error'
  detail: Record<string, string | number | boolean>
}

function settleLive(settlement: LiveSettlement): void {
  const { live, status, kind, level, detail } = settlement
  live?.settle(status, kind, level, detail)
}

/** 最后一次上游 HTTP 层失败的事实，用于在全候选告罄时给出可归因的失败原因。 */
interface UpstreamFailureSummary {
  statusCode: number
  body: string | null
}

/** 上游错误正文可能是一整页 HTML：摘要只留一小段，长一点就够归因了。 */
const UPSTREAM_FAILURE_BODY_LIMIT = 200

/**
 * 「所有候选都失败」时给客户端的解释。
 *
 * 优先级是「谁知道得更多谁来说」：**请求格式类 4xx 排在异常前面**，因为它才是客户端
 * 能据以自救的那条线索（「你这类请求上游一律不认」）；一条连接异常只能解释这一次
 * 为什么没转发出去，覆盖掉 4xx 反而把根因藏了起来。没有 4xx 时沿用原来的顺序：
 * 异常（连接层、搬运中断）最接近根因，其次才是最后一次上游响应的状态码与正文
 * （401 该换密钥、404 该换模型），把它换掉只等于把「为什么失败」推回给用户。
 */
function describeExhaustion(lastError: Error | null, clientAttributable: UpstreamFailureSummary | null, upstreamFailure: UpstreamFailureSummary | null): string {
  const failure = clientAttributable ?? (lastError === null ? upstreamFailure : null)
  if (failure !== null) {
    const detail = summarizeUpstreamBody(failure.body)
    const head = `All providers failed: the last upstream responded with ${failure.statusCode}`
    return detail === null ? head : `${head} (${detail})`
  }
  if (lastError !== null) return lastError.message
  return 'All providers failed'
}

/** 把上游错误正文压成单行短句；没有可用内容时返回 `null`，让调用方只说状态码。 */
function summarizeUpstreamBody(body: string | null): string | null {
  if (body === null) return null
  const collapsed = body.replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return null
  return collapsed.length > UPSTREAM_FAILURE_BODY_LIMIT ? `${collapsed.slice(0, UPSTREAM_FAILURE_BODY_LIMIT)}…` : collapsed
}
