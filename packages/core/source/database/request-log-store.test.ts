import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, getDataDb, initDatabases } from './index'
import { createProvider } from './provider-store'
import {
  countRequestLogs,
  createAttemptContent,
  createRequestAttempt,
  createRequestContent,
  createRequestLog,
  getAttemptUsage,
  getRequestLog,
  getRequestUsage,
  listAttemptContents,
  listAttemptContentSummaries,
  listRequestContents,
  listRequestContentSummaries,
  listRequestLogs,
  listAttemptsByRequest,
  pruneRequestContentsBefore,
  pruneRequestLogsBefore,
  recordAttemptUsage,
  updateAttemptContent,
  updateRequestContent,
  updateRequestLogStatus,
} from './request-log-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-request-log-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function createLog(id: string, status: 'pending' | 'success' | 'failed' = 'success') {
  return createRequestLog({
    id,
    logicalModelId: 'model_default',
    clientProtocol: 'openai-completions',
    transport: 'http-stream',
    status,
    totalDurationMilliseconds: 10,
  })
}

/** 同一请求的同一次序号只能落一行，冲突时 store 返回 `null`。 */
async function createAttemptOrThrow(input: Parameters<typeof createRequestAttempt>[0]) {
  const attempt = await createRequestAttempt(input)
  if (!attempt) throw new Error('expected attempt to be created')
  return attempt
}

/** 多次尝试的用例共用的尝试字段；每次调用只需覆盖随尝试变化的那几项。 */
function attemptBase(requestId: string, provider: Awaited<ReturnType<typeof createProvider>>) {
  return {
    requestId,
    providerId: provider.id,
    providerModelId: 'model_retry',
    providerName: provider.name,
    providerModelName: 'retry-model',
    upstreamProtocol: 'openai-completions' as const,
    upstreamRequestId: null,
    url: 'https://example.com/v1/chat/completions',
    retryable: false,
    upstreamTransport: 'http-stream' as const,
    durationMilliseconds: 5,
  }
}

/** 用量字段的「都不知道」形状，用于只关心部分字段的用例。 */
const EMPTY_USAGE = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null }

