import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createProvider } from '@server/database/provider-store'
import { createRequestAttempt, createRequestContent, createRequestLog } from '@server/database/request-log-store'
import { requestLogRoutes } from './routes/observability/request-logs'

function mockResponse() {
  return { setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse
}

function responseData(res: ServerResponse): unknown {
  const body = vi.mocked(res.end).mock.calls[0]?.[0]
  return JSON.parse(String(body))
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-request-log-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('request log management', () => {
  it('filters request logs by provider model id', async () => {
    const provider = await createProvider({ name: 'Provider', apiKeyReference: 'key_filter', timeoutMilliseconds: 30_000, enabled: true })
    const matched = await createRequestLog({
      id: 'req_model_match',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      upstreamProtocol: null,
      status: 'success',
      totalDurationMilliseconds: 10,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
    })
    const other = await createRequestLog({
      id: 'req_model_other',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      upstreamProtocol: null,
      status: 'success',
      totalDurationMilliseconds: 10,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
    })

    await createRequestAttempt({
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
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 10,
    })
    await createRequestAttempt({
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
      upstreamProtocol: null,
      status: 'success',
      totalDurationMilliseconds: 10,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
    })
    const attempt = await createRequestAttempt({
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
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 10,
    })
    await createRequestContent({
      requestId: log.id,
      attemptId: attempt.id,
      captureStatus: 'captured',
      requestMethod: 'POST',
      requestPath: '/v1/responses',
      requestHeaders: '{"authorization":"[REDACTED]"}',
      requestBody: '{"model":"detail-model"}',
      responseStatus: 200,
      responseHeaders: '{"content-type":"application/json"}',
      responseBody: '{"ok":true}',
    })
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/detail', res, { id: log.id })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual({
      success: true,
      data: expect.objectContaining({
        id: log.id,
        attempts: [expect.objectContaining({ providerModelName: 'detail-model' })],
        contents: [expect.objectContaining({ attemptId: attempt.id, responseBody: '{"ok":true}' })],
      }),
    })
  })

  it('returns not found for a missing request log', async () => {
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/detail', res, { id: 'req_missing' })

    expect(res.statusCode).toBe(404)
    expect(responseData(res)).toEqual({
      success: false,
      errorCode: 'RESOURCE_NOT_FOUND',
      errorMessage: '请求日志不存在 req_missing',
    })
  })

  it('returns details for a diagnostic request log id', async () => {
    const log = await createRequestLog({
      id: 'diagnostic_detail',
      logicalModelId: 'diagnostic',
      clientProtocol: 'openai-responses',
      upstreamProtocol: null,
      status: 'failed',
      totalDurationMilliseconds: 10,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
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
