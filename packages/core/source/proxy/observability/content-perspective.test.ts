import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttemptContent, RequestContent } from '@common/schemas'
import type { AttemptLoggingInput } from './logging-types'

const mocks = vi.hoisted(() => ({
  createRequestLog: vi.fn(async (input: Record<string, unknown>) => ({ id: 'req_test', ...input })),
  createRequestContent: vi.fn(async (input: Record<string, unknown>) => ({ id: 'content_request', ...input })),
  createAttemptContent: vi.fn(async (input: Record<string, unknown>) => ({ id: 'content_attempt', ...input })),
  createRequestAttempt: vi.fn(async (input: Record<string, unknown>) => ({ id: 'att_test', ...input })),
  updateRequestContent: vi.fn(),
  updateAttemptContent: vi.fn(),
  updateRequestLogStatus: vi.fn(),
  updateRequestLogContext: vi.fn(),
  recordAttemptUsage: vi.fn(),
  pruneRequestLogs: vi.fn(),
  pruneRequestContents: vi.fn(),
  getSettings: vi.fn(async () => ({ requestLogRetentionDays: 7, contentRetentionDays: 7 })),
}))

vi.mock('@server/database/request-log-store', () => ({
  createRequestAttempt: mocks.createRequestAttempt,
  createRequestLog: mocks.createRequestLog,
  createRequestContent: mocks.createRequestContent,
  createAttemptContent: mocks.createAttemptContent,
  updateRequestContent: mocks.updateRequestContent,
  updateAttemptContent: mocks.updateAttemptContent,
  recordAttemptUsage: mocks.recordAttemptUsage,
  updateRequestLogStatus: mocks.updateRequestLogStatus,
  updateRequestLogContext: mocks.updateRequestLogContext,
  pruneRequestLogs: mocks.pruneRequestLogs,
  pruneRequestContents: mocks.pruneRequestContents,
}))

vi.mock('@server/database/settings-store', () => ({
  getSettings: mocks.getSettings,
}))

const { createAttemptLogger } = await import('./attempt-log-collector')
const { initializeRequestLogger } = await import('./request-log-collector')

beforeEach(() => {
  vi.clearAllMocks()
})

const CLIENT_REQUEST_ID = 'req_test'

function requestLoggingInput() {
  return {
    requestId: CLIENT_REQUEST_ID,
    logicalModelId: 'default',
    clientProtocol: 'openai-completions' as const,
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'content-type': 'application/json', authorization: 'Bearer client-secret' },
    requestBody: Buffer.from('{"client":"request-body"}'),
    transport: 'http' as const,
    captureRequestLogs: true,
    captureRequestContent: true,
  }
}

function attemptLoggingInput(): AttemptLoggingInput {
  return {
    requestId: CLIENT_REQUEST_ID,
    attemptIndex: 0,
    startedAt: Date.now(),
    target: {
      providerId: 'prov_test',
      providerName: 'prov_test',
      providerModelId: 'model_test',
      providerModelName: 'test-model',
      apiKeyReference: 'api-key-prov_test',
      customAuthHeader: 'authorization',
      endpointId: 'model_test:openai-completions',
      protocol: 'openai-completions',
      url: 'https://example.com/v1/chat/completions',
      timeoutMilliseconds: 30000,
    },
    upstreamRequestHeaders: { 'content-type': 'application/json', authorization: 'Bearer upstream-secret' },
    upstreamRequestBody: Buffer.from('{"upstream":"request-body"}'),
    requestRewriteRuleIds: ['rule_request'],
    customAuthHeader: 'authorization',
    captureRequestContent: true,
  }
}

function lastRequestContentInput(): Record<string, unknown> {
  return mocks.createRequestContent.mock.calls.at(-1)![0] as unknown as Record<string, unknown>
}

