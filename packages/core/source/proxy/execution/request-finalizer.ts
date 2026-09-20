import { isOutboundProxyConnectionError } from '@server/infrastructure/network/outbound-connector'
import { markProviderModelSuccess, markProviderSuccess } from '@server/proxy/upstream/health'
import { createAttemptLogger } from '@server/proxy/observability/logging'
import type { RequestLogger } from '@server/proxy/observability/logging-types'
import { RequestRewriteError } from '@server/proxy/request-rewrite/request-rewrite-engine'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import type { HealthFailureScope } from '@server/proxy/response/response'
import { isClientAttributableStatus } from '@server/proxy/response/response'
import type { UpstreamTarget } from '@server/proxy/contracts'
import type { RequestContext } from '@server/proxy/request/request-context'
import { isClientRequestCancelled, LocalAttemptError, RecordedAttemptError, serializeLocalFailure } from './attempt-errors'
import { formatTarget, healthFailureHints, recordHealthFailure, toRequestContentOutcome, type AttemptOutcome } from './attempt-outcome'

export interface RequestFinalizerOptions {
  context: RequestContext
  /** 计划中的全部上游，顺序即优先级；收尾只看「下一个是谁」。 */
  targets: readonly UpstreamTarget[]
  response: ProxyResponse
  requestLogger: RequestLogger
  captureRequestContent: boolean
  startedAt: number
}

/**
 * 请求级收尾。
 *
 * 每种结局只有一件事要做：把「这次请求最后是什么结果」写进日志与健康度。因此这里
 * 集中了全部结局分支——执行器只负责按顺序试、试完把结局交给这里，不再自己决定
 * 什么该落库。副作用固定的顺序也在这里保持不变：先落尝试正文，再落请求状态。
 */
export interface RequestFinalizer {
  onSuccess(target: UpstreamTarget, outcome: AttemptOutcome, attemptIndex: number): Promise<void>
  onTerminal(target: UpstreamTarget, outcome: AttemptOutcome, attemptIndex: number): Promise<void>
  onFailover(target: UpstreamTarget, outcome: AttemptOutcome, attemptIndex: number): Promise<void>
  onError(target: UpstreamTarget, error: unknown, attemptIndex: number): Promise<boolean>
  onCancelled(target: UpstreamTarget, attemptIndex: number): Promise<void>
  onExhausted(lastError: Error | null): Promise<void>
}

