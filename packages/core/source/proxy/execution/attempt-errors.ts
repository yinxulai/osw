import { CLIENT_REQUEST_ABORTED, CLIENT_REQUEST_ABORTED_MESSAGE, UPSTREAM_ERROR } from '@common/error-codes'
import type { AttemptLogger } from '@server/proxy/observability/logging-types'
import type { AttemptOutcome } from './attempt-outcome'

/** 客户端自己走了：这次尝试的失败不是上游的问题，也不该触发 failover。 */
export class ClientRequestCancelledError extends Error {
  readonly code = CLIENT_REQUEST_ABORTED

  constructor() {
    super('The client cancelled the request')
    this.name = 'ClientRequestCancelledError'
  }
}

/** 已经记好日志的失败：外层不必再补写一次尝试记录。 */
export class RecordedAttemptError extends Error {
  readonly outcome: AttemptOutcome

  constructor(cause: Error, outcome: AttemptOutcome) {
    super(cause.message)
    this.name = 'RecordedAttemptError'
    this.cause = cause
    this.outcome = outcome
  }
}

/**
 * 本地错误：连接被拒、握手失败、请求超时、出站代理不可用。
 *
 * 上游一个字节都没回，因此没有任何「上游返回的内容」可记；但「这次尝试确实把请求
 * 发了出去」是事实，而真正发往上游的请求头与请求体只存在于这次尝试的日志器里。
 * 因此把日志器随错误一起交出去，让外层能用它补写上游视角，而不是写一个空壳。
 */
export class LocalAttemptError extends Error {
  readonly cause: Error
  readonly attemptLogger: AttemptLogger

  constructor(cause: Error, attemptLogger: AttemptLogger) {
    super(cause.message)
    this.name = 'LocalAttemptError'
    this.cause = cause
    this.attemptLogger = attemptLogger
  }
}

/**
 * 本地失败的「上游视角响应」正文。
 *
 * 上游没有返回任何响应，所以状态码与响应头只能是 `null`；而排查这次失败最需要的
 * 恰恰是原因，因此把本地观察到的原因写进响应侧，并用 `localFailure` 标记它不是上游内容。
 */
export function serializeLocalFailure(error: Error): string {
  return JSON.stringify({ localFailure: true, errorCode: UPSTREAM_ERROR, errorMessage: error.message })
}

export function isClientRequestCancelled(error: unknown): boolean {
  return error instanceof ClientRequestCancelledError || (
    error instanceof Error && error.message === CLIENT_REQUEST_ABORTED_MESSAGE
  )
}
