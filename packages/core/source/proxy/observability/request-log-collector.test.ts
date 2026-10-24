import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientDelivery } from '@server/proxy/contracts'
import type { RequestLoggingInput } from './logging-types'

/**
 * 请求级日志器是整条日志链的根：没有请求行，尝试行、用量、正文都无处归属。
 * 所以这里要守的不变量是：
 *
 * 1. **关掉「记录日志」时整条链路一起关**——返回一个什么都不做的实现，而不是 `null`
 *    （收尾、拒绝、中断三条路径就不必各自分支）；
 * 2. **落库失败退回内存里的收尾**——日志存不进去不能让请求本身出错；
 * 3. **同一实例只收尾一次**——取消竞态下两条路径会先后调它，后到的是重复事实不是新事实；
 * 4. **保留期清理是维护动作**，一分钟最多跑一次，且请求行与正文各按自己的窗口。
 */
const state = vi.hoisted(() => ({
  createRequestLogCalls: [] as Array<Record<string, unknown>>,
  createRequestContentCalls: [] as Array<Record<string, unknown>>,
  updateContextCalls: [] as Array<{ id: string; update: Record<string, unknown> }>,
  updateContentCalls: [] as Array<{ id: string; update: Record<string, unknown> }>,
  updateStatusCalls: [] as Array<{ id: string; update: Record<string, unknown> }>,
  pruneLogsCalls: [] as number[],
  pruneContentsCalls: [] as number[],
  createLogError: null as Error | null,
  createContentError: null as Error | null,
  updateContextError: null as Error | null,
  updateContentError: null as Error | null,
  updateStatusError: null as Error | null,
  pruneError: null as Error | null,
  settings: { requestLogRetentionDays: 30, contentRetentionDays: 7 },
  settingsError: null as Error | null,
  consoleErrors: [] as string[],
}))

vi.mock('@server/database/request-log-store', () => ({
  createRequestLog: async (input: Record<string, unknown>) => {
    state.createRequestLogCalls.push(input)
    if (state.createLogError) throw state.createLogError
  },
  createRequestContent: async (input: Record<string, unknown>) => {
    state.createRequestContentCalls.push(input)
    if (state.createContentError) throw state.createContentError
    return { id: 'content_1' }
  },
  updateRequestLogContext: async (id: string, update: Record<string, unknown>) => {
    state.updateContextCalls.push({ id, update })
    if (state.updateContextError) throw state.updateContextError
  },
  updateRequestContent: async (id: string, update: Record<string, unknown>) => {
    state.updateContentCalls.push({ id, update })
    if (state.updateContentError) throw state.updateContentError
  },
  updateRequestLogStatus: async (id: string, update: Record<string, unknown>) => {
    state.updateStatusCalls.push({ id, update })
    if (state.updateStatusError) throw state.updateStatusError
  },
  pruneRequestLogs: async (days: number) => {
    state.pruneLogsCalls.push(days)
    if (state.pruneError) throw state.pruneError
  },
  pruneRequestContents: async (days: number) => { state.pruneContentsCalls.push(days) },
}))

vi.mock('@server/database/settings-store', () => ({
  getSettings: async () => {
    if (state.settingsError) throw state.settingsError
    return state.settings
  },
}))

function inputOf(overrides: Partial<RequestLoggingInput> = {}): RequestLoggingInput {
  return {
    requestId: 'req_1',
    logicalModelId: 'gpt-4o',
    clientProtocol: 'openai-completions',
    transport: 'http-stream',
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sk-client' },
    requestBody: Buffer.from('{"stream":true}', 'utf8'),
    attributes: [{ key: 'user-agent', value: 'curl' }],
    captureRequestLogs: true,
    captureRequestContent: true,
    ...overrides,
  }
}

function deliveryOf(overrides: Partial<ClientDelivery> = {}): ClientDelivery {
  return {
    statusCode: 502,
    headers: { 'content-type': 'application/json' },
    body: '{"error":"upstream refused"}',
    complete: true,
    ...overrides,
  } as ClientDelivery
}

let errorSpy: ReturnType<typeof vi.spyOn>
let originalNow = 0

/**
 * 清理节流的上次时间戳是**模块级**的，所以每个用例都要拿一份新模块——
 * 共用一份会让第一个用例的清理把后面所有用例的同一分钟窗口占掉。
 */
let initializeRequestLogger: typeof import('./request-log-collector').initializeRequestLogger

