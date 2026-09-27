import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, getDataDb, initDatabases } from './index'
import { createProvider } from './provider-store'
import { getFailureReasons, getStatsSummary } from './analytics-store'
import {
  createRequestAttempt,
  createRequestLog,
  getAttemptUsage,
  getRequestLog,
  getRequestUsage,
  recordAttemptUsage,
  updateRequestLogStatus,
} from './request-log-store'

/** 同一请求的同一次序号只能落一行，冲突时 store 返回 `null`。 */
async function createAttemptOrThrow(input: Parameters<typeof createRequestAttempt>[0]) {
  const attempt = await createRequestAttempt(input)
  if (!attempt) throw new Error('expected attempt to be created')
  return attempt
}

/** 用量字段的「都不知道」形状，用于只关心部分字段的用例。 */
const EMPTY_USAGE = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null }

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-store-boundaries-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('request log persistence boundaries', () => {
  it('creates a request log with identity and outcome facts only', async () => {
    const log = await createRequestLog({
      id: 'req_initial_metrics',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-responses',
      transport: 'http-stream',
      status: 'success',
      totalDurationMilliseconds: 120,
    })

    // 用量、TTFT、缓存命中都不是建行时能知道的事实：它们由尝试决定。
    expect(await getRequestLog(log.id)).toEqual({
      id: log.id,
      logicalModelId: 'model_default',
      clientProtocol: 'openai-responses',
      transport: 'http-stream',
      status: 'success',
      totalDurationMilliseconds: 120,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      rawUsage: null,
      ttftMilliseconds: null,
      createdTime: log.createdTime,
    })
  })

  it('writes request usage only through the attempt that serves the request', async () => {
    const log = await createRequestLog({
      id: 'req_usage_boundaries',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-completions',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 1,
    })
    const provider = await createProvider({ name: 'Usage Provider', apiKeyReference: 'usage-key', timeoutMilliseconds: 1000 })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_usage',
      providerName: provider.name,
      providerModelName: 'usage-model',
      upstreamProtocol: 'openai-completions',
      upstreamRequestId: null,
      url: 'https://example.com/v1/chat/completions',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 1,
    })

    // 被放弃的尝试：用量只落在尝试级，请求级不动。
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: false, ...EMPTY_USAGE, inputTokens: 4, outputTokens: 1 })
    expect(await getAttemptUsage(attempt.id)).toEqual({ ...EMPTY_USAGE, inputTokens: 4, outputTokens: 1, totalTokens: 5 })
    expect(await getRequestUsage(log.id)).toEqual({ ...EMPTY_USAGE, totalTokens: null })

    // 服务该请求的尝试：同一事务里把同一组数值镜像到请求级。
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 10, outputTokens: 2 })
    expect(await getRequestUsage(log.id)).toEqual({ ...EMPTY_USAGE, inputTokens: 10, outputTokens: 2, totalTokens: 12 })
    expect(await getAttemptUsage(attempt.id)).toEqual({ ...EMPTY_USAGE, inputTokens: 10, outputTokens: 2, totalTokens: 12 })
  })

  it('keeps request usage intact when updating only the request outcome', async () => {
    const log = await createRequestLog({
      id: 'req_usage_status_update',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'pending',
      totalDurationMilliseconds: 0,
    })
    const provider = await createProvider({ name: 'Status Provider', apiKeyReference: 'status-key', timeoutMilliseconds: 1000 })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_status',
      providerName: provider.name,
      providerModelName: 'status-model',
      upstreamProtocol: 'openai-completions',
      upstreamRequestId: null,
      url: 'https://example.com/v1/chat/completions',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 25,
    })

    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 12, outputTokens: 4, rawUsage: { input_tokens: 12, output_tokens: 4 } })
    await updateRequestLogStatus(log.id, { status: 'success', totalDurationMilliseconds: 25 })

    // 原始 usage 报文与其他用量同行存放，取用时仍是一份完整报文。
    expect(await getRequestLog(log.id)).toMatchObject({
      status: 'success',
      totalDurationMilliseconds: 25,
      rawUsage: { input_tokens: 12, output_tokens: 4 },
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
    })
  })
})

describe('analytics boundaries', () => {
  it('uses the time boundary and final attempt when classifying failures', async () => {
    const provider = await createProvider({ name: 'Analytics Provider', apiKeyReference: 'analytics-key', timeoutMilliseconds: 1000 })
    const inWindow = await createRequestLog({
      id: 'req_in_window',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-completions',
      transport: 'http',
      status: 'failed',
      totalDurationMilliseconds: 20,
    })
    const outsideWindow = await createRequestLog({
      id: 'req_outside_window',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-completions',
      transport: 'http',
      status: 'failed',
      totalDurationMilliseconds: 20,
    })
    const oldTime = Date.now() - 10_000
    const outsideRow = await getRequestLog(outsideWindow.id)
    expect(outsideRow).toBeTruthy()
    const database = getDataDb()
    database.$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(oldTime, outsideWindow.id)

    await createRequestAttempt({ requestId: inWindow.id, providerId: provider.id, providerModelId: 'model_a', providerName: provider.name, providerModelName: 'model-a', upstreamProtocol: 'openai-completions', upstreamRequestId: null, url: 'https://example.com/a', httpStatus: 503, retryable: true, upstreamTransport: 'http', attemptIndex: 0, status: 'failed', errorCode: 'Status_503', durationMilliseconds: 5 })
    await createRequestAttempt({ requestId: inWindow.id, providerId: provider.id, providerModelId: 'model_b', providerName: provider.name, providerModelName: 'model-b', upstreamProtocol: 'openai-completions', upstreamRequestId: null, url: 'https://example.com/b', httpStatus: 401, retryable: false, upstreamTransport: 'http', attemptIndex: 1, status: 'failed', errorCode: 'AUTH_401', durationMilliseconds: 15 })
    await createRequestAttempt({ requestId: outsideWindow.id, providerId: provider.id, providerModelId: 'model_old', providerName: provider.name, providerModelName: 'model-old', upstreamProtocol: 'openai-completions', upstreamRequestId: null, url: 'https://example.com/old', httpStatus: 504, retryable: true, upstreamTransport: 'http', attemptIndex: 0, status: 'failed', errorCode: 'TIMEOUT', durationMilliseconds: 20 })

    const since = (await getRequestLog(inWindow.id))!.createdTime
    expect(await getStatsSummary(since)).toMatchObject({ totalRequests: 1, failedCount: 1 })
    expect(await getFailureReasons(since)).toEqual([{ reason: 'AUTH_FAILED', count: 1 }])
  })
})