describe('内容记录的视角隔离', () => {
  it('关掉请求日志开关时整条链路都不写库', async () => {
    const logger = await initializeRequestLogger({ ...requestLoggingInput(), captureRequestLogs: false })
    await logger.finalizeRequestLog('success', Date.now())
    await logger.finalizeLocalErrorContent(500, {}, '{"error":"local"}')

    expect(logger.requestContentId).toBeNull()
    expect(mocks.createRequestLog).not.toHaveBeenCalled()
    expect(mocks.createRequestContent).not.toHaveBeenCalled()
    expect(mocks.updateRequestLogStatus).not.toHaveBeenCalled()
    expect(mocks.pruneRequestLogs).not.toHaveBeenCalled()
  })

  it('客户端正文只记录客户端请求，且不携带尝试标识', async () => {
    await initializeRequestLogger(requestLoggingInput())

    expect(mocks.createRequestContent).toHaveBeenCalledTimes(1)
    expect(mocks.createAttemptContent).not.toHaveBeenCalled()
    const input = lastRequestContentInput() as Partial<RequestContent>
    expect(input).toEqual(expect.objectContaining({
      requestId: CLIENT_REQUEST_ID,
      requestMethod: 'POST',
      requestPath: '/v1/chat/completions',
      requestBody: '{"client":"request-body"}',
      captureStatus: 'partial',
    }))
    // 客户端视角表不包含 attemptId，字段本身即视角。
    expect(input).not.toHaveProperty('attemptId')
    expect(JSON.parse(String(input.requestHeaders))).toEqual(expect.objectContaining({
      'content-type': 'application/json',
      authorization: '[REDACTED]',
    }))
  })

  it('上游正文只记录发往上游的请求，不重复保存归属与事实', async () => {
    const logger = createAttemptLogger(attemptLoggingInput())
    await logger.finalizeAttempt({
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http-stream',
      servesRequest: true,
      ttftMilliseconds: 88,
      upstreamContent: {
        captureStatus: 'captured',
        responseStatus: 200,
        responseHeaders: { 'content-type': 'application/json', 'x-upstream': '1' },
        responseBody: '{"upstream":"response-body"}',
      },
      responseRewriteRuleIds: ['rule_response'],
    })

    expect(mocks.createAttemptContent).toHaveBeenCalledTimes(1)
    expect(mocks.createRequestContent).not.toHaveBeenCalled()
    const input = mocks.createAttemptContent.mock.calls[0]![0] as unknown as Partial<AttemptContent>
    expect(input).toEqual(expect.objectContaining({
      attemptId: 'att_test',
      requestBody: '{"upstream":"request-body"}',
      responseStatus: 200,
      responseBody: '{"upstream":"response-body"}',
    }))
    // 归属与事实都在 request_attempts 上，上游正文表不重复保存。
    expect(input).not.toHaveProperty('requestId')
    expect(input).not.toHaveProperty('requestRewriteRuleIds')
    expect(input).not.toHaveProperty('responseRewriteRuleIds')
    expect(JSON.parse(String(input.requestHeaders))).toEqual(expect.objectContaining({
      authorization: '[REDACTED]',
    }))
    expect(JSON.parse(String(input.responseHeaders))).toEqual({ 'content-type': 'application/json', 'x-upstream': '1' })
  })

  it('尝试事实总是写入，不随正文采集开关关闭而丢失', async () => {
    const logger = createAttemptLogger({ ...attemptLoggingInput(), captureRequestContent: false })
    await logger.finalizeAttempt({
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http-stream',
      servesRequest: true,
      ttftMilliseconds: 91,
      responseRewriteRuleIds: ['rule_response'],
      upstreamContent: {
        captureStatus: 'captured',
        responseStatus: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: '{"upstream":"response-body"}',
      },
    })

    expect(mocks.createAttemptContent).not.toHaveBeenCalled()
    expect(mocks.createRequestAttempt).toHaveBeenCalledTimes(1)
    expect(mocks.createRequestAttempt.mock.calls[0]![0]).toEqual(expect.objectContaining({
      upstreamTransport: 'http-stream',
      ttftMilliseconds: 91,
      requestRewriteRuleIds: ['rule_request'],
      responseRewriteRuleIds: ['rule_response'],
    }))
  })

  it('未写出客户端响应时不触碰客户端正文', async () => {
    await initializeRequestLogger(requestLoggingInput())
    vi.clearAllMocks()

    // 失败切换的上游尝试：只有上游视角数据，客户端没有收到任何响应。
    const logger = createAttemptLogger(attemptLoggingInput())
    await logger.finalizeAttempt({
      status: 'failed',
      httpStatus: 503,
      retryable: true,
      // 失败切换的尝试没等到上游响应，形态无从判断。
      upstreamTransport: null,
      servesRequest: false,
      errorCode: 'Status_503',
      upstreamContent: {
        captureStatus: 'captured',
        responseStatus: 503,
        responseHeaders: { 'content-type': 'text/plain' },
        responseBody: 'provider unavailable',
      },
    })

    expect(mocks.createAttemptContent).toHaveBeenCalledTimes(1)
    expect(mocks.updateRequestContent).not.toHaveBeenCalled()
  })

  it('本地错误响应的客户端响应头为真实响应头，而不是空对象占位', async () => {
    const logger = await initializeRequestLogger(requestLoggingInput())
    vi.clearAllMocks()

    await logger.finalizeLocalErrorContent(502, { 'content-type': 'application/json' }, '{"success":false}')

    expect(mocks.updateRequestContent).toHaveBeenCalledTimes(1)
    const [contentId, input] = mocks.updateRequestContent.mock.calls[0]! as unknown as [string, Record<string, unknown>]
    expect(contentId).toBe('content_request')
    expect(input).toEqual(expect.objectContaining({
      captureStatus: 'captured',
      responseStatus: 502,
      responseBody: '{"success":false}',
    }))
    expect(JSON.parse(String(input.responseHeaders))).toEqual({ 'content-type': 'application/json' })
  })

  /**
   * 连接被拒、握手失败、请求超时这类本地失败：上游一个字节都没回，因此状态码与
   * 响应头只能是空；但「请求确实发往上游」和「本地观察到的原因」都必须留证，
   * 否则事后只知道这次尝试失败了，不知道失败在连接的哪一步。
   */
  it('本地失败的上游视角记录真实请求与失败原因，状态码与响应头保持为空', async () => {
    const logger = createAttemptLogger(attemptLoggingInput())
    await logger.finalizeAttempt({
      status: 'failed',
      httpStatus: null,
      retryable: true,
      // 上游没有任何响应，因此无从判断它是什么形态。
      upstreamTransport: null,
      servesRequest: false,
      errorCode: 'UPSTREAM_ERROR',
      errorMessage: 'socket hang up',
      upstreamContent: {
        captureStatus: 'partial',
        responseStatus: null,
        responseHeaders: null,
        responseBody: JSON.stringify({ localFailure: true, errorCode: 'UPSTREAM_ERROR', errorMessage: 'socket hang up' }),
      },
    })

    expect(mocks.createRequestAttempt.mock.calls[0]![0]).toEqual(expect.objectContaining({
      status: 'failed',
      httpStatus: null,
      upstreamTransport: null,
      errorCode: 'UPSTREAM_ERROR',
      errorMessage: 'socket hang up',
    }))
    const input = mocks.createAttemptContent.mock.calls[0]![0] as unknown as Partial<AttemptContent>
    expect(input).toEqual(expect.objectContaining({
      attemptId: 'att_test',
      captureStatus: 'partial',
      responseStatus: null,
      responseHeaders: null,
      requestBody: '{"upstream":"request-body"}',
    }))
    // 出站请求头带着鉴权头，落库前必须脱敏。
    expect(JSON.parse(String(input.requestHeaders))).toEqual(expect.objectContaining({ authorization: '[REDACTED]' }))
    // 正文里带 `localFailure` 标记，用来区分「本地失败原因」与「上游返回的报文」。
    expect(JSON.parse(String(input.responseBody))).toEqual({
      localFailure: true,
      errorCode: 'UPSTREAM_ERROR',
      errorMessage: 'socket hang up',
    })
  })
})
