import type { ExecutionOrigin, UpstreamTarget } from '@server/proxy/contracts'
import type { LiveRequestHandle } from '@server/proxy/observability/live-request-store'
import type { RequestLogger } from '@server/proxy/observability/logging-types'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import type { DeliveredAttemptOutcome, DiscardedAttemptOutcome } from './attempt-outcome'
import { createRequestFinalizerHandlers } from './request-finalizer-handlers'

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
 * 请求级收尾的统一入口。
 *
 * 执行器只按顺序试，试完把结局交给这里；六类结局的具体副作用集中在
 * `request-finalizer-handlers.ts`，每种结局只负责自己的事实。
 */
export interface RequestFinalizer {
  onSuccess(target: UpstreamTarget, outcome: DeliveredAttemptOutcome, attemptIndex: number): Promise<void>
  onTerminal(target: UpstreamTarget, outcome: DeliveredAttemptOutcome, attemptIndex: number): Promise<void>
  onFailover(target: UpstreamTarget, outcome: DiscardedAttemptOutcome, attemptIndex: number): Promise<void>
  onError(target: UpstreamTarget, error: unknown, attemptIndex: number): Promise<boolean>
  onCancelled(target: UpstreamTarget, attemptIndex: number): Promise<void>
  onExhausted(lastError: Error | null): Promise<void>
}

export function createRequestFinalizer(options: RequestFinalizerOptions): RequestFinalizer {
  return createRequestFinalizerHandlers(options)
}

export { failoverAttemptBucket } from './request-finalizer-handlers'
