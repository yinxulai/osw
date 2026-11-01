import { describe, expect, it } from 'vitest'
import type { AttemptContent, RequestLogEntryAttempt } from '@common/schemas'
import { upstreamCommandInput } from './request-commands'

function attemptContentOf(overrides: Partial<AttemptContent> = {}): AttemptContent {
  return {
    id: 'attempt_content_1',
    attemptId: 'att_1',
    captureStatus: 'captured',
    requestHeaders: '{"content-type":"application/json"}',
    requestBody: '{"model":"upstream"}',
    responseStatus: 200,
    responseHeaders: '{}',
    responseBody: 'ok',
    createdTime: 0,
    updatedTime: 0,
    ...overrides,
  }
}

function attemptOf(overrides: Partial<RequestLogEntryAttempt> = {}): RequestLogEntryAttempt {
  return {
    id: 'att_1',
    attemptIndex: 0,
    status: 'success',
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://api.example.com/v1/responses',
    httpStatus: 200,
    retryable: false,
    upstreamTransport: 'http-stream',
    ttftMilliseconds: 12,
    requestRewriteRuleIds: [],
    responseRewriteRuleIds: [],
    errorCode: null,
    errorMessage: null,
    durationMilliseconds: 100,
    createdTime: 0,
    ...overrides,
  }
}

describe('upstreamCommandInput', () => {
  it('用尝试自己的绝对地址，不拼代理地址', () => {
    expect(upstreamCommandInput(attemptOf(), attemptContentOf(), 'post')).toEqual({
      url: 'https://api.example.com/v1/responses',
      method: 'POST',
      headers: '{"content-type":"application/json"}',
      body: '{"model":"upstream"}',
    })
  })

  it('没发出去过（没有尝试）时不成立', () => {
    expect(upstreamCommandInput(null, attemptContentOf(), 'POST')).toBeNull()
  })

  it('上游正文缺失时不成立', () => {
    expect(upstreamCommandInput(attemptOf(), null, 'POST')).toBeNull()
  })

  it('地址没记下来时不成立，不拼出一条 URL 是空串的命令', () => {
    expect(upstreamCommandInput(attemptOf({ url: '' }), attemptContentOf(), 'POST')).toBeNull()
  })

  it('客户端方法也缺失时退回落 POST', () => {
    expect(upstreamCommandInput(attemptOf(), attemptContentOf(), null)?.method).toBe('POST')
  })
})
