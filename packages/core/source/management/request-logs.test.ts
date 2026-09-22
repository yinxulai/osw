import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '../database'
import { createProvider } from '@server/database/provider-store'
import { createAttemptContent, createRequestAttempt, createRequestContent, createRequestLog } from '@server/database/request-log-store'
import { createRequestRewriteRule, deleteRequestRewriteRule } from '@server/database/request-rewrite-rule-store'
import { liveRequestStore } from '@server/proxy/observability/live-request-store'
import { requestLogRoutes } from './routes/observability/request-logs'
import { mockResponse } from './test-support'

function responseData(res: ServerResponse): unknown {
  const body = vi.mocked(res.end).mock.calls[0]?.[0]
  return JSON.parse(String(body))
}

/** 同一请求的同一次序号只能落一行，冲突时 store 返回 `null`。 */
async function createAttemptOrThrow(input: Parameters<typeof createRequestAttempt>[0]) {
  const attempt = await createRequestAttempt(input)
  if (!attempt) throw new Error('expected attempt to be created')
  return attempt
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-request-log-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('request log management', () => {
  it('filters request logs by provider model id', async () => {
    const provider = await createProvider({ name: 'Provider', apiKeyReference: 'key_filter', timeoutMilliseconds: 30_000, enabled: true })
    const matched = await createRequestLog({
      id: 'req_model_match',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 10,
    })
    const other = await createRequestLog({
      id: 'req_model_other',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 10,
    })

    await createAttemptOrThrow({
      requestId: matched.id,
      providerId: provider.id,
      providerModelId: 'model_match',
      providerName: provider.name,
      providerModelName: 'match-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/match',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 10,
    })
    await createAttemptOrThrow({
      requestId: other.id,
      providerId: provider.id,
      providerModelId: 'model_other',
      providerName: provider.name,
      providerModelName: 'other-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/other',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 10,
    })

    const res = mockResponse()
    await requestLogRoutes.invoke('/api/request-log/list', res, { providerModelId: 'model_match' })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        total: 1,
        logs: [expect.objectContaining({ id: matched.id })],
      }),
    }))
  })

  it('returns one log with attempts and request contents on demand', async () => {
    const provider = await createProvider({ name: 'Provider', apiKeyReference: 'key_detail', timeoutMilliseconds: 30_000, enabled: true })
    const log = await createRequestLog({
      id: 'req_detail',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http-stream',
      status: 'success',
      totalDurationMilliseconds: 10,
    })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_detail',
      providerName: provider.name,
      providerModelName: 'detail-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http-stream',
      ttftMilliseconds: 42,
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 10,
    })
    const rule = await createRequestRewriteRule({
      name: '请求日志规则名称',
      description: '',
      enabled: true,
      scope: 'global',
      schemaVersion: 1,
      source: 'user',
      match: { clientProtocols: [], upstreamProtocols: [] },
      actions: [{ type: 'header-set', stage: 'request', name: 'x-test', value: 'true' }],
      testCases: [],
    })
    // 规则命中是尝试自身的事实，与是否采集正文无关，因此写在 request_attempts 上。
    await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_detail_second',
      providerName: provider.name,
      providerModelName: 'detail-model-second',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 1,
      status: 'success',
      durationMilliseconds: 6,
      requestRewriteRuleIds: [rule.id, 'rule_missing'],
      responseRewriteRuleIds: ['rule_response'],
    })
    await createRequestContent({
      requestId: log.id,
      captureStatus: 'captured',
      requestMethod: 'POST',
      requestPath: '/v1/responses',
      requestHeaders: '{"authorization":"[REDACTED]"}',
      requestBody: '{"model":"detail-model"}',
      responseStatus: 200,
      responseHeaders: '{"content-type":"application/json","x-client":"1"}',
      responseBody: '{"ok":true}',
    })
    await createAttemptContent({
      attemptId: attempt.id,
      captureStatus: 'captured',
      requestHeaders: '{"x-upstream":"1"}',
      requestBody: '{"model":"detail-model"}',
      responseStatus: 200,
      responseHeaders: '{"content-type":"application/json"}',
      responseBody: '{"ok":true}',
    })
    await deleteRequestRewriteRule(rule.id)
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/detail', res, { id: log.id })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual({
      success: true,
      data: expect.objectContaining({
        id: log.id,
        attempts: [
          expect.objectContaining({ id: attempt.id, providerModelName: 'detail-model', upstreamTransport: 'http-stream', ttftMilliseconds: 42 }),
          expect.objectContaining({ upstreamTransport: 'http', requestRewriteRuleIds: [rule.id, 'rule_missing'], responseRewriteRuleIds: ['rule_response'] }),
        ],
        contents: [expect.objectContaining({ captureStatus: 'captured', responseHeaders: '{"content-type":"application/json","x-client":"1"}' })],
        attemptContents: [expect.objectContaining({ attemptId: attempt.id, responseStatus: 200 })],
        requestRewriteRules: [{ id: rule.id, name: '请求日志规则名称' }],
      }),
    })
    // 详情只带摘要：正文是库里最大的列，而详情在请求还挂着时会被界面反复重取，
    // 因此列清单在这里钉死——多回一列正文就等于把轮询的代价又加回去。
    const detail = (responseData(res) as { data: { contents: Record<string, unknown>[]; attemptContents: Record<string, unknown>[] } }).data
    expect(Object.keys(detail.contents[0]).sort()).toEqual([
      'captureStatus', 'createdTime', 'id', 'requestHeaders', 'requestId', 'requestMethod', 'requestPath', 'responseHeaders', 'responseStatus', 'updatedTime',
    ])
    expect(Object.keys(detail.attemptContents[0]).sort()).toEqual([
      'attemptId', 'captureStatus', 'createdTime', 'id', 'requestHeaders', 'responseHeaders', 'responseStatus', 'updatedTime',
    ])
  })

  it('returns the captured bodies on demand', async () => {
    const log = await createRequestLog({
      id: 'req_bodies',
      logicalModelId: 'detail-model',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 10,
    })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: 'prov_bodies',
      providerName: 'Provider Bodies',
      providerModelId: 'model_bodies',
      providerModelName: 'model-bodies',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 6,
    })
    await createRequestContent({
      requestId: log.id,
      captureStatus: 'captured',
      requestMethod: 'POST',
      requestPath: '/v1/responses',
      requestHeaders: '{"authorization":"[REDACTED]"}',
      requestBody: '{"model":"detail-model"}',
      responseStatus: 200,
      responseHeaders: '{"content-type":"application/json"}',
      responseBody: '{"ok":true}',
    })
    await createAttemptContent({
      attemptId: attempt.id,
      captureStatus: 'captured',
      requestHeaders: '{"x-upstream":"1"}',
      requestBody: '{"model":"detail-model"}',
      responseStatus: 200,
      responseHeaders: '{"content-type":"application/json"}',
      responseBody: '{"ok":true}',
    })
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/bodies', res, { id: log.id })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual({
      success: true,
      data: {
        contents: [expect.objectContaining({ requestBody: '{"model":"detail-model"}', responseBody: '{"ok":true}' })],
        attemptContents: [expect.objectContaining({ attemptId: attempt.id, requestBody: '{"model":"detail-model"}', responseBody: '{"ok":true}' })],
      },
    })
  })

  it('returns empty bodies for a request whose contents were pruned', async () => {
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/bodies', res, { id: 'req_missing' })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual({ success: true, data: { contents: [], attemptContents: [] } })
  })

  it('returns not found for a missing request log', async () => {
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/detail', res, { id: 'req_missing' })

    expect(res.statusCode).toBe(404)
    expect(responseData(res)).toEqual({
      success: false,
      errorCode: 'RESOURCE_NOT_FOUND',
      errorMessage: 'Request log not found: req_missing',
      errorParams: { requestId: 'req_missing' },
    })
  })

  it('returns details for a diagnostic request log id', async () => {
    const log = await createRequestLog({
      id: 'diagnostic_detail',
      logicalModelId: 'diagnostic',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'failed',
      totalDurationMilliseconds: 10,
    })
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/detail', res, { id: log.id })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual({
      success: true,
      data: expect.objectContaining({ id: 'diagnostic_detail' }),
    })
  })
})

