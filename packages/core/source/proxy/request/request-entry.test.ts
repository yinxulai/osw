import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelWithProvider } from '@server/proxy/routing/router'
import type * as RouterModule from '@server/proxy/routing/router'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'

const mocks = vi.hoisted(() => ({
  models: [] as ModelWithProvider[],
  captureRequestContent: false,
  listRulesForProviderModel: vi.fn(),
  markProviderFailure: vi.fn(),
  markProviderSuccess: vi.fn(),
  markProviderModelFailure: vi.fn(),
  markProviderModelSuccess: vi.fn(),
  createRequestLog: vi.fn(async (input: Record<string, unknown>) => ({ id: 'req_test', ...input })),
  createRequestAttempt: vi.fn(async (input: Record<string, unknown>) => ({ id: 'att_test', ...input })),
  createRequestContent: vi.fn(async (input: Record<string, unknown>) => ({ id: 'content_request', ...input })),
  createAttemptContent: vi.fn(async (input: Record<string, unknown>) => ({ id: 'content_attempt', ...input })),
  updateRequestContent: vi.fn(),
  updateAttemptContent: vi.fn(),
  updateRequestLogStatus: vi.fn(),
  recordAttemptUsage: vi.fn(),
  pruneRequestLogs: vi.fn(),
  pruneRequestContents: vi.fn(),
}))

vi.mock('@server/proxy/routing/router', async importOriginal => {
  const original = await importOriginal<typeof RouterModule>()
  return {
    ...original,
    getAvailableModels: async (_logicalModelId: string, options: ManualModelOptions = {}) => options.manualModelId
      ? mocks.models.filter(candidate => candidate.model.id === options.manualModelId)
      : mocks.models,
  }
})

vi.mock('@server/proxy/upstream/health', () => ({
  markProviderFailure: mocks.markProviderFailure,
  markProviderSuccess: mocks.markProviderSuccess,
  markProviderModelFailure: mocks.markProviderModelFailure,
  markProviderModelSuccess: mocks.markProviderModelSuccess,
}))

vi.mock('@server/database/settings-store', () => ({
  getSettings: async () => ({ idleTimeoutMilliseconds: 1_000, requestLogRetentionDays: 7, contentRetentionDays: 7, captureRequestLogs: true, captureRequestContent: mocks.captureRequestContent }),
}))

vi.mock('@server/database/logical-model-store', () => ({
  listLogicalModels: async () => [
    { id: 'default', name: 'default', enabled: true },
    { id: 'secondary', name: 'secondary', enabled: true },
  ],
}))

/**
 * 代理入口的落点由当前生效的**工作流图**决定，而图存在数据库里。
 *
 * 这个文件测的是入口自身的流程（拒绝、日志、流式搬运），不是图的执行，因此这里不去初始化
 * 数据库，而是用内建默认策略当场生成一张图——它对应的正是「一版图都没保存过」这个真实运行状态，
 * 行为与用户开箱得到的路由完全一致。
 */
vi.mock('@server/database/router-graph-store', async () => {
  const { createDefaultPolicyGraph } = await import('@common/router/presets')
  return {
    resolveRouterGraph: async () => ({
      graph: createDefaultPolicyGraph([
        { id: 'default', name: 'default', enabled: true },
        { id: 'secondary', name: 'secondary', enabled: true },
      ]),
      version: 0,
      savedAt: 0,
    }),
  }
})

vi.mock('@server/database/request-log-store', () => ({
  createRequestLog: mocks.createRequestLog,
  createRequestAttempt: mocks.createRequestAttempt,
  createRequestContent: mocks.createRequestContent,
  createAttemptContent: mocks.createAttemptContent,
  updateRequestContent: mocks.updateRequestContent,
  updateAttemptContent: mocks.updateAttemptContent,
  updateRequestLogStatus: mocks.updateRequestLogStatus,
  recordAttemptUsage: mocks.recordAttemptUsage,
  pruneRequestLogs: mocks.pruneRequestLogs,
  pruneRequestContents: mocks.pruneRequestContents,
}))

vi.mock('@server/database/request-rewrite-rule-store', () => ({
  listRulesForProviderModel: mocks.listRulesForProviderModel,
}))

mocks.listRulesForProviderModel.mockResolvedValue([])

import { handleProxyRequest } from './request-entry'
import { getManualModel, setManualModel } from '../routing/manual-routing'

const servers: http.Server[] = []
type ManualModelOptions = { manualModelId?: string | null }