describe('request log store persistence', () => {
  it('filters, counts, paginates, and maps request logs from stored rows', async () => {
    const first = await createLog('req_first', 'success')
    const second = await createLog('req_second', 'failed')
    getDataDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(100, first.id)
    getDataDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(200, second.id)

    expect(await countRequestLogs({ status: 'failed', createdTimeFrom: 150, createdTimeTo: 250 })).toBe(1)
    expect(await listRequestLogs(1, 0, { logicalModelId: 'model_default' })).toEqual([
      expect.objectContaining({ id: second.id, status: 'failed', totalDurationMilliseconds: 10 }),
    ])
    expect(await listRequestLogs(1, 1)).toEqual([expect.objectContaining({ id: first.id })])
  })

  it('round-trips content, attempts, and usages and updates content fields', async () => {
    const log = await createLog('req_related')
    const provider = await createProvider({ name: 'Related Provider', apiKeyReference: 'related-key', timeoutMilliseconds: 1000 })
    const attempt = await createAttemptOrThrow({
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
      upstreamTransport: 'http-stream',
      durationMilliseconds: 8,
      ttftMilliseconds: 3,
      requestRewriteRuleIds: ['rule_a', 'rule_b'],
      responseRewriteRuleIds: ['rule_c'],
    })
    // 这次尝试就是服务该请求的那次，因此同一事务里把用量镜像到请求级。
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 7, outputTokens: 2 })
    const content = await createRequestContent({
      requestId: log.id,
      captureStatus: 'partial',
      requestMethod: 'POST',
      requestPath: '/v1/chat/completions',
      requestHeaders: '{"x-test":"1"}',
      requestBody: '{}',
    })
    await updateRequestContent(content.id, { captureStatus: 'captured', responseStatus: 200, responseBody: '{"ok":true}' })
    const attemptContent = await createAttemptContent({
      attemptId: attempt.id,
      captureStatus: 'partial',
      requestHeaders: '{"x-upstream":"1"}',
      requestBody: '{}',
    })
    await updateAttemptContent(attemptContent.id, { captureStatus: 'captured', responseStatus: 200, responseBody: '{"ok":true}' })

    expect(await listAttemptsByRequest(log.id)).toEqual([expect.objectContaining({
      id: attempt.id,
      httpStatus: 200,
      upstreamTransport: 'http-stream',
      ttftMilliseconds: 3,
      requestRewriteRuleIds: ['rule_a', 'rule_b'],
      responseRewriteRuleIds: ['rule_c'],
    })])
    // 请求级 TTFT 取自服务该请求的那次尝试（这里只有一次尝试），不存第二份副本。
    expect((await getRequestLog(log.id))?.ttftMilliseconds).toBe(3)
    // 两个视角的用量各自存在自己的表里，互不影面。
    expect(await getAttemptUsage(attempt.id)).toEqual({ inputTokens: 7, outputTokens: 2, totalTokens: 9, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null })
    expect(await getRequestUsage(log.id)).toEqual({ inputTokens: 7, outputTokens: 2, totalTokens: 9, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null })
    expect(await listRequestContents(log.id)).toEqual([expect.objectContaining({
      id: content.id,
      captureStatus: 'captured',
      responseStatus: 200,
      responseBody: '{"ok":true}',
    })])
    expect(await listAttemptContents(log.id)).toEqual([expect.objectContaining({
      id: attemptContent.id,
      attemptId: attempt.id,
      captureStatus: 'captured',
      responseStatus: 200,
      responseBody: '{"ok":true}',
    })])

    // 摘要把正文两列直接排除在 select 之外（不是取出来再删字段），其余字段与整行同源。
    const requestSummary = (await listRequestContentSummaries(log.id))[0]
    expect(requestSummary).toMatchObject({
      id: content.id,
      captureStatus: 'captured',
      requestMethod: 'POST',
      requestPath: '/v1/chat/completions',
      responseStatus: 200,
    })
    expect(Object.keys(requestSummary)).not.toContain('requestBody')
    expect(Object.keys(requestSummary)).not.toContain('responseBody')

    const attemptSummary = (await listAttemptContentSummaries(log.id))[0]
    expect(attemptSummary).toMatchObject({
      id: attemptContent.id,
      attemptId: attempt.id,
      captureStatus: 'captured',
      responseStatus: 200,
    })
    expect(Object.keys(attemptSummary)).not.toContain('requestBody')
    expect(Object.keys(attemptSummary)).not.toContain('responseBody')
  })

  it('正文不管多大都完整落库：压缩是透明的，读回来的字节与写进去的一模一样', async () => {
    const log = await createLog('req_large_body')
    // 造一段真实世界会遇到的正文：远超压缩门槛，重复结构 + 中文 + 表情。
    const largeBody = JSON.stringify({
      messages: Array.from({ length: 400 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: `第 ${index} 段内容，请原样返回 🌍` })),
    })
    const content = await createRequestContent({
      requestId: log.id,
      captureStatus: 'captured',
      requestMethod: 'POST',
      requestPath: '/v1/chat/completions',
      requestHeaders: '{}',
      requestBody: largeBody,
    })
    await updateRequestContent(content.id, { responseBody: largeBody })

    // 库里躺的是压缩后的字节，而不是被裁过的文本——这是「不丢内容」的物理证据。
    const storedRow = getDataDb().$client.prepare('SELECT requestBody, responseBody FROM request_contents WHERE id = ?').get(content.id) as { requestBody: unknown; responseBody: unknown }
    for (const stored of [storedRow.requestBody, storedRow.responseBody]) {
      expect(stored).toBeInstanceOf(Uint8Array)
      expect((stored as Uint8Array).length).toBeLessThan(Buffer.byteLength(largeBody, 'utf8'))
    }

    // 而消费方只看得到原文：写入路径与更新路径都必须还原得一字不差。
    expect((await listRequestContents(log.id))[0]).toMatchObject({ requestBody: largeBody, responseBody: largeBody })

    // 反向证据：摘要路径没读这两列，所以即便库里的字节已经坏掉也照常返回；
    // 整行路径必须解压，同一个坏字节当场就炸。这条差异就是「详情不再解压正文」的证据——
    // 没有它，把 `select` 改回全取也能让上面那堆断言全部通过。
    getDataDb().$client.prepare('UPDATE request_contents SET requestBody = ? WHERE id = ?').run(new Uint8Array([1, 2, 3]), content.id)
    expect((await listRequestContentSummaries(log.id))[0]).toMatchObject({ id: content.id, requestMethod: 'POST' })
    await expect(listRequestContents(log.id)).rejects.toThrow()
  })

  it('updates request outcome fields and prunes all related rows', async () => {
    const log = await createLog('req_prunable', 'pending')
    await updateRequestLogStatus(log.id, { status: 'success', totalDurationMilliseconds: 20 })
    await updateRequestLogStatus(log.id, { totalDurationMilliseconds: 0 })
    expect(await getRequestLog(log.id)).toMatchObject({
      status: 'success',
      totalDurationMilliseconds: 0,
      // 没有任何尝试时，请求级用量与 TTFT 只能是「还不知道」。
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      rawUsage: null,
      ttftMilliseconds: null,
    })

    await createRequestContent({
      requestId: log.id,
      captureStatus: 'captured',
      requestMethod: 'GET',
      requestPath: '/',
      requestHeaders: null,
      requestBody: null,
      responseStatus: 200,
      responseHeaders: null,
      responseBody: null,
    })
    // 外键要求 attempt_contents 指向真实尝试记录。
    const pruneProvider = await createProvider({ name: 'Prune Provider', apiKeyReference: 'prune-key', timeoutMilliseconds: 1000 })
    const pruneAttempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: pruneProvider.id,
      providerModelId: 'model_prune',
      providerName: pruneProvider.name,
      providerModelName: 'prune-model',
      upstreamProtocol: 'openai-completions',
      upstreamRequestId: null,
      url: 'https://example.com/v1/chat/completions',
      attemptIndex: 0,
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      durationMilliseconds: 3,
    })
    await createAttemptContent({
      attemptId: pruneAttempt.id,
      captureStatus: 'captured',
      requestHeaders: null,
      requestBody: null,
      responseStatus: 200,
      responseHeaders: null,
      responseBody: null,
    })
    await recordAttemptUsage({ attemptId: pruneAttempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 1, outputTokens: 1 })
    getDataDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(Date.now() - 3 * 24 * 60 * 60 * 1000, log.id)

    expect(await pruneRequestLogsBefore(1)).toBe(1)
    expect(await getRequestLog(log.id)).toBeNull()
    expect(await getDataDb().$client.prepare('SELECT COUNT(*) AS count FROM request_contents WHERE requestId = ?').get(log.id)).toEqual({ count: 0 })
    expect(await getDataDb().$client.prepare('SELECT COUNT(*) AS count FROM attempt_contents WHERE attemptId = ?').get(pruneAttempt.id)).toEqual({ count: 0 })
    expect(await getDataDb().$client.prepare('SELECT COUNT(*) AS count FROM attempt_usages WHERE attemptId = ?').get(pruneAttempt.id)).toEqual({ count: 0 })
    expect(await getDataDb().$client.prepare('SELECT COUNT(*) AS count FROM request_usages WHERE requestId = ?').get(log.id)).toEqual({ count: 0 })
  })

  it('只清理正文时保留请求、尝试与用量', async () => {
    const log = await createLog('req_content_prunable')
    const provider = await createProvider({ name: 'Content Provider', apiKeyReference: 'content-key', timeoutMilliseconds: 1000 })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_content',
      providerName: provider.name,
      providerModelName: 'content-model',
      upstreamProtocol: 'openai-completions',
      upstreamRequestId: null,
      url: 'https://example.com/v1/chat/completions',
      attemptIndex: 0,
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http-stream',
      durationMilliseconds: 5,
      ttftMilliseconds: 2,
    })
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 5, outputTokens: 6 })
    await createRequestContent({
      requestId: log.id,
      captureStatus: 'captured',
      requestMethod: 'POST',
      requestPath: '/v1/chat/completions',
      requestHeaders: null,
      requestBody: '{"big":"request"}',
      responseStatus: 200,
      responseHeaders: null,
      responseBody: '{"big":"response"}',
    })
    await createAttemptContent({
      attemptId: attempt.id,
      captureStatus: 'captured',
      requestHeaders: null,
      requestBody: '{"big":"upstream-request"}',
      responseStatus: 200,
      responseHeaders: null,
      responseBody: '{"big":"upstream-response"}',
    })
    // 两条正文各自记录写入时刻，清理只按这个时刻判断，因此分别挪到 10 天前。
    const staleTime = Date.now() - 10 * 24 * 60 * 60 * 1000
    getDataDb().$client.prepare('UPDATE request_contents SET createdTime = ? WHERE requestId = ?').run(staleTime, log.id)
    getDataDb().$client.prepare('UPDATE attempt_contents SET createdTime = ? WHERE attemptId = ?').run(staleTime, attempt.id)

    expect(await pruneRequestContentsBefore(7)).toBe(2)

    // 正文没了……
    expect(await listRequestContents(log.id)).toEqual([])
    expect(await listAttemptContents(log.id)).toEqual([])
    // ……但请求、尝试与两边的用量都还在，列表与指标照常能显示。
    expect(await getRequestLog(log.id)).toMatchObject({ id: log.id, status: 'success', ttftMilliseconds: 2 })
    expect(await listAttemptsByRequest(log.id)).toHaveLength(1)
    expect(await getAttemptUsage(attempt.id)).toMatchObject({ inputTokens: 5, outputTokens: 6, totalTokens: 11 })
    expect(await getRequestUsage(log.id)).toMatchObject({ inputTokens: 5, outputTokens: 6 })
    expect(await countRequestLogs({})).toBe(1)

    // 保留期 0 表示永久保留：不删任何东西。
    expect(await pruneRequestContentsBefore(0)).toBe(0)
  })

  it('请求级用量与首字延迟只描述服务该请求的那次尝试', async () => {
    const log = await createLog('req_retried')
    const provider = await createProvider({ name: 'Retry Provider', apiKeyReference: 'retry-key', timeoutMilliseconds: 1000 })
    const base = attemptBase(log.id, provider)

    // 第一次尝试上游按整包 JSON 作答（与客户端要的增量不符）而被放弃：
    // 它有尝试级样本，但一个字节都没写给客户端。
    const abandoned = await createAttemptOrThrow({ ...base, attemptIndex: 0, status: 'failed', httpStatus: 200, ttftMilliseconds: 120 })
    await recordAttemptUsage({ attemptId: abandoned.id, servesRequest: false, ...EMPTY_USAGE, inputTokens: 10, outputTokens: 1 })
    // 第二次尝试才是交付给客户端的那次，因此请求级两项都只能来自它。
    const serving = await createAttemptOrThrow({ ...base, attemptIndex: 1, status: 'success', httpStatus: 200, ttftMilliseconds: 300 })
    await recordAttemptUsage({ attemptId: serving.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 7, outputTokens: 2, rawUsage: { total_tokens: 9 } })

    const detail = await getRequestLog(log.id)
    // 不是历次尝试的累加：请求级就是服务那次尝试镜像过来的一份。
    expect(detail).toMatchObject({ inputTokens: 7, outputTokens: 2, totalTokens: 9, rawUsage: { total_tokens: 9 } })
    // 也不是历次尝试的最小值：120 属于一次客户端根本没看到响应的尝试。
    expect(detail?.ttftMilliseconds).toBe(300)
    expect(await getAttemptUsage(abandoned.id)).toMatchObject({ inputTokens: 10, outputTokens: 1 })

    // 服务该请求的尝试重写用量时是替换，不是相加。
    await recordAttemptUsage({ attemptId: serving.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 30, outputTokens: 4 })
    expect(await getRequestUsage(log.id)).toMatchObject({ inputTokens: 30, outputTokens: 4, totalTokens: 34 })

    // 服务那次尝试没观测到首字时，请求级只能是「不知道」——不能用更早的样本顶上。
    getDataDb().$client.prepare('UPDATE request_attempts SET ttftMilliseconds = NULL WHERE id = ?').run(serving.id)
    expect((await getRequestLog(log.id))?.ttftMilliseconds).toBeNull()
  })
})