beforeEach(async () => {
  vi.useFakeTimers()
  originalNow = 1_700_000_000_000
  vi.setSystemTime(originalNow)
  state.createRequestLogCalls = []
  state.createRequestContentCalls = []
  state.updateContextCalls = []
  state.updateContentCalls = []
  state.updateStatusCalls = []
  state.pruneLogsCalls = []
  state.pruneContentsCalls = []
  state.createLogError = null
  state.createContentError = null
  state.updateContextError = null
  state.updateContentError = null
  state.updateStatusError = null
  state.pruneError = null
  state.settings = { requestLogRetentionDays: 30, contentRetentionDays: 7 }
  state.settingsError = null
  state.consoleErrors = []
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { state.consoleErrors.push(String(args[0])) })
  vi.resetModules()
  initializeRequestLogger = (await import('./request-log-collector')).initializeRequestLogger
})

afterEach(() => {
  errorSpy.mockRestore()
  vi.useRealTimers()
})

describe('initializeRequestLogger 的建行', () => {
  it('请求行落库时状态是 pending，耗时留 0', async () => {
    await initializeRequestLogger(inputOf())

    expect(state.createRequestLogCalls[0]).toEqual({
      id: 'req_1',
      logicalModelId: 'gpt-4o',
      clientProtocol: 'openai-completions',
      transport: 'http-stream',
      status: 'pending',
      totalDurationMilliseconds: 0,
      attributes: [{ key: 'user-agent', value: 'curl' }],
    })
  })

  // 客户端声明的形态原样落库：上游跳是不是同形是尝试行的事。
  it('客户端跳的形态按声明落库', async () => {
    await initializeRequestLogger(inputOf({ transport: 'websocket' }))

    expect(state.createRequestLogCalls[0]?.transport).toBe('websocket')
  })

  it('开正文捕获时建一条 partial 的客户端正文，头脱敏、体原样', async () => {
    const logger = await initializeRequestLogger(inputOf())

    expect(logger.requestContentId).toBe('content_1')
    const headers = JSON.parse(String(state.createRequestContentCalls[0]?.requestHeaders))
    expect(headers.authorization).toBe('[REDACTED]')
    expect(headers['content-type']).toBe('application/json')
    expect(state.createRequestContentCalls[0]).toMatchObject({
      requestId: 'req_1',
      captureStatus: 'partial',
      requestMethod: 'POST',
      requestPath: '/v1/chat/completions',
      requestBody: '{"stream":true}',
    })
  })

  it('关掉正文捕获时只建请求行', async () => {
    const logger = await initializeRequestLogger(inputOf({ captureRequestContent: false }))

    expect(logger.requestContentId).toBeNull()
    expect(state.createRequestContentCalls).toEqual([])
  })

  // 正文建行失败不该把请求行带走：请求行已经落库，logger 照常返回，只是没有正文可写。
  it('正文建行失败时仍返回可用的 logger，只是没有正文 id', async () => {
    state.createContentError = new Error('disk full')

    const logger = await initializeRequestLogger(inputOf())

    expect(state.createRequestLogCalls).toHaveLength(1)
    expect(logger.requestContentId).toBeNull()
    expect(state.consoleErrors).toEqual(['[proxy] failed to write the request log: disk full'])
  })

  it('请求行建行失败也不抛，返回的 logger 仍能收尾', async () => {
    state.createLogError = new Error('database is locked')

    const logger = await initializeRequestLogger(inputOf())
    await expect(logger.finalizeRequestLog('failed', originalNow)).resolves.toBeUndefined()

    expect(state.consoleErrors).toEqual(['[proxy] failed to write the request log: database is locked'])
    expect(state.updateStatusCalls).toHaveLength(1)
  })
})

describe('initializeRequestLogger 的关闭路径', () => {
  it('关掉请求日志时返回空实现，一个写口都不落库', async () => {
    const logger = await initializeRequestLogger(inputOf({ captureRequestLogs: false }))

    await logger.updateRequest({
      logicalModelId: 'gpt-4o',
      clientProtocol: 'openai-completions',
      transport: 'http-stream',
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      requestBody: Buffer.from(''),
    })
    await logger.finalizeRequestLog('success', originalNow)
    await logger.finalizeRequestContent({ perspective: 'client', statusCode: 200, responseBody: '{}' })
    await logger.finalizeLocalErrorContent(deliveryOf())

    expect(state.createRequestLogCalls).toEqual([])
    expect(state.createRequestContentCalls).toEqual([])
    expect(state.updateStatusCalls).toEqual([])
    expect(state.updateContentCalls).toEqual([])
    expect(logger.requestContentId).toBeNull()
  })

  // 空实现里的清理也不该被触发：关掉日志的部署不该为日志做维护动作。
  it('空实现的收尾不触发保留期清理', async () => {
    const logger = await initializeRequestLogger(inputOf({ captureRequestLogs: false }))
    await logger.finalizeRequestLog('success', originalNow)

    expect(state.pruneLogsCalls).toEqual([])
    expect(state.pruneContentsCalls).toEqual([])
  })
})

