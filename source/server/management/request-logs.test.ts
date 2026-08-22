import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createProvider } from '../database/provider-store'
import { createRequestAttempt, createRequestContent, createRequestLog } from '../database/request-log-store'
import { requestLogRoutes } from './request-logs'

function mockResponse() {
  return { setHeader: vi.fn(), end: vi.fn() } as unknown as import('node:http').ServerResponse
}

function responseData(res: import('node:http').ServerResponse): unknown {
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

    await requestLogRoutes['/api/request-log/detail']({} as import('node:http').IncomingMessage, res, { id: log.id })

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

    await requestLogRoutes['/api/request-log/detail']({} as import('node:http').IncomingMessage, res, { id: 'req_missing' })

    expect(res.statusCode).toBe(404)
    expect(responseData(res)).toEqual({
      success: false,
      errorCode: 'RESOURCE_NOT_FOUND',
      errorMessage: '请求日志不存�? req_missing',
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

    await requestLogRoutes['/api/request-log/detail']({} as import('node:http').IncomingMessage, res, { id: log.id })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual({
      success: true,
      data: expect.objectContaining({ id: 'diagnostic_detail' }),
    })
  })
})
