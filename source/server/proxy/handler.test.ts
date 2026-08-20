import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelWithProvider } from './router'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'

const mocks = vi.hoisted(() => ({
  models: [] as ModelWithProvider[],
  markProviderFailure: vi.fn(),
  markProviderSuccess: vi.fn(),
  createRequestLog: vi.fn(async (input: Record<string, unknown>) => ({ id: 'req_test', ...input })),
  updateRequestLogStatus: vi.fn(),
  pruneRequestLogs: vi.fn(),
}))

vi.mock('./router', async importOriginal => {
  const original = await importOriginal<typeof import('./router')>()
  return {
    ...original,
    getAvailableModels: async () => mocks.models,
  }
})

vi.mock('./health', () => ({
  markProviderFailure: mocks.markProviderFailure,
  markProviderSuccess: mocks.markProviderSuccess,
}))

vi.mock('../database/store', () => ({
  getSettings: async () => ({ idleTimeoutMilliseconds: 1_000, logRetentionCount: 1_000 }),
  createRequestLog: mocks.createRequestLog,
  createRequestAttempt: async (input: Record<string, unknown>) => ({ id: 'att_test', ...input }),
  updateRequestLogStatus: mocks.updateRequestLogStatus,
  pruneRequestLogs: mocks.pruneRequestLogs,
}))

import { handleProxyRequest } from './handler'

const servers: http.Server[] = []

afterEach(async () => {
  mocks.models = []
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
      upstreamModelId,
      endpoints: [{ protocol, upstreamUrl, customAuthHeader: null }],
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
      upstreamUrls: '{}',
      createdTime: time,
      updatedTime: time,
      deletedTime: null,
    },
  }
}

describe('handleProxyRequest', () => {
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
      void handleProxyRequest(req, res, 'model_default')
    })
    const response = await fetch(`${proxy.url}/v1/completions?client=value`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'client-model', prompt: 'Hello' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-upstream')).toBe('second')
    expect(await response.json()).toEqual({
      path: '/configured/second?version=1',
      model: 'second-model',
    })
    expect(mocks.createRequestLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }))
    expect(mocks.markProviderFailure).toHaveBeenCalledWith('prov_first')
    expect(mocks.markProviderSuccess).toHaveBeenCalledWith('prov_second')
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
      void handleProxyRequest(req, res, 'model_default')
    })

    const response = await fetch(`${proxy.url}/messages?beta=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'client-model', messages: [], max_tokens: 16 }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path: '/custom/v1/messages?fixed=true' })
    expect(mocks.markProviderSuccess).toHaveBeenCalledWith('prov_anthropic')
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
      void handleProxyRequest(req, res, 'model_default')
    })

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'client-model', messages: [] }),
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
      void handleProxyRequest(req, res, 'model_default')
    })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'client-model', messages: [], max_tokens: 16 }),
    })
    await response.json()

    expect(mocks.updateRequestLogStatus).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        totalTokens: 1875,
        inputTokens: 1800,
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
      void handleProxyRequest(req, res, 'model_default')
    })

    const response = await fetch(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'client-model', input: 'Hello', stream: true }),
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

  it('cancels the upstream request when the local client aborts', async () => {
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
      void handleProxyRequest(req, res, 'model_default')
    })

    const client = http.request(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    client.on('error', () => undefined)
    client.end(JSON.stringify({ model: 'client-model', input: 'Hello', stream: true }))
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
  })
})
