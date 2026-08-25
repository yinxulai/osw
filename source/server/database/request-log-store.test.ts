import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from './index'
import { createProvider } from './provider-store'
import {
  countRequestLogs,
  createRequestAttempt,
  createRequestContent,
  createRequestConversion,
  createRequestLog,
  getRequestLog,
  listRequestContents,
  listRequestConversions,
  listRequestLogs,
  listAttemptsByRequest,
  pruneRequestLogsBefore,
  updateRequestContent,
  updateRequestLogStatus,
} from './request-log-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-request-log-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function createLog(id: string, status: 'pending' | 'success' | 'failed' = 'success') {
  return createRequestLog({
    id,
    logicalModelId: 'model_default',
    clientProtocol: 'openai-completions',
    upstreamProtocol: 'openai-completions',
    status,
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
}

describe('request log store persistence', () => {
  it('filters, counts, paginates, and maps request logs from stored rows', async () => {
    const first = await createLog('req_first', 'success')
    const second = await createLog('req_second', 'failed')
    getDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(100, first.id)
    getDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(200, second.id)

    expect(await countRequestLogs({ status: 'failed', createdTimeFrom: 150, createdTimeTo: 250 })).toBe(1)
    expect(await listRequestLogs(1, 0, { logicalModelId: 'model_default' })).toEqual([
      expect.objectContaining({ id: second.id, status: 'failed', totalDurationMilliseconds: 10 }),
    ])
    expect(await listRequestLogs(1, 1)).toEqual([expect.objectContaining({ id: first.id })])
  })

  it('round-trips content, attempts, and conversions and updates content fields', async () => {
    const log = await createLog('req_related')
    const provider = await createProvider({ name: 'Related Provider', apiKeyReference: 'related-key', timeoutMilliseconds: 1000 })
    const attempt = await createRequestAttempt({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_related',
      providerName: provider.name,
      providerModelName: 'related-model',
      upstreamProtocol: 'openai-completions',
      upstreamRequestId: 'upstream-1',
      url: 'https://example.com/v1/chat/completions',
      attemptIndex: 0,
      status: 'success',
      httpStatus: 200,
      retryable: false,
      durationMilliseconds: 8,
    })
    const content = await createRequestContent({
      requestId: log.id,
      attemptId: attempt.id,
      captureStatus: 'partial',
      requestMethod: 'POST',
      requestPath: '/v1/chat/completions',
      requestHeaders: '{"x-test":"1"}',
      requestBody: '{}',
      responseStatus: null,
      responseHeaders: null,
      responseBody: null,
      requestRewriteRuleIds: ['rule_a', 'rule_b'],
    })
    await updateRequestContent(content.id, { captureStatus: 'captured', responseStatus: 200, responseBody: '{"ok":true}' })
    const conversion = await createRequestConversion({
      requestId: log.id,
      attemptId: attempt.id,
      clientProtocol: 'openai-completions',
      upstreamProtocol: 'openai-completions',
      clientRequestHeaders: null,
      upstreamRequestHeaders: '{}',
      upstreamResponseHeaders: '{}',
      clientResponseHeaders: null,
      requestBody: '{}',
      responseBody: '{}',
      streaming: true,
      durationMilliseconds: 4,
    })

    expect(await listAttemptsByRequest(log.id)).toEqual([expect.objectContaining({ id: attempt.id, httpStatus: 200 })])
    expect(await listRequestContents(log.id)).toEqual([expect.objectContaining({
      id: content.id,
      captureStatus: 'captured',
      responseStatus: 200,
      responseBody: '{"ok":true}',
      requestRewriteRuleIds: ['rule_a', 'rule_b'],
    })])
    expect(await listRequestConversions(log.id)).toEqual([expect.objectContaining({ id: conversion.id, streaming: true })])
  })

  it('clears nullable log fields and prunes all related rows', async () => {
    const log = await createLog('req_prunable', 'pending')
    await updateRequestLogStatus(log.id, {
      status: 'success',
      totalDurationMilliseconds: 20,
      inputTokens: 2,
      outputTokens: 1,
      rawUsage: { input_tokens: 2 },
      ttftMilliseconds: 3,
      promptCacheHit: true,
    })
    await updateRequestLogStatus(log.id, {
      totalDurationMilliseconds: 0,
      inputTokens: null,
      rawUsage: null,
      ttftMilliseconds: null,
      promptCacheHit: null,
    })
    expect(await getRequestLog(log.id)).toMatchObject({
      totalDurationMilliseconds: 0,
      inputTokens: null,
      rawUsage: null,
      ttftMilliseconds: null,
      promptCacheHit: null,
      outputTokens: 1,
    })

    await createRequestContent({
      requestId: log.id,
      attemptId: null,
      captureStatus: 'captured',
      requestMethod: 'GET',
      requestPath: '/',
      requestHeaders: null,
      requestBody: null,
      responseStatus: 200,
      responseHeaders: null,
      responseBody: null,
      requestRewriteRuleIds: [],
    })
    getDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(Date.now() - 3 * 24 * 60 * 60 * 1000, log.id)

    expect(await pruneRequestLogsBefore(1)).toBe(1)
    expect(await getRequestLog(log.id)).toBeNull()
    expect(await getDb().$client.prepare('SELECT COUNT(*) AS count FROM request_contents WHERE requestId = ?').get(log.id)).toEqual({ count: 0 })
  })
})
