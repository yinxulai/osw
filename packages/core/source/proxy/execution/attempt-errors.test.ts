import { describe, expect, it } from 'vitest'
import { CLIENT_REQUEST_ABORTED, CLIENT_REQUEST_ABORTED_MESSAGE, UPSTREAM_ERROR } from '@common/error-codes'
import {
  ClientRequestCancelledError,
  LocalAttemptError,
  RecordedAttemptError,
  isClientRequestCancelled,
  serializeLocalFailure,
} from './attempt-errors'
import type { AttemptOutcome } from './attempt-outcome'
import type { AttemptLogger } from '@server/proxy/observability/logging-types'

/*
 * 执行层的三种失败类型。
 *
 * 它们存在的理由是「这次失败该由谁负责、该不该重试」：
 *  - 客户端自己走了 → 不记故障、不 failover；
 *  - 本地错误（连接被拒/超时）→ 上游一个字节都没回，但请求确实发出去了，日志器要跟着走；
 *  - 已经记好日志的失败 → 外层别再补写一次。
 */

function outcome(): AttemptOutcome {
  // 这个测试只关心「结果对象被原样带出来」，不关心它内部字段的语义，
  // 因此用最薄的一层替身而不是拼一个完整 outcome。
  return { status: 'failed' } as unknown as AttemptOutcome
}

const logger = { finalizeAttempt: async () => {} } as unknown as AttemptLogger

describe('ClientRequestCancelledError', () => {
  it('带 CLIENT_REQUEST_ABORTED 错误码与固定文案', () => {
    const error = new ClientRequestCancelledError()

    expect(error.code).toBe(CLIENT_REQUEST_ABORTED)
    expect(error.name).toBe('ClientRequestCancelledError')
    expect(error.message).toBe('The client cancelled the request')
    expect(error).toBeInstanceOf(Error)
  })
})

describe('RecordedAttemptError', () => {
  it('保留原因与已记录的结果，用原因的消息作为自己的消息', () => {
    const cause = new Error('upstream returned 502')
    const error = new RecordedAttemptError(cause, outcome())

    expect(error.name).toBe('RecordedAttemptError')
    expect(error.message).toBe('upstream returned 502')
    expect(error.cause).toBe(cause)
    expect(error.outcome).toEqual(outcome())
  })
})

describe('LocalAttemptError', () => {
  it('带着尝试日志器一起抛出（上游视角的请求体只存在于那里）', () => {
    const cause = new Error('connect ECONNREFUSED')
    const error = new LocalAttemptError(cause, logger)

    expect(error.name).toBe('LocalAttemptError')
    expect(error.message).toBe('connect ECONNREFUSED')
    expect(error.cause).toBe(cause)
    expect(error.attemptLogger).toBe(logger)
  })
})

describe('serializeLocalFailure', () => {
  it('写成一个标记了 localFailure 的 JSON 正文，错误码固定 UPSTREAM_ERROR', () => {
    const payload = JSON.parse(serializeLocalFailure(new Error('connect ECONNREFUSED 127.0.0.1:443')))

    expect(payload).toEqual({
      localFailure: true,
      errorCode: UPSTREAM_ERROR,
      errorMessage: 'connect ECONNREFUSED 127.0.0.1:443',
    })
  })
})

describe('isClientRequestCancelled', () => {
  it('取消类错误本身算取消', () => {
    expect(isClientRequestCancelled(new ClientRequestCancelledError())).toBe(true)
  })

  it('消息等于哨兵文本的普通 Error 也算取消', () => {
    // 上游 `destroy(error)` 只能回传一条 Error，跨层时结构信息没了，只能认文本哨兵。
    expect(isClientRequestCancelled(new Error(CLIENT_REQUEST_ABORTED_MESSAGE))).toBe(true)
  })

  it('其它 Error 不算取消', () => {
    expect(isClientRequestCancelled(new Error('connect ECONNREFUSED'))).toBe(false)
    expect(isClientRequestCancelled(new Error('upstream returned 502'))).toBe(false)
  })

  it('非 Error 一律不算取消', () => {
    for (const value of [null, undefined, 'CLIENT_REQUEST_ABORTED', {}, 0] as unknown[]) {
      expect(isClientRequestCancelled(value)).toBe(false)
    }
  })

  it('哨兵文本与错误码同值同源（改名时只需改一处）', () => {
    expect(CLIENT_REQUEST_ABORTED_MESSAGE).toBe(CLIENT_REQUEST_ABORTED)
  })
})
