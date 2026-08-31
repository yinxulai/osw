import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelWithProvider } from '@server/proxy/routing/router'
import type * as RouterModule from '@server/proxy/routing/router'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'

const mocks = vi.hoisted(() => ({
  models: [] as ModelWithProvider[],
  captureRequestContent: false,
  markProviderFailure: vi.fn(),
  markProviderSuccess: vi.fn(),
  markProviderModelFailure: vi.fn(),
  markProviderModelSuccess: vi.fn(),
  createRequestLog: vi.fn(async (input: Record<string, unknown>) => ({ id: 'req_test', ...input })),
  createRequestAttempt: vi.fn(async (input: Record<string, unknown>) => ({ id: 'att_test', ...input })),
  createRequestContent: vi.fn(async (input: Record<string, unknown>) => ({ id: input.attemptId ? 'content_attempt' : 'content_request', ...input })),
  createRequestConversion: vi.fn(),
  updateRequestContent: vi.fn(),
  updateRequestLogStatus: vi.fn(),
  replaceRequestUsage: vi.fn(),
  pruneRequestLogs: vi.fn(),
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
  getSettings: async () => ({ idleTimeoutMilliseconds: 1_000, logRetentionDays: 7, captureRequestContent: mocks.captureRequestContent }),
}))

vi.mock('@server/database/logical-model-store', () => ({
  listLogicalModels: async () => [
    { id: 'default', name: 'default', enabled: true },
    { id: 'secondary', name: 'secondary', enabled: true },
  ],
}))

vi.mock('@server/database/request-log-store', () => ({
  createRequestLog: mocks.createRequestLog,
  createRequestAttempt: mocks.createRequestAttempt,
  createRequestContent: mocks.createRequestContent,
  createRequestConversion: mocks.createRequestConversion,
  updateRequestContent: mocks.updateRequestContent,
  updateRequestLogStatus: mocks.updateRequestLogStatus,
  replaceRequestUsage: mocks.replaceRequestUsage,
  pruneRequestLogs: mocks.pruneRequestLogs,
}))

import { handleProxyRequest } from './request-entry'
import { getManualModel, setManualModel } from '../routing/manual-routing'

const servers: http.Server[] = []
type ManualModelOptions = { manualModelId?: string | null }