describe('updateRequest', () => {
  it('请求身份与路由事实补齐后同步请求行', async () => {
    const logger = await initializeRequestLogger(inputOf({ logicalModelId: null, clientProtocol: null }))

    await logger.updateRequest({
      logicalModelId: 'claude-3-5',
      clientProtocol: 'anthropic-messages',
      transport: 'http',
      method: 'PUT',
      path: '/v1/messages',
      headers: { 'x-trace': 'abc' },
      requestBody: Buffer.from('{"model":"claude-3-5"}', 'utf8'),
    })

    expect(state.updateContextCalls[0]).toEqual({
      id: 'req_1',
      update: { logicalModelId: 'claude-3-5', clientProtocol: 'anthropic-messages', transport: 'http' },
    })
  })

  it('正文那一份也跟着同步（方法、路径、头、体）', async () => {
    const logger = await initializeRequestLogger(inputOf())

    await logger.updateRequest({
      logicalModelId: 'gpt-4o',
      clientProtocol: 'openai-completions',
      transport: 'http-stream',
      method: 'PUT',
      path: '/v1/messages',
      headers: { 'x-trace': 'abc' },
      requestBody: Buffer.from('{"model":"gpt-4o"}', 'utf8'),
    })

    expect(state.updateContentCalls[0]).toEqual({
      id: 'content_1',
      update: {
        requestMethod: 'PUT',
        requestPath: '/v1/messages',
        requestHeaders: JSON.stringify({ 'x-trace': 'abc' }),
        requestBody: '{"model":"gpt-4o"}',
      },
    })
  })

  it('没有正文 id 时只同步请求行', async () => {
    const logger = await initializeRequestLogger(inputOf({ captureRequestContent: false }))

    await logger.updateRequest({
      logicalModelId: 'gpt-4o',
      clientProtocol: 'openai-completions',
      transport: 'http-stream',
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      requestBody: Buffer.from(''),
    })

    expect(state.updateContextCalls).toHaveLength(1)
    expect(state.updateContentCalls).toEqual([])
  })

  // 入口先建行、路由后再补事实：更新失败只记一条，请求继续。
  it('同步失败只记一条错误，不抛', async () => {
    const logger = await initializeRequestLogger(inputOf())
    state.updateContextError = new Error('database is locked')

    await expect(logger.updateRequest({
      logicalModelId: 'gpt-4o',
      clientProtocol: 'openai-completions',
      transport: 'http-stream',
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      requestBody: Buffer.from(''),
    })).resolves.toBeUndefined()
    expect(state.consoleErrors).toEqual(['[proxy] failed to update the request log: database is locked'])
  })
})

describe('finalizeRequestLog', () => {
  it('收尾只落状态与总耗时', async () => {
    const logger = await initializeRequestLogger(inputOf())
    vi.setSystemTime(originalNow + 2_500)

    await logger.finalizeRequestLog('success', originalNow)

    expect(state.updateStatusCalls[0]).toEqual({
      id: 'req_1',
      update: { status: 'success', totalDurationMilliseconds: 2_500 },
    })
  })

  it('同一实例重复收尾只生效第一次，也不重复触发清理', async () => {
    const logger = await initializeRequestLogger(inputOf())
    await logger.finalizeRequestLog('success', originalNow)
    await logger.finalizeRequestLog('cancelled', originalNow)

    expect(state.updateStatusCalls).toHaveLength(1)
    expect(state.updateStatusCalls[0]?.update.status).toBe('success')
    expect(state.pruneLogsCalls).toHaveLength(1)
  })

  it('收尾失败只记一条错误', async () => {
    const logger = await initializeRequestLogger(inputOf())
    state.updateStatusError = new Error('database is locked')

    await expect(logger.finalizeRequestLog('failed', originalNow)).resolves.toBeUndefined()
    expect(state.consoleErrors).toEqual(['[proxy] failed to update the request log: database is locked'])
  })
})