describe('live request management', () => {
  afterEach(() => {
    liveRequestStore.clear()
  })

  it('lists in-flight requests without touching the database', async () => {
    const handle = liveRequestStore.begin({ id: 'req_live', method: 'POST', path: '/v1/messages', transport: 'http', clientProtocol: null })
    handle.resolveRoute({ logicalModelId: 'default', clientProtocol: 'anthropic-messages', transport: 'http-stream', candidates: [] })
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/live', res, {})

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual({
      success: true,
      data: {
        requests: [expect.objectContaining({
          id: 'req_live',
          status: 'pending',
          logicalModelId: 'default',
          clientProtocol: 'anthropic-messages',
          transport: 'http-stream',
        })],
      },
    })
  })

  it('drops a request once it settles', async () => {
    const handle = liveRequestStore.begin({ id: 'req_live', method: 'POST', path: '/v1/messages', transport: 'http', clientProtocol: null })
    handle.settle('failed', 'request.failed', 'error', { httpStatus: 502 })
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/live', res, {})

    // 落定的请求仍在保留区里（界面靠它把「进行中」原地变成「已结束」），但状态已经变了。
    expect(responseData(res)).toEqual({
      success: true,
      data: {
        requests: [expect.objectContaining({ id: 'req_live', status: 'failed', phase: 'settled' })],
      },
    })
  })

  it('pushes the live ledger as NDJSON until the client hangs up', async () => {
    const written: string[] = []
    const closeListeners: (() => void)[] = []
    const res = mockResponse({
      write: (payload: string) => {
        written.push(payload)
        return true
      },
      once: (event: string, listener: () => void) => {
        if (event === 'close') closeListeners.push(listener)
      },
      // 推送通道会给响应挂一个 `drain` 监听，真实响应是个 EventEmitter。
      on: () => undefined,
      off: () => undefined,
    } as unknown as Partial<ServerResponse>)
    liveRequestStore.begin({ id: 'req_live', method: 'POST', path: '/v1/messages', transport: 'http', clientProtocol: null })

    const streaming = requestLogRoutes.invoke('/api/request-log/live/stream', res, {})

    expect(res.statusCode).toBe(200)
    // 禁掉缓存与任何改写型中间层：这份数据只在「此刻」有意义。
    expect(vi.mocked(res.setHeader)).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson; charset=utf-8')
    expect(vi.mocked(res.setHeader)).toHaveBeenCalledWith('Cache-Control', 'no-store, no-transform')
    // 连上就先给一帧，和拉取式端点吐的是同一种快照。
    expect(written).toHaveLength(1)
    const frame = JSON.parse(written[0] ?? '{}') as { requests: { id: string }[] }
    expect(frame.requests.map(request => request.id)).toEqual(['req_live'])

    // 连接没断，处理函数就不该返回：否则访问日志会把一条长连接记成一次瞬时请求。
    let returned = false
    void streaming.then(() => { returned = true })
    await Promise.resolve()
    expect(returned).toBe(false)

    closeListeners[0]?.()
    await streaming
    expect(returned).toBe(true)
  })
})