afterEach(async () => {
  setManualModel('default', null)
  setManualModel('secondary', null)
  mocks.models = []
  mocks.captureRequestContent = false
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
      void handleProxyRequest(req, res, 'default')
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
      void handleProxyRequest(req, res, 'default')
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
      void handleProxyRequest(req, res, 'default')
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
      void handleProxyRequest(req, res, 'default')
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
      void handleProxyRequest(req, res, 'default')
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
      errorMessage: '手动指定的 ProviderModel 当前不可用于该协议',
    })
    expect(upstreamHandler).not.toHaveBeenCalled()
    expect(mocks.createRequestLog).not.toHaveBeenCalled()
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
      void handleProxyRequest(req, res, 'default')
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
    [{ messages: [] }, '缺少 model 字段'],
    [{ model: '', messages: [] }, 'model 必须为非空字符串'],
    [{ model: 123, messages: [] }, 'model 必须为非空字符串'],
  ])('rejects invalid model input before contacting upstream: %s', async (body, expectedMessage) => {
    const upstreamHandler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => res.end())
    const upstream = await listen(upstreamHandler)
    mocks.models = [model('model_first', 'prov_first', `${upstream.url}/v1/chat/completions`, 'first-model')]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res, 'default')
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
    expect(mocks.createRequestLog).not.toHaveBeenCalled()
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
      void handleProxyRequest(req, res, 'default')
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
      void handleProxyRequest(req, res, 'default')
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
      void handleProxyRequest(req, res, 'default')
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
    expect(mocks.createRequestContent).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'att_test',
      captureStatus: 'partial',
      responseStatus: null,
      responseHeaders: null,
      responseBody: null,
    }))
    expect(mocks.markProviderFailure).toHaveBeenCalledWith('prov_failed')
    expect(mocks.markProviderModelFailure).not.toHaveBeenCalledWith('model_failed')
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
      void handleProxyRequest(req, res, 'default')
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
      void handleProxyRequest(req, res, 'default')
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
      errorMessage: '所有 Provider 都失败了',
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
      void handleProxyRequest(req, res, 'default')
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
    const attemptContent = mocks.createRequestContent.mock.calls.find(([input]) => input.responseStatus === 503)?.[0]
    expect(attemptContent).toEqual(expect.objectContaining({ captureStatus: 'partial', responseBody: firstChunk }))
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
      void handleProxyRequest(req, res, 'default')
    })

    const response = await fetch(`${proxy.url}/v1/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', prompt: 'Hello' }),
    })

    expect(response.status).toBe(200)
    const attemptContent = mocks.createRequestContent.mock.calls.find(([input]) => input.responseStatus === 429)?.[0]
    expect(attemptContent).toEqual(expect.objectContaining({
      attemptId: 'att_test',
      captureStatus: 'captured',
      responseStatus: 429,
      responseBody: errorBody,
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
      void handleProxyRequest(req, res, 'default')
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
      void handleProxyRequest(req, res, 'default')
    })

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [] }),
    })
    await response.json()

    expect(mocks.updateRequestLogStatus).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        totalTokens: 1620,
        inputTokens: 1500,
        outputTokens: 120,
        cachedInputTokens: 900,
        cacheCreationInputTokens: null,
        promptCacheHit: true,
        rawUsage: {
          prompt_tokens: 1500,
          prompt_tokens_details: { cached_tokens: 900 },
          completion_tokens: 120,
        },
      }),
    )
    expect(mocks.replaceRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'att_test',
      inputTokens: 1500,
      outputTokens: 120,
      totalTokens: 1620,
      cachedInputTokens: 900,
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
      void handleProxyRequest(req, res, 'default')
    })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [], max_tokens: 16 }),
    })
    await response.json()

    expect(mocks.updateRequestLogStatus).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        totalTokens: 3375,
        inputTokens: 3300,
        outputTokens: 75,
        cachedInputTokens: 1000,
        cacheCreationInputTokens: 500,
        promptCacheHit: true,
        rawUsage: {
          input_tokens: 1800,
          output_tokens: 75,
          cache_read_input_tokens: 1000,
          cache_creation: {
            ephemeral_5m_input_tokens: 200,
            ephemeral_1h_input_tokens: 300,
          },
        },
      }),
    )
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
      void handleProxyRequest(req, res, 'default')
    })

    const response = await fetch(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', input: 'Hello', stream: true }),
    })
    await response.text()

    expect(mocks.updateRequestLogStatus).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        totalTokens: 1280,
        inputTokens: 1200,
        outputTokens: 80,
        cachedInputTokens: 1024,
        cacheCreationInputTokens: null,
        promptCacheHit: true,
        rawUsage: {
          input_tokens: 1200,
          input_tokens_details: { cached_tokens: 1024 },
          output_tokens: 80,
        },
      }),
    )
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
      void handleProxyRequest(req, res, 'default')
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
    expect(mocks.updateRequestLogStatus).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ upstreamProtocol: 'openai-completions' }),
    )
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
      void handleProxyRequest(req, res, 'default')
    })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: [], max_tokens: 16 }),
    })

    expect(response.status).toBe(503)
    const payload = await response.json()
    expect(payload.errorMessage).toContain('未配置')
    expect(payload.errorMessage).toContain('协议转换')
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
      void handleProxyRequest(req, res, 'default')
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
    expect(mocks.updateRequestLogStatus).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ upstreamProtocol: null }),
    )
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
      void handleProxyRequest(req, res, 'default')
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
    expect(mocks.updateRequestLogStatus).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ upstreamProtocol: 'openai-completions' }),
    )
    const requestContent = mocks.createRequestContent.mock.calls.find(([input]) => input.attemptId == null)?.[0]
    expect(requestContent).toEqual(expect.objectContaining({
      captureStatus: 'partial',
      requestHeaders: expect.any(String),
      requestBody: JSON.stringify({ model: 'default', messages: [], max_tokens: 16, stream: true }),
    }))
    expect(JSON.parse(String(requestContent?.requestHeaders))).toEqual(expect.objectContaining({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'content-type': 'application/json',
    }))

    const attemptContent = mocks.createRequestContent.mock.calls.find(([input]) => input.attemptId === 'att_test')?.[0]
    expect(attemptContent).toEqual(expect.objectContaining({
      captureStatus: 'captured',
      responseStatus: 200,
    }))
    expect(mocks.createRequestConversion).toHaveBeenCalledWith(expect.objectContaining({
      clientProtocol: 'anthropic-messages',
      upstreamProtocol: 'openai-completions',
      requestBody: expect.stringContaining('stream-model'),
      responseBody: expect.stringContaining('content_block_delta'),
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
      void handleProxyRequest(req, res, 'default')
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
    const attemptContent = mocks.createRequestContent.mock.calls.find(([input]) => input.attemptId === 'att_test')?.[0]
    expect(attemptContent).toEqual(expect.objectContaining({ captureStatus: 'partial', responseStatus: 200 }))
    expect(JSON.parse(String(attemptContent?.responseBody))).toEqual({ schemaVersion: 1, chunks: [firstChunk] })
    expect(mocks.updateRequestContent).toHaveBeenCalledWith('content_request', expect.objectContaining({
      captureStatus: 'partial',
      responseStatus: 200,
      responseBody: JSON.stringify({ schemaVersion: 1, chunks: [firstChunk] }),
    }))
  })

  it('cancels the upstream request when the local client aborts', async () => {
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
      res.write('data: {"type":"response.created"}\n\n')
    })
    mocks.models = [
      model('model_cancel', 'prov_cancel', `${upstream.url}/v1/responses`, 'cancel-model', 'openai-responses'),
    ]
    const proxy = await listen((req, res) => {
      void handleProxyRequest(req, res, 'default')
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
})