describe('保留期清理', () => {
  it('请求行与正文各按自己的窗口清理', async () => {
    const logger = await initializeRequestLogger(inputOf())
    await logger.finalizeRequestLog('success', originalNow)

    expect(state.pruneLogsCalls).toEqual([30])
    expect(state.pruneContentsCalls).toEqual([7])
  })

  // 清理是维护动作，没必要每个请求扫一遍全表。
  it('一分钟内只清理一次', async () => {
    const first = await initializeRequestLogger(inputOf())
    await first.finalizeRequestLog('success', originalNow)

    vi.setSystemTime(originalNow + 59_999)
    const second = await initializeRequestLogger(inputOf())
    await second.finalizeRequestLog('success', originalNow)
    expect(state.pruneLogsCalls).toEqual([30])

    vi.setSystemTime(originalNow + 60_000)
    const third = await initializeRequestLogger(inputOf())
    await third.finalizeRequestLog('success', originalNow)
    expect(state.pruneLogsCalls).toEqual([30, 30])
  })

  // 清理失败不能把收尾也带崩：状态已经写进去了，日志采集自己不该断。
  it('清理抛错时收尾仍算完成', async () => {
    const logger = await initializeRequestLogger(inputOf())
    state.pruneError = new Error('disk full')

    await expect(logger.finalizeRequestLog('success', originalNow)).resolves.toBeUndefined()
    expect(state.updateStatusCalls).toHaveLength(1)
    expect(state.consoleErrors).toEqual(['[proxy] failed to update the request log: disk full'])
  })

  it('读设置失败时同样只记一条错误', async () => {
    const logger = await initializeRequestLogger(inputOf())
    state.settingsError = new Error('settings unavailable')

    await expect(logger.finalizeRequestLog('success', originalNow)).resolves.toBeUndefined()
    expect(state.consoleErrors).toEqual(['[proxy] failed to update the request log: settings unavailable'])
  })
})

describe('finalizeRequestContent', () => {
  it('写客户端的最终响应：状态码、头、体', async () => {
    const logger = await initializeRequestLogger(inputOf())

    await logger.finalizeRequestContent({
      perspective: 'client',
      statusCode: 200,
      responseHeaders: JSON.stringify({ 'content-type': 'text/event-stream' }),
      responseBody: 'data: [DONE]',
    })

    expect(state.updateContentCalls[0]).toEqual({
      id: 'content_1',
      update: {
        captureStatus: 'captured',
        responseStatus: 200,
        responseHeaders: JSON.stringify({ 'content-type': 'text/event-stream' }),
        responseBody: 'data: [DONE]',
      },
    })
  })

  it('没给捕获状态时按 captured 落库', async () => {
    const logger = await initializeRequestLogger(inputOf())
    await logger.finalizeRequestContent({ perspective: 'client', statusCode: 200 })

    expect(state.updateContentCalls[0]?.update.captureStatus).toBe('captured')
  })

  it('显式给了 partial 就按 partial', async () => {
    const logger = await initializeRequestLogger(inputOf())
    await logger.finalizeRequestContent({ perspective: 'client', captureStatus: 'partial', statusCode: 200 })

    expect(state.updateContentCalls[0]?.update.captureStatus).toBe('partial')
  })

  // 响应从未写出客户端时状态码就是 null，不能用上游的值顶替。
  it('状态码为 null 时照落 null', async () => {
    const logger = await initializeRequestLogger(inputOf())
    await logger.finalizeRequestContent({ perspective: 'client', statusCode: null })

    expect(state.updateContentCalls[0]?.update.responseStatus).toBeNull()
  })

  it('没有正文 id 时什么都不写', async () => {
    const logger = await initializeRequestLogger(inputOf({ captureRequestContent: false }))
    await logger.finalizeRequestContent({ perspective: 'client', statusCode: 200 })

    expect(state.updateContentCalls).toEqual([])
  })

  it('写正文失败只记一条错误', async () => {
    const logger = await initializeRequestLogger(inputOf())
    state.updateContentError = new Error('too large')

    await expect(logger.finalizeRequestContent({ perspective: 'client', statusCode: 200 })).resolves.toBeUndefined()
    expect(state.consoleErrors).toEqual(['[proxy] failed to update the request body: too large'])
  })
})

describe('finalizeLocalErrorContent', () => {
  // 代理自己生成的错误响应在本进程里一次成形，所以不受 `delivered.complete` 影响。
  it('代理自产的错误响应记成 captured，即使 delivered 未完成', async () => {
    const logger = await initializeRequestLogger(inputOf())

    await logger.finalizeLocalErrorContent(deliveryOf({ complete: false }))

    expect(state.updateContentCalls[0]).toMatchObject({
      id: 'content_1',
      update: {
        captureStatus: 'captured',
        responseStatus: 502,
        responseBody: '{"error":"upstream refused"}',
      },
    })
  })

  it('状态码、头、体都取自出口的同一份快照', async () => {
    const logger = await initializeRequestLogger(inputOf())

    await logger.finalizeLocalErrorContent(deliveryOf({ statusCode: 429, headers: { 'retry-after': '5' }, body: 'slow down' }))

    const update = state.updateContentCalls[0]?.update
    expect(update?.responseStatus).toBe(429)
    expect(JSON.parse(String(update?.responseHeaders))).toEqual({ 'retry-after': '5' })
    expect(update?.responseBody).toBe('slow down')
  })
})
