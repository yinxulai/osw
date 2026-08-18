import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelWithProvider } from './router'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'

const mocks = vi.hoisted(() => ({
  models: [] as ModelWithProvider[],
  markProviderFailure: vi.fn(),
  markProviderSuccess: vi.fn(),
  updateRequestLogStatus: vi.fn(),
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
  getSettings: async () => ({ idleTimeoutMilliseconds: 1_000 }),
  createRequestLog: async (input: Record<string, unknown>) => ({ id: 'req_test', ...input }),
  createRequestAttempt: async (input: Record<string, unknown>) => ({ id: 'att_test', ...input }),
  updateRequestLogStatus: mocks.updateRequestLogStatus,
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

function model(id: string, providerId: string, upstreamUrl: string, upstreamModelId: string, protocol: ModelWithProvider['model']['endpoints'][number]['protocol'] = 'openai-completions'): ModelWithProvider {
  const time = Date.now()
  return {
    model: {
      id,
      logicalModelId: 'model_default',
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
    expect(mocks.markProviderFailure).toHaveBeenCalledWith('prov_first')
    expect(mocks.markProviderSuccess).toHaveBeenCalledWith('prov_second')
  })

  it('records raw usage from an OpenAI Responses streaming completion event', async () => {
    configureSecretStore({
      set: async () => undefined,
      get: async () => 'secret',
      delete: async () => undefined,
    })
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"type":"response.created","response":{"usage":{"input_tokens":1200,"input_tokens_details":{"cached_tokens":0}}}}\n\n')
      res.end('data: {"type":"response.completed","response":{"usage":{"input_tokens":1200,"input_tokens_details":{"cached_tokens":1024},"output_tokens":80}}}\n\n')
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
        rawUsage: {
          input_tokens: 1200,
          input_tokens_details: { cached_tokens: 1024 },
          output_tokens: 80,
        },
      }),
    )
  })
})