export function createRequestFinalizer(options: RequestFinalizerOptions): RequestFinalizer {
  const { context, targets, response, requestLogger, captureRequestContent, startedAt } = options
  const { requestId, logicalModelId, clientProtocol: protocol } = context

  /**
   * 最后一个「上游自己回了非 2xx」的候选。
   *
   * `lastError` 只装**抛异常**的失败（连接错误、搬运中断）；上游明确回 4xx/5xx 走的是
   * failover 分支，不会留下任何一层 `Error`。于是全部候选告罄时客户端只会收到一句
   * 「All providers failed」——上游到底回了什么、是 401 还是 503、是不是「模型不存在」
   * 全丢了，而这些正是客户端唯一能自救的线索。
   */
  let lastUpstreamFailure: UpstreamFailureSummary | null = null

  /**
   * 最后一个「上游明确说这个请求不成立」的候选（见 `isClientAttributableStatus`）。
   *
   * 与 `lastUpstreamFailure` 分开记：前者是「最后一次上游回了什么」，用于解释失败；
   * 它记的是「哪一次上游说了客户端该改请求」，用于决定最终状态码。
   * 混着记会让一个「先 400、再连接错误」的请求丢掉那条唯一能让客户端自救的结论。
   */
  let lastClientAttributableFailure: UpstreamFailureSummary | null = null

  return {
    onSuccess: async (target, outcome, attemptIndex) => {
      if (outcome.disposition === 'success') {
        console.info(
          `[proxy] request forwarded requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} upstreamProtocol=${outcome.upstreamProtocol ?? protocol} attempt=${attemptIndex} attempts=${attemptIndex + 1} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms totalDuration=${Date.now() - startedAt}ms`,
        )
        await markProviderSuccess(target.providerId)
        await markProviderModelSuccess(target.providerModelId)
        await requestLogger.finalizeRequestContent(toRequestContentOutcome(outcome))
        // 用量不在请求级收尾里写：它随着「服务该请求的那次尝试」一起落库。
        await requestLogger.finalizeRequestLog('success', startedAt)
        return
      }
    },

    onTerminal: async (target, outcome, attemptIndex) => {
      console.warn(
        `[proxy] upstream request terminated without retry requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} attempts=${attemptIndex + 1} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms totalDuration=${Date.now() - startedAt}ms`,
      )
      await requestLogger.finalizeRequestContent(toRequestContentOutcome(outcome))
      await requestLogger.finalizeRequestLog('failed', startedAt)
    },

    onFailover: async (target, outcome, attemptIndex) => {
      const nextTarget = targets[attemptIndex + 1]
      const failure: UpstreamFailureSummary = { statusCode: outcome.statusCode, body: outcome.upstreamResponseBody ?? null }
      lastUpstreamFailure = failure
      // 只要出现过一次请求格式类 4xx，客户端的请求就已经被上游判定为「不成立」，
      // 这个结论不会因为后面某家网络不通而失效；若后面又是同类 4xx，覆盖成最近那一条，
      // 因为正文要交给客户端的是最近一次上游原文。
      if (isClientAttributableStatus(failure.statusCode)) lastClientAttributableFailure = failure
      const healthScope = await recordHealthFailure(target, outcome.statusCode, healthFailureHints(outcome))
      console.warn(
        `[proxy] upstream failover scheduled requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms nextProviderModelId=${nextTarget?.providerModelId ?? 'none'} healthFailureScope=${healthScope}`,
      )
    },

    onError: async (target, error, attemptIndex) => {
      // 本地失败外层只负责把「实际发往上游的请求」带出来；判断与分类仍按原始错误做。
      const localFailure = error instanceof LocalAttemptError ? error : null
      const rootError = localFailure ? localFailure.cause : error
      const lastError = error instanceof Error ? error : new Error(String(error))
      if (rootError instanceof RequestRewriteError) {
        console.warn(`[proxy] request rewrite rejected requestId=${requestId} providerModelId=${target.providerModelId} ruleId=${rootError.ruleId ?? 'unknown'} error=${rootError.message}`)
        if (!response.headersSent) {
          const responseBody = response.fail(422, rootError.code, rootError.message)
          // 响应体确实写给了客户端，就必须留证：否则这次失败在记录里只剩一个「failed」
          // 状态，看不出代理回了什么，也就无从判断客户端为什么报错。
          await requestLogger.finalizeLocalErrorContent(422, response.headers(), responseBody)
        }
        await requestLogger.finalizeRequestLog('failed', startedAt)
        return false
      }
      if (isClientRequestCancelled(rootError)) {
        console.debug(`[proxy] client request cancelled requestId=${requestId} attempt=${attemptIndex}`)
        try {
          await createAttemptLogger({
            requestId,
            attemptIndex,
            startedAt,
            target,
            upstreamRequestHeaders: {},
            upstreamRequestBody: Buffer.alloc(0),
            captureRequestContent: false,
            hooks: {},
          }).finalizeAttempt({
            status: 'cancelled',
            httpStatus: null,
            retryable: false,
            // 客户端取消时上游未必已响应，因此不知道上游跳是什么形态。
            upstreamTransport: null,
            // 客户端什么都没收到，因此不承担请求级用量。
            servesRequest: false,
            errorCode: 'CLIENT_REQUEST_ABORTED',
            errorMessage: lastError.message,
          })
        } catch (logError) {
          console.error(`[proxy] failed to write the cancelled attempt log: ${(logError as Error).message}`)
        }
        await requestLogger.finalizeRequestLog('cancelled', startedAt)
        return false
      }
      const nextTarget = targets[attemptIndex + 1]
      console.warn(
        `[proxy] upstream attempt failed requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} failover=${!response.headersSent && nextTarget !== undefined} nextProviderModelId=${nextTarget?.providerModelId ?? 'none'} error=${lastError.message}`,
      )
      try {
        if (!(error instanceof RecordedAttemptError)) {
          // 本地失败用这次尝试自己的日志器：只有它知道真正发往上游的请求头与请求体。
          // 换成空壳会让上游视角看起来像「什么都没发出去」。
          const attemptLogger = localFailure?.attemptLogger ?? createAttemptLogger({
            requestId,
            attemptIndex,
            startedAt,
            target,
            upstreamRequestHeaders: {},
            upstreamRequestBody: Buffer.alloc(0),
            captureRequestContent,
            hooks: {},
          })
          await attemptLogger.finalizeAttempt({
            status: 'failed',
            httpStatus: null,
            retryable: !response.headersSent,
            // 连接层面的失败往往连响应头都没拿到，无从判断上游跳是什么形态。
            upstreamTransport: null,
            servesRequest: false,
            errorCode: 'UPSTREAM_ERROR',
            errorMessage: lastError.message,
            upstreamContent: {
              captureStatus: 'partial',
              responseStatus: null,
              responseHeaders: null,
              responseBody: serializeLocalFailure(lastError),
            },
          })
        }
      } catch (logError) {
        console.error(`[proxy] failed to write the request attempt log: ${(logError as Error).message}`)
      }
      const recordedOutcome = error instanceof RecordedAttemptError ? error.outcome : null
      // 上游明确回了「请求不成立」的状态码、随后正文搬运中断时，这条尝试是作为异常
      // （`RecordedAttemptError`）抛出来的，不会经过 `onFailover`。事实不能因此漏收：
      // 漏掉它，客户端就会在这个永远不可能成功的请求上拿到一个「可重试」的 502。
      if (recordedOutcome !== null && isClientAttributableStatus(recordedOutcome.statusCode)) {
        lastClientAttributableFailure = { statusCode: recordedOutcome.statusCode, body: recordedOutcome.upstreamResponseBody ?? null }
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
        return false
      }
      return true
    },

    onCancelled: async (_target, attemptIndex) => {
      console.debug(`[proxy] request execution cancelled requestId=${requestId} attempt=${attemptIndex} attempts=${attemptIndex + 1} totalDuration=${Date.now() - startedAt}ms`)
      await requestLogger.finalizeRequestLog('cancelled', startedAt)
    },

    onExhausted: async lastError => {
      if (!response.headersSent) {
        const message = describeExhaustion(lastError, lastClientAttributableFailure, lastUpstreamFailure)
        // 状态码保留上游失败的性质，而不是一律折叠成 502：
        // 上游说「这个请求不成立」时回它原本的 4xx，客户端才能据此修正请求而不是无限重试；
        // 失败属于服务端/连接层时才回 `502 ALL_PROVIDERS_FAILED`（本项目的网关语义）。
        // `errorCode` 不变：它说的是代理层的结论（没有任何候选能服务这个请求），
        // 机器可读的「责任归属」由 HTTP 状态码承担。
        const statusCode = lastClientAttributableFailure?.statusCode ?? 502
        console.error(
          `[proxy] all providers failed requestId=${requestId} method=${context.method} path=${context.path} clientProtocol=${protocol} logicalModelId=${logicalModelId} attempts=${targets.length} clientStatus=${statusCode} lastUpstreamStatus=${lastUpstreamFailure?.statusCode ?? 'none'} totalDuration=${Date.now() - startedAt}ms error=${message}`,
        )
        const responseBody = response.fail(statusCode, 'ALL_PROVIDERS_FAILED', message)
        await requestLogger.finalizeLocalErrorContent(statusCode, response.headers(), responseBody)
      }
      await requestLogger.finalizeRequestLog('failed', startedAt)
    },
  }
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