afterEach(async () => {
  setManualModel('default', null)
  setManualModel('secondary', null)
  mocks.models = []
  mocks.captureRequestContent = false
  mocks.listRulesForProviderModel.mockResolvedValue([])
  vi.clearAllMocks()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}` }
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  servers.splice(servers.indexOf(server), 1)
}

async function waitFor(condition: () => boolean, timeoutMilliseconds = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/**
 * 被拒的请求同样是用户真实发出的请求。
 *
 * 这些分支在建立请求上下文之前就返回了，但如果它们不落库，「日志里查不到」
 * 就会被误读成「这个请求从来没发生过」。
 */
type RejectionRecordExpectation = { clientProtocol: string | null; logicalModelId: string | null }

async function expectRejectionRecorded(input: RejectionRecordExpectation): Promise<void> {
  await waitFor(() => mocks.updateRequestLogStatus.mock.calls.length > 0)
  expect(mocks.createRequestLog).toHaveBeenCalledTimes(1)
  expect(mocks.createRequestLog).toHaveBeenCalledWith(expect.objectContaining({
    status: 'pending',
    clientProtocol: input.clientProtocol,
    logicalModelId: input.logicalModelId,
  }))
  expect(mocks.updateRequestLogStatus).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'failed' }))
  expect(mocks.createRequestAttempt).not.toHaveBeenCalled()
}

function model(id: string, providerId: string, upstreamUrl: string, upstreamModelId: string, protocol: ModelWithProvider['model']['endpoints'][number]['protocol'] = 'openai-completions'): ModelWithProvider {
  const time = Date.now()
  return {
    model: {
      id,
      providerId,
      modelName: upstreamModelId,
      endpoints: [{ protocol, endpointUrl: upstreamUrl, customAuthHeader: null, protocolConversionEnabled: false }],
      priority: 1,
      enabled: true,
      createdTime: time,
      updatedTime: time,
      deletedTime: null,
    },
    provider: {
      id: providerId,
      name: providerId,
      apiKeyReference: `${providerId}_key`,
      timeoutMilliseconds: 1_000,
      enabled: true,
      createdTime: time,
      updatedTime: time,
      deletedTime: null,
    },
  }
}

function convertibleModel(id: string, providerId: string, upstreamUrl: string, upstreamModelId: string, protocol: ModelWithProvider['model']['endpoints'][number]['protocol']): ModelWithProvider {
  const entry = model(id, providerId, upstreamUrl, upstreamModelId, protocol)
  entry.model.endpoints[0].protocolConversionEnabled = true
  return entry
}

describe('handleProxyRequest', () => {
  it('isolates the manual starting model by logical model', () => {
    setManualModel('default', 'model_auto')
    setManualModel('secondary', 'model_secondary')

    expect(getManualModel('default')).toBe('model_auto')
    expect(getManualModel('secondary')).toBe('model_secondary')

    setManualModel('default', null)
    expect(getManualModel('default')).toBeNull()
    expect(getManualModel('secondary')).toBe('model_secondary')
  })

  it('records a rejected request even when the api path is unknown', async () => {
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/unknown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default' }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      success: false,
      errorCode: 'UNKNOWN_API_PATH',
      errorMessage: 'Unrecognized API path',
    })
    // 连协议都识别不出来，因此客户端协议为 null。
    await expectRejectionRecorded({ clientProtocol: null, logicalModelId: null })
  })

  it('rejects requests without any supported upstream target', async () => {
    mocks.models = [
      model('model_text', 'prov_text', 'https://example.com/v1/completions', 'text-model', 'openai-completions'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [] }),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      success: false,
      errorCode: 'NO_AVAILABLE_PROVIDER',
      errorMessage: expect.stringContaining('No available upstream provider'),
    })
    await expectRejectionRecorded({ clientProtocol: 'anthropic-messages', logicalModelId: 'default' })
  })

  it('starts routing from the manually selected provider model', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const firstHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ provider: 'first' }))
    })
    const secondHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ provider: 'second' }))
    })
    const first = await listen(firstHandler)
    const second = await listen(secondHandler)
    mocks.models = [
      model('model_first', 'prov_first', `${first.url}/v1/chat/completions`, 'first-model'),
      model('model_second', 'prov_second', `${second.url}/v1/chat/completions`, 'second-model'),
    ]
    setManualModel('default', 'model_second')
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [] }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ provider: 'second' })
    expect(secondHandler).toHaveBeenCalledOnce()
    expect(firstHandler).not.toHaveBeenCalled()
  })

  it('does not fall back when the manually selected model fails', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const firstHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ provider: 'first' }))
    })
    const secondHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unavailable' }))
    })
    const thirdHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ provider: 'third' }))
    })
    const first = await listen(firstHandler)
    const second = await listen(secondHandler)
    const third = await listen(thirdHandler)
    mocks.models = [
      model('model_first', 'prov_first', `${first.url}/v1/chat/completions`, 'first-model'),
      model('model_second', 'prov_second', `${second.url}/v1/chat/completions`, 'second-model'),
      model('model_third', 'prov_third', `${third.url}/v1/chat/completions`, 'third-model'),
    ]
    setManualModel('default', 'model_second')
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [] }),
    })

    expect(response.status).toBe(502)
    expect(secondHandler).toHaveBeenCalledOnce()
    expect(thirdHandler).not.toHaveBeenCalled()
    expect(firstHandler).not.toHaveBeenCalled()
  })

  it('keeps concurrent request logs, attempts, and health updates isolated', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prompt: string }
        const delay = Number(body.prompt.slice('request-'.length)) % 3
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ prompt: body.prompt }))
        }, delay)
      })
    })
    mocks.models = [model('model_shared', 'prov_shared', `${upstream.url}/v1/completions`, 'shared-model')]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const responses = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const response = await fetch(`${proxy.url}/v1/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'default', prompt: `request-${index}` }),
      })
      return { status: response.status, body: await response.json() }
    }))

    expect(responses).toEqual(Array.from({ length: 8 }, (_, index) => ({
      status: 200,
      body: { prompt: `request-${index}` },
    })))
    const requestIds = mocks.createRequestLog.mock.calls.map(([input]) => input.id as string)
    const attemptRequestIds = mocks.createRequestAttempt.mock.calls.map(([input]) => input.requestId as string)
    expect(new Set(requestIds).size).toBe(8)
    expect(attemptRequestIds).toHaveLength(8)
    expect([...attemptRequestIds].sort()).toEqual([...requestIds].sort())
    expect(mocks.markProviderSuccess).toHaveBeenCalledTimes(8)
    expect(mocks.markProviderModelSuccess).toHaveBeenCalledTimes(8)
    expect(mocks.markProviderFailure).not.toHaveBeenCalled()
    expect(mocks.markProviderModelFailure).not.toHaveBeenCalled()
  })

  it('keeps an active stream on its original provider after the manual model changes', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    let finishFirstStream: (() => void) | undefined
    const first = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"provider":"first","part":1}\n\n')
      finishFirstStream = () => {
        res.write('data: {"provider":"first","part":2}\n\n')
        res.end('data: [DONE]\n\n')
      }
    })
    const secondHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"provider":"second"}\n\ndata: [DONE]\n\n')
    })
    const second = await listen(secondHandler)
    mocks.models = [
      model('model_first', 'prov_first', `${first.url}/v1/completions`, 'first-model'),
      model('model_second', 'prov_second', `${second.url}/v1/completions`, 'second-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const firstResponse = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'first request', stream: true }),
    })
    setManualModel('default', 'model_second')
    const secondResponse = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'second request', stream: true }),
    })
    finishFirstStream?.()

    expect(secondResponse.status).toBe(200)
    expect(await secondResponse.text()).toBe('data: {"provider":"second"}\n\ndata: [DONE]\n\n')
    expect(firstResponse.status).toBe(200)
    expect(await firstResponse.text()).toBe(
      'data: {"provider":"first","part":1}\n\ndata: {"provider":"first","part":2}\n\ndata: [DONE]\n\n',
    )
    expect(secondHandler).toHaveBeenCalledOnce()
    expect(mocks.markProviderSuccess).toHaveBeenCalledWith('prov_first')
    expect(mocks.markProviderSuccess).toHaveBeenCalledWith('prov_second')
  })

  it('rejects an unavailable manual starting model without silently falling back', async () => {
    const upstreamHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => res.end())
    const upstream = await listen(upstreamHandler)
    mocks.models = [
      model('model_openai', 'prov_openai', `${upstream.url}/v1/chat/completions`, 'openai-model'),
      model('model_anthropic', 'prov_anthropic', `${upstream.url}/v1/messages`, 'anthropic-model', 'anthropic-messages'),
    ]
    setManualModel('default', 'model_anthropic')
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [] }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      success: false,
      errorCode: 'MANUAL_MODEL_UNAVAILABLE',
      errorMessage: 'The manually selected ProviderModel is not available for this protocol',
    })
    expect(upstreamHandler).not.toHaveBeenCalled()
    await expectRejectionRecorded({ clientProtocol: 'openai-completions', logicalModelId: 'default' })
  })

  it('routes an unmatched client model through the default logical model', async () => {
    const upstreamHandler = vi.fn((req: http.IncomingMessage, res: http.ServerResponse) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ model: body.model }))
      })
    })
    const upstream = await listen(upstreamHandler)
    mocks.models = [model('model_first', 'prov_first', `${upstream.url}/v1/chat/completions`, 'first-model')]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'client-requested-model', messages: [] }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ model: 'first-model' })
    expect(upstreamHandler).toHaveBeenCalledOnce()
  })

  it.each([
    [{ messages: [] }, 'Missing the model field'],
    [{ model: '', messages: [] }, 'The model field must be a non-empty string'],
    [{ model: 123, messages: [] }, 'The model field must be a non-empty string'],
  ])('rejects invalid model input before contacting upstream: %s', async (body, expectedMessage) => {
    const upstreamHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => res.end())
    const upstream = await listen(upstreamHandler)
    mocks.models = [model('model_first', 'prov_first', `${upstream.url}/v1/chat/completions`, 'first-model')]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      errorCode: 'INVALID_MODEL',
      errorMessage: expectedMessage,
    })
    expect(upstreamHandler).not.toHaveBeenCalled()
    await expectRejectionRecorded({ clientProtocol: 'openai-completions', logicalModelId: null })
  })

  it('rejects request rewrite failures before any upstream attempt', async () => {
    mocks.captureRequestContent = true
    mocks.listRulesForProviderModel.mockResolvedValue([
      {
        id: 'rule_protected_header',
        name: 'Protected Header',
        description: '',
        enabled: true,
        scope: 'model',
        schemaVersion: 1,
        source: 'user',
        match: { clientProtocols: [], upstreamProtocols: [] },
        actions: [{ type: 'header-set', stage: 'request', name: 'Authorization', value: 'blocked' }],
        testCases: [],
        createdTime: 1,
        updatedTime: 1,
        deletedTime: null,
      },
    ])
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstreamHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => res.end())
    const upstream = await listen(upstreamHandler)
    mocks.models = [model('model_rewrite', 'prov_rewrite', `${upstream.url}/v1/completions`, 'rewrite-model')]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      success: false,
      errorCode: 'REQUEST_REWRITE_RULE_FAILED',
      errorMessage: 'Modifying a protected header is not allowed: Authorization',
    })
    expect(upstreamHandler).not.toHaveBeenCalled()
    expect(mocks.createRequestAttempt).not.toHaveBeenCalled()
    expect(mocks.updateRequestLogStatus).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'failed' }))
    // 我们确实回了客户端一个 422。客户端拿到的响应必须留证，否则记录里只剩一个
    // 「failed」，看不到失败原因，也不知道客户端收到了什么。
    expect(mocks.updateRequestContent).toHaveBeenCalledWith('content_request', expect.objectContaining({
      captureStatus: 'captured',
      responseStatus: 422,
      responseBody: JSON.stringify({
        success: false,
        errorCode: 'REQUEST_REWRITE_RULE_FAILED',
        errorMessage: 'Modifying a protected header is not allowed: Authorization',
      }),
    }))
  })

  it('discards a retryable response before forwarding the next successful response', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async reference => reference.replace('_key', '_secret'),
      delete: async () => undefined,
    })
    const first = await listen((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain', 'x-upstream': 'first' })
      res.end('first provider failed')
    })
    const second = await listen((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json', 'x-upstream': 'second' })
        res.end(JSON.stringify({ path: req.url, model: body.model }))
      })
    })

    mocks.models = [
      model('model_first', 'prov_first', `${first.url}/configured/first`, 'first-model'),
      model('model_second', 'prov_second', `${second.url}/configured/second?version=1`, 'second-model'),
    ]

    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })
    const response = await fetch(`${proxy.url}/v1/completions?client=value`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-upstream')).toBe('second')
    expect(await response.json()).toEqual({
      path: '/configured/second?version=1',
      model: 'second-model',
    })
    expect(mocks.createRequestLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }))
    expect(mocks.markProviderFailure).not.toHaveBeenCalled()
    expect(mocks.markProviderModelFailure).toHaveBeenCalledWith('model_first')
    expect(mocks.markProviderSuccess).toHaveBeenCalledWith('prov_second')
    expect(mocks.markProviderModelSuccess).toHaveBeenCalledWith('model_second')
    expect(mocks.createRequestContent).not.toHaveBeenCalled()
    expect(mocks.createAttemptContent).not.toHaveBeenCalled()
    expect(mocks.updateRequestContent).not.toHaveBeenCalled()
    expect(mocks.createRequestAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      providerId: 'prov_first',
      providerModelId: 'model_first',
      providerName: 'prov_first',
      providerModelName: 'first-model',
      upstreamProtocol: 'openai-completions',
      url: `${first.url}/configured/first`,
      httpStatus: 503,
      retryable: true,
      status: 'failed',
    }))
    expect(mocks.createRequestAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      providerId: 'prov_second',
      providerModelId: 'model_second',
      providerName: 'prov_second',
      providerModelName: 'second-model',
      upstreamProtocol: 'openai-completions',
      url: `${second.url}/configured/second?version=1`,
      httpStatus: 200,
      retryable: false,
      status: 'success',
    }))
  })

  it.each([
    { status: 401, body: 'invalid api key', failureScope: 'provider' },
    { status: 403, body: 'account forbidden', failureScope: 'provider' },
    { status: 429, body: 'account rate limit exceeded', failureScope: 'provider' },
    { status: 429, body: 'model capacity exhausted', failureScope: 'provider-model' },
    { status: 500, body: 'model backend failed', failureScope: 'provider-model' },
  ] as const)('fails over status $status and attributes health to $failureScope', async ({ status, body, failureScope }) => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const first = await listen((_req, res) => {
      res.writeHead(status, { 'content-type': 'text/plain' })
      res.end(body)
    })
    const second = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"provider":"second"}')
    })
    mocks.models = [
      model('model_failed', 'prov_failed', `${first.url}/v1/completions`, 'failed-model'),
      model('model_second', 'prov_second', `${second.url}/v1/completions`, 'second-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ provider: 'second' })
    expect(mocks.createRequestAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      providerId: 'prov_failed',
      providerModelId: 'model_failed',
      httpStatus: status,
      retryable: true,
      status: 'failed',
    }))
    if (failureScope === 'provider') {
      expect(mocks.markProviderFailure).toHaveBeenCalledWith('prov_failed')
      expect(mocks.markProviderModelFailure).not.toHaveBeenCalledWith('model_failed')
    } else {
      expect(mocks.markProviderFailure).not.toHaveBeenCalledWith('prov_failed')
      expect(mocks.markProviderModelFailure).toHaveBeenCalledWith('model_failed')
    }
  })

  it.each([
    { name: 'connection refusal', closeBeforeRequest: true },
    { name: 'disconnect before response headers', closeBeforeRequest: false },
  ])('fails over after $name and records a provider failure', async ({ closeBeforeRequest }) => {
    mocks.captureRequestContent = true
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const first = await listen((req, _res) => {
      req.socket.destroy(new Error('disconnected before headers'))
    })
    if (closeBeforeRequest) await closeServer(first.server)
    const second = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"provider":"second"}')
    })
    mocks.models = [
      model('model_failed', 'prov_failed', `${first.url}/v1/completions`, 'failed-model'),
      model('model_second', 'prov_second', `${second.url}/v1/completions`, 'second-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ provider: 'second' })
    expect(mocks.createRequestAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      providerId: 'prov_failed',
      providerModelId: 'model_failed',
      httpStatus: null,
      retryable: true,
      status: 'failed',
      errorCode: 'UPSTREAM_ERROR',
    }))
    // 连接层失败时上游一个字节都没回：状态码与响应头留空。但「请求确实发出去了」和
    // 「为什么失败」都必须留证，否则这次尝试在记录里只剩一个空壳。
    expect(mocks.createAttemptContent).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'att_test',
      captureStatus: 'partial',
      responseStatus: null,
      responseHeaders: null,
      responseBody: expect.stringContaining('"localFailure":true'),
      requestBody: expect.stringContaining('"model":"failed-model"'),
      // 出站请求头带着鉴权头，因此落库前必须脱敏。
      requestHeaders: expect.stringContaining('"authorization":"[REDACTED]"'),
    }))
    expect(mocks.markProviderFailure).toHaveBeenCalledWith('prov_failed')
    expect(mocks.markProviderModelFailure).not.toHaveBeenCalledWith('model_failed')
  })

  it('fails over after an upstream connection timeout', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const first = await listen((_req, _res) => {
      // Keep the socket open so the proxy hits the configured request timeout.
    })
    const second = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"provider":"second"}')
    })
    const timedOutModel = model('model_failed', 'prov_failed', `${first.url}/v1/completions`, 'failed-model')
    timedOutModel.provider.timeoutMilliseconds = 20
    mocks.models = [
      timedOutModel,
      model('model_second', 'prov_second', `${second.url}/v1/completions`, 'second-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ provider: 'second' })
    expect(mocks.createRequestAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      providerId: 'prov_failed',
      providerModelId: 'model_failed',
      httpStatus: null,
      retryable: true,
      status: 'failed',
      errorCode: 'UPSTREAM_ERROR',
      errorMessage: 'Connection timeout',
    }))
    expect(mocks.createRequestAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      providerId: 'prov_second',
      providerModelId: 'model_second',
      httpStatus: 200,
      retryable: false,
      status: 'success',
    }))
    expect(mocks.markProviderFailure).toHaveBeenCalledWith('prov_failed')
    expect(mocks.markProviderModelFailure).not.toHaveBeenCalledWith('model_failed')
    expect(mocks.markProviderSuccess).toHaveBeenCalledWith('prov_second')
    expect(mocks.markProviderModelSuccess).toHaveBeenCalledWith('model_second')
  })

  it.each([
    { status: 400, body: '{"error":"provider-specific validation"}' },
    { status: 422, body: '{"error":"unsupported parameter"}' },
  ])('fails over upstream client status $status', async ({ status, body }) => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const first = await listen((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body)
    })
    const secondHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    const second = await listen(secondHandler)
    mocks.models = [
      model('model_failed', 'prov_failed', `${first.url}/v1/completions`, 'failed-model'),
      model('model_second', 'prov_second', `${second.url}/v1/completions`, 'second-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(secondHandler).toHaveBeenCalledOnce()
    expect(mocks.createRequestAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      providerId: 'prov_failed',
      httpStatus: status,
      retryable: true,
      status: 'failed',
    }))
    expect(mocks.createRequestAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      providerId: 'prov_second',
      httpStatus: 200,
      retryable: false,
      status: 'success',
    }))
  })

  it('returns the upstream client status when every candidate rejects the request', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const first = await listen((_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end('{"error":"first provider validation"}')
    })
    const second = await listen((_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end('{"error":"second provider validation"}')
    })
    mocks.models = [
      model('model_first', 'prov_first', `${first.url}/v1/completions`, 'first-model'),
      model('model_second', 'prov_second', `${second.url}/v1/completions`, 'second-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })
    const responseBody = await response.text()

    // 换一家上游也照样被判定为「请求本身不成立」，因此客户端必须收到 400 而不是 502：
    // 502 在客户端语义里是「网关临时故障，可重试」，那会让它在这个请求上无限重试。
    expect(response.status).toBe(400)
    expect(JSON.parse(responseBody)).toEqual({
      success: false,
      errorCode: 'ALL_PROVIDERS_FAILED',
      // 交给客户端的原文是**最近**那一次上游说的：同类结论被后面一次覆盖。
      errorMessage: 'All providers failed: the last upstream responded with 400 ({"error":"second provider validation"})',
    })
  })

  it('keeps the client status when a later provider fails below HTTP', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const dead = await listen((_req, res) => res.end())
    const deadUrl = dead.url
    await closeServer(dead.server)
    const rejecting = await listen((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end('{"error":"unsupported parameter"}')
    })
    mocks.models = [
      model('model_dead', 'prov_dead', `${deadUrl}/v1/completions`, 'dead-model'),
      model('model_rejecting', 'prov_rejecting', `${rejecting.url}/v1/completions`, 'rejecting-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })
    const responseBody = await response.text()

    // 一次连接失败只解释了「这一家这次没连上」，盖不住「上游已经判定这个请求不成立」这个结论，
    // 因此解释与状态码都要继续以 422 为准。
    expect(response.status).toBe(422)
    expect(JSON.parse(responseBody)).toEqual({
      success: false,
      errorCode: 'ALL_PROVIDERS_FAILED',
      errorMessage: 'All providers failed: the last upstream responded with 422 ({"error":"unsupported parameter"})',
    })
  })

  it.each([401, 429])('keeps the gateway status when every candidate fails with %i', async status => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end('{"error":"invalid api key"}')
    })
    mocks.models = [
      model('model_failed', 'prov_failed', `${upstream.url}/v1/completions`, 'failed-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })
    const responseBody = await response.text()

    // 凭证错误与限流都是「换一家可能就成立、客户端重试也确实合理」的失败，
    // 不能把 4xx 当成责任归属交给客户端（见 `isClientAttributableStatus` 的白名单）。
    expect(response.status).toBe(502)
    expect(JSON.parse(responseBody)).toEqual({
      success: false,
      errorCode: 'ALL_PROVIDERS_FAILED',
      errorMessage: `All providers failed: the last upstream responded with ${status} ({"error":"invalid api key"})`,
    })
  })

  it('stores the final local error response after all providers fail', async () => {
    mocks.captureRequestContent = true
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' })
      res.end('provider unavailable')
    })
    mocks.models = [
      model('model_failed', 'prov_failed', `${upstream.url}/v1/completions`, 'failed-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })
    const responseBody = await response.text()

    expect(response.status).toBe(502)
    expect(JSON.parse(responseBody)).toEqual({
      success: false,
      errorCode: 'ALL_PROVIDERS_FAILED',
      // 上游 HTTP 失败不抛异常，`lastError` 永远是空的；状态码与原文因此必须由
      // failover 路径自己带出来，否则客户端只会看到一句无从下手的「All providers failed」。
      errorMessage: 'All providers failed: the last upstream responded with 503 (provider unavailable)',
    })
    expect(mocks.updateRequestContent).toHaveBeenCalledWith('content_request', expect.objectContaining({
      captureStatus: 'captured',
      responseStatus: 502,
      responseBody,
    }))
  })

  it('stores a partial retryable response before trying the next provider', async () => {
    mocks.captureRequestContent = true
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const firstChunk = 'provider partially unavailable'
    const first = await listen((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' })
      res.write(firstChunk, () => {
        setImmediate(() => res.socket?.destroy(new Error('stream interrupted')))
      })
    })
    const second = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    mocks.models = [
      model('model_partial_retry', 'prov_partial_retry', `${first.url}/v1/completions`, 'partial-retry-model'),
      model('model_retry_success', 'prov_retry_success', `${second.url}/v1/completions`, 'retry-success-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(mocks.createRequestAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      httpStatus: 503,
      retryable: true,
      errorCode: 'UPSTREAM_STREAM_ERROR',
    }))
    // 本次尝试中止后重试：503 响应只存在于上游视角，客户端尚未收到任何内容。
    const attemptContent = mocks.createAttemptContent.mock.calls.find(([input]) => input.responseStatus === 503)?.[0]
    expect(attemptContent).toEqual(expect.objectContaining({ captureStatus: 'partial', responseBody: firstChunk }))
    expect(mocks.updateRequestContent).toHaveBeenCalledWith('content_request', expect.objectContaining({
      captureStatus: 'captured',
      responseStatus: 200,
    }))
  })

  it('does not fail over after downstream streaming has already started', async () => {
    mocks.captureRequestContent = true
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const first = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', () => {
        setImmediate(() => res.socket?.destroy(new Error('stream interrupted after headers')))
      })
    })
    const secondHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"type":"response.output_text.delta","delta":"fallback"}\n\n')
    })
    const second = await listen(secondHandler)
    mocks.models = [
      model('model_started_stream', 'prov_started_stream', `${first.url}/v1/responses`, 'started-stream-model', 'openai-responses'),
      model('model_fallback_stream', 'prov_fallback_stream', `${second.url}/v1/responses`, 'fallback-stream-model', 'openai-responses'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', input: 'Hello', stream: true }),
    })

    await response.text().catch(() => undefined)
    await waitFor(() => mocks.updateRequestLogStatus.mock.calls.some(([, input]) => (
      (input as { status?: string }).status === 'failed'
    )))

    expect(secondHandler).not.toHaveBeenCalled()
    expect(mocks.createRequestAttempt).toHaveBeenCalledTimes(1)
    expect(mocks.createRequestAttempt).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'prov_started_stream',
      providerModelId: 'model_started_stream',
      status: 'failed',
      errorCode: 'UPSTREAM_STREAM_ERROR',
    }))
    expect(mocks.updateRequestContent).toHaveBeenCalledWith('content_request', expect.objectContaining({
      captureStatus: 'partial',
      responseStatus: 200,
    }))
    // 这次尝试的状态码是 200，失败只存在于「正文搬到一半断了」这个事实里：健康度必须被显式告知，
    // 否则一个每次都断流的模型永远不会被冷却，下一次请求依旧会先选中它。
    expect(mocks.markProviderModelFailure).toHaveBeenCalledWith('model_started_stream')
    expect(mocks.markProviderFailure).not.toHaveBeenCalled()
  })

  it('stores the complete retry response body and upstream headers', async () => {
    mocks.captureRequestContent = true
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const errorBody = JSON.stringify({ error: { code: 'quota_exceeded', message: 'quota exceeded', request_id: 'upstream-request-1' } })
    const upstream = await listen((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'x-request-id': 'upstream-request-1' })
      res.end(errorBody)
    })
    const fallback = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    mocks.models = [
      model('model_retry_body', 'prov_retry_body', `${upstream.url}/v1/completions`, 'retry-body-model'),
      model('model_retry_body_fallback', 'prov_retry_body_fallback', `${fallback.url}/v1/completions`, 'retry-body-fallback-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })

    expect(response.status).toBe(200)
    const attemptContent = mocks.createAttemptContent.mock.calls.find(([input]) => input.responseStatus === 429)?.[0]
    expect(attemptContent).toEqual(expect.objectContaining({
      attemptId: 'att_test',
      captureStatus: 'captured',
      responseStatus: 429,
      responseBody: errorBody,
      // 429 判定为 failover，此次尝试没有写出客户端响应，只有上游响应头。
      responseHeaders: expect.stringContaining('x-request-id'),
    }))
  })

  it('accepts an Anthropic path without /v1 while keeping the configured upstream endpoint', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ path: req.url }))
    })
    mocks.models = [
      model(
        'model_anthropic',
        'prov_anthropic',
        `${upstream.url}/custom/v1/messages?fixed=true`,
        'claude-model',
        'anthropic-messages',
      ),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/messages?beta=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [], max_tokens: 16 }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path: '/custom/v1/messages?fixed=true' })
    expect(mocks.markProviderSuccess).toHaveBeenCalledWith('prov_anthropic')
    expect(mocks.markProviderModelSuccess).toHaveBeenCalledWith('model_anthropic')
  })

  it('normalizes OpenAI chat usage without counting cached tokens twice', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl_test',
        usage: {
          prompt_tokens: 1500,
          prompt_tokens_details: { cached_tokens: 900 },
          completion_tokens: 120,
        },
      }))
    })
    mocks.models = [
      model('model_chat', 'prov_chat', `${upstream.url}/v1/chat/completions`, 'chat-model'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [] }),
    })
    await response.json()

    // 用量只有一个写入点：服务该请求的那次尝试。请求级数值是它的镜像，
    // 因此这里断言的是尝试级入参，`servesRequest` 为真才说明会镜像到请求级。
    expect(mocks.recordAttemptUsage).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'att_test',
      servesRequest: true,
      inputTokens: 1500,
      outputTokens: 120,
      cachedInputTokens: 900,
      cacheCreationInputTokens: null,
      rawUsage: {
        prompt_tokens: 1500,
        prompt_tokens_details: { cached_tokens: 900 },
        completion_tokens: 120,
      },
    }))
  })

  it('normalizes Anthropic cache read and cache creation usage', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'msg_test',
        usage: {
          input_tokens: 1800,
          output_tokens: 75,
          cache_read_input_tokens: 1000,
          cache_creation: {
            ephemeral_5m_input_tokens: 200,
            ephemeral_1h_input_tokens: 300,
          },
        },
      }))
    })
    mocks.models = [
      model('model_anthropic_usage', 'prov_anthropic_usage', `${upstream.url}/v1/messages`, 'claude-model', 'anthropic-messages'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [], max_tokens: 16 }),
    })
    await response.json()

    expect(mocks.recordAttemptUsage).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'att_test',
      servesRequest: true,
      inputTokens: 3300,
      outputTokens: 75,
      cachedInputTokens: 1000,
      cacheCreationInputTokens: 500,
      rawUsage: {
        input_tokens: 1800,
        output_tokens: 75,
        cache_read_input_tokens: 1000,
        cache_creation: {
          ephemeral_5m_input_tokens: 200,
          ephemeral_1h_input_tokens: 300,
        },
      },
    }))
  })

  it('records standardized prompt cache usage from the final SSE event without a trailing newline', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"type":"response.created","response":{"usage":{"input_tokens":1200,"input_tokens_details":{"cached_tokens":0}}}}\n\n')
      res.end('data: {"type":"response.completed","response":{"usage":{"input_tokens":1200,"input_tokens_details":{"cached_tokens":1024},"output_tokens":80}}}')
    })
    mocks.models = [
      model('model_responses', 'prov_responses', `${upstream.url}/v1/responses`, 'responses-model', 'openai-responses'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', input: 'Hello', stream: true }),
    })
    await response.text()

    expect(mocks.recordAttemptUsage).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'att_test',
      servesRequest: true,
      inputTokens: 1200,
      outputTokens: 80,
      cachedInputTokens: 1024,
      cacheCreationInputTokens: null,
      rawUsage: {
        input_tokens: 1200,
        input_tokens_details: { cached_tokens: 1024 },
        output_tokens: 80,
      },
    }))
  })

  it('converts an anthropic request to an openai-completions endpoint and back', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'chatcmpl_conv',
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'converted' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        }))
      })
    })
    mocks.models = [
      convertibleModel('model_conv', 'prov_conv', `${upstream.url}/v1/chat/completions`, 'upstream-model', 'openai-completions'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', system: 'sys', max_tokens: 32, messages: [{ role: 'user', content: 'hi' }] }),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    const payload = JSON.parse(text)
    expect(payload.type).toBe('message')
    expect(payload.content).toEqual([{ type: 'text', text: 'converted' }])
    expect(payload.stop_reason).toBe('end_turn')
    expect(payload.usage).toEqual({ input_tokens: 5, output_tokens: 2 })
    // 协议转换是这次尝试的事实：客户端协议与上游协议都记在尝试行上。
    expect(mocks.createRequestAttempt).toHaveBeenCalledWith(expect.objectContaining({
      upstreamProtocol: 'openai-completions',
    }))
  })

  it('rejects when no native or conversion-enabled endpoint exists', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
    mocks.models = [
      model('model_native', 'prov_native', `${upstream.url}/v1/chat/completions`, 'native-model', 'openai-completions'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [], max_tokens: 16 }),
    })

    expect(response.status).toBe(503)
    const payload = await response.json()
    expect(payload.errorMessage).toContain('protocol conversion')
    expect(payload.errorMessage).toContain('No available upstream provider')
  })

  it('prefers the native endpoint over a conversion-enabled endpoint', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const native = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'msg_native', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'native' }], stop_reason: 'end_turn' }))
    })
    const convertible = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'chatcmpl_conv', choices: [{ index: 0, message: { role: 'assistant', content: 'converted' }, finish_reason: 'stop' }] }))
    })
    const entry = convertibleModel('model_pref', 'prov_pref', `${convertible.url}/v1/chat/completions`, 'conv-model', 'openai-completions')
    entry.model.endpoints.push({ protocol: 'anthropic-messages', endpointUrl: `${native.url}/v1/messages`, customAuthHeader: null, protocolConversionEnabled: false })
    mocks.models = [entry]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [], max_tokens: 16 }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.id).toBe('msg_native')
    expect(payload.content).toEqual([{ type: 'text', text: 'native' }])
    // 原生端点：客户端协议与上游协议一致，没有发生转换。
    expect(mocks.createRequestAttempt).toHaveBeenCalledWith(expect.objectContaining({
      upstreamProtocol: 'anthropic-messages',
    }))
  })

  it('streams a converted SSE response with a trailing DONE marker', async () => {
    mocks.captureRequestContent = true
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n')
      res.write('data: {"choices":[{"delta":{"content":"y"}}]}\n\n')
      res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\ndata: [DONE]\n\n')
    })
    mocks.models = [
      convertibleModel('model_stream_conv', 'prov_stream_conv', `${upstream.url}/v1/chat/completions`, 'stream-model', 'openai-completions'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer client-secret', cookie: 'session=secret' },
      body: JSON.stringify({ model: 'default', messages: [], max_tokens: 16, stream: true }),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    const events = text.split('\n\n').filter(Boolean)
    const parsed = events.map(event => {
      const data = event.split('\n').find(line => line.startsWith('data: '))?.slice(6)
      if (!data || data === '[DONE]') return data ?? null
      return JSON.parse(data)
    })
    expect(parsed.map(event => event?.type ?? event)).toEqual([
      'message_start', 'content_block_start', 'content_block_delta',
      'content_block_delta', 'content_block_stop', 'message_delta',
      'message_stop',
    ])
    expect(parsed[2]).toMatchObject({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'he' } })
    expect(parsed[3]).toMatchObject({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'y' } })
    expect(parsed[5]).toMatchObject({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 3, output_tokens: 2 } })
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(false)
    const requestContent = mocks.createRequestContent.mock.calls[0]?.[0]
    expect(requestContent).toEqual(expect.objectContaining({
      captureStatus: 'partial',
      requestMethod: 'POST',
      requestPath: '/v1/messages',
      requestHeaders: expect.any(String),
      requestBody: JSON.stringify({ model: 'default', messages: [], max_tokens: 16, stream: true }),
    }))
    expect(JSON.parse(String(requestContent?.requestHeaders))).toEqual(expect.objectContaining({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'content-type': 'application/json',
    }))

    const attemptContent = mocks.createAttemptContent.mock.calls[0]?.[0]
    expect(attemptContent).toEqual(expect.objectContaining({
      attemptId: 'att_test',
      captureStatus: 'captured',
      responseStatus: 200,
    }))
    // 转换事实（双方协议与上游跳形态）现在是尝试行上的列，不再单独建表。
    expect(mocks.createRequestAttempt).toHaveBeenCalledWith(expect.objectContaining({
      upstreamProtocol: 'openai-completions',
      upstreamTransport: 'http-stream',
    }))
    expect(JSON.parse(String(attemptContent?.responseBody))).toEqual({
      schemaVersion: 1,
      chunks: [
        'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"y"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      ],
    })
    const requestUpdate = mocks.updateRequestContent.mock.calls.find(([id]) => id === 'content_request')?.[1]
    expect(requestUpdate).toEqual(expect.objectContaining({ captureStatus: 'captured', responseStatus: 200 }))
    const convertedCapture = JSON.parse(String(requestUpdate?.responseBody)) as { schemaVersion: number; chunks: string[] }
    expect(convertedCapture.schemaVersion).toBe(1)
    const convertedEvents = convertedCapture.chunks.join('').split('\n\n').filter(Boolean).map(event => JSON.parse(event.replace('data: ', '')))
    expect(convertedEvents.map(event => event.type)).toEqual([
      'message_start', 'content_block_start', 'content_block_delta',
      'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
    ])
    expect(convertedEvents[5]).toMatchObject({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 3, output_tokens: 2 } })
  })

  it('stores received raw chunks as partial when an upstream stream is interrupted', async () => {
    mocks.captureRequestContent = true
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const firstChunk = 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(firstChunk, () => {
        setImmediate(() => res.socket?.destroy(new Error('stream interrupted')))
      })
    })
    const fallbackHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"type":"response.completed"}\n\n')
    })
    const fallback = await listen(fallbackHandler)
    mocks.models = [
      model('model_partial', 'prov_partial', `${upstream.url}/v1/responses`, 'partial-model', 'openai-responses'),
      model('model_fallback', 'prov_fallback', `${fallback.url}/v1/responses`, 'fallback-model', 'openai-responses'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    await fetch(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', input: 'Hello', stream: true }),
    }).then(response => response.text()).catch(() => undefined)
    await waitFor(() => mocks.updateRequestLogStatus.mock.calls.some(([, input]) => (
      (input as { status?: string }).status === 'failed'
    )))

    expect(mocks.createRequestAttempt).toHaveBeenCalledTimes(1)
    expect(mocks.createRequestAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorCode: 'UPSTREAM_STREAM_ERROR',
    }))
    expect(fallbackHandler).not.toHaveBeenCalled()
    const attemptContent = mocks.createAttemptContent.mock.calls.find(([input]) => input.attemptId === 'att_test')?.[0]
    expect(attemptContent).toEqual(expect.objectContaining({ captureStatus: 'partial', responseStatus: 200 }))
    expect(JSON.parse(String(attemptContent?.responseBody))).toEqual({ schemaVersion: 1, chunks: [firstChunk] })
    // 流已开始写出，因此客户端视角保存的是真正下发过的内容。
    expect(mocks.updateRequestContent).toHaveBeenCalledWith('content_request', expect.objectContaining({
      captureStatus: 'partial',
      responseStatus: 200,
      responseBody: expect.any(String),
    }))
  })

  it('cancels the upstream request when the local client aborts before the response head', async () => {
    mocks.captureRequestContent = true
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })

    let upstreamRequestReceived!: () => void
    let upstreamConnectionClosed!: () => void
    let releaseResponseHead!: () => void
    const requestReceived = new Promise<void>(resolve => { upstreamRequestReceived = resolve })
    const connectionClosed = new Promise<void>(resolve => { upstreamConnectionClosed = resolve })
    const headReleased = new Promise<void>(resolve => { releaseResponseHead = resolve })
    const upstream = await listen((req, res) => {
      req.once('close', upstreamConnectionClosed)
      req.once('data', () => upstreamRequestReceived())
      void headReleased.then(() => {
        // 模拟客户端在响应头到来前就断开：此时上游不再发出响应头。
        if (req.destroyed || res.writableEnded) return
      })
    })
    mocks.models = [
      model('model_cancel', 'prov_cancel', `${upstream.url}/v1/responses`, 'cancel-model', 'openai-responses'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const client = http.request(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    client.on('error', () => undefined)
    client.end(JSON.stringify({ model: 'default', input: 'Hello', stream: true }))
    await requestReceived
    client.destroy()
    releaseResponseHead()

    await connectionClosed
    await waitFor(() => mocks.updateRequestLogStatus.mock.calls.some(([, input]) => (
      (input as { status?: string }).status === 'cancelled'
    )))
    expect(mocks.markProviderFailure).not.toHaveBeenCalled()
    expect(mocks.updateRequestLogStatus).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'cancelled' }),
    )
    expect(mocks.updateRequestContent).not.toHaveBeenCalledWith(
      'content_request',
      expect.objectContaining({ captureStatus: 'captured' }),
    )
  })

  it('keeps usage stats when the client aborts after a successful response head', async () => {
    mocks.captureRequestContent = true
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })

    let upstreamRequestReceived!: () => void
    let upstreamConnectionClosed!: () => void
    const requestReceived = new Promise<void>(resolve => { upstreamRequestReceived = resolve })
    const connectionClosed = new Promise<void>(resolve => { upstreamConnectionClosed = resolve })
    const upstream = await listen((req, res) => {
      req.once('close', upstreamConnectionClosed)
      req.once('data', () => upstreamRequestReceived())
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      // 这条事件既触发观察者，也代表上游已经把成功响应交给了代理。
      res.write('data: {"type":"response.output_text.delta","delta":"ok"}\n\n')
    })
    mocks.models = [
      model('model_cancel', 'prov_cancel', `${upstream.url}/v1/responses`, 'cancel-model', 'openai-responses'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const client = http.request(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    client.on('error', () => undefined)
    client.end(JSON.stringify({ model: 'default', input: 'Hello', stream: true }))
    await requestReceived
    client.destroy()

    await connectionClosed
    await waitFor(() => mocks.updateRequestLogStatus.mock.calls.some(([, input]) => (
      (input as { status?: string }).status === 'success'
    )))
    expect(mocks.markProviderSuccess).toHaveBeenCalled()
    expect(mocks.createRequestAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      httpStatus: 200,
    }))
    // 客户端提前关流：用量要留下，但正文只搬了一半，两个视角都不能标成完整采集。
    expect(mocks.updateRequestContent).toHaveBeenCalledWith('content_request', expect.objectContaining({
      captureStatus: 'partial',
      responseStatus: 200,
    }))
    expect(mocks.createAttemptContent).toHaveBeenCalledWith(expect.objectContaining({
      captureStatus: 'partial',
      responseStatus: 200,
    }))
  })

  it('records a request whose body never finished arriving', async () => {
    mocks.models = []
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res)
    })

    const client = http.request(`${proxy.url}/v1/completions`, {
      method: 'POST',
      // 声明了 100 字节却只发一部分，然后断开：这就是「读到一半客户端没了」。
      headers: { 'content-type': 'application/json', 'content-length': '100' },
    })
    client.on('error', () => undefined)
    client.write('{"model":"default",')
    await new Promise(resolve => setTimeout(resolve, 50))
    client.destroy()

    // 请求已经到达代理，就必须留下记录；什么都没记等于这次失败从未发生。
    await waitFor(() => mocks.updateRequestLogStatus.mock.calls.some(([, input]) => (
      (input as { status?: string }).status === 'cancelled'
    )))
    expect(mocks.createRequestLog).toHaveBeenCalledTimes(1)
    expect(mocks.createRequestLog).toHaveBeenCalledWith(expect.objectContaining({
      clientProtocol: 'openai-completions',
      status: 'pending',
    }))
    expect(mocks.updateRequestContent).not.toHaveBeenCalled()
  })
})
