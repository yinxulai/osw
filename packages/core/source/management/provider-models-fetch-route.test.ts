import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '@common/secret-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { coreNetworkClient } from '@server/infrastructure/network/core-network'
import { createProvider, createProviderEndpoint } from '@server/database/provider-store'
import { closeDatabases, initDatabases } from '../database'
import { providerModelFetchRoutes } from './routes/diagnostics/provider-models-fetch'
import { mockResponse } from './test-support'

vi.mock('@server/infrastructure/network/core-network', () => ({
  coreNetworkClient: { requestHttp: vi.fn(), requestHttpBuffered: vi.fn() },
}))

/**
 * 供应商模型列表探测接口。
 *
 * 上游网络被整块替身掉，这里只验证编排：找不到供应商给 404、没有地址给 400、
 * 第一个能用的候选地址即返回、全部失败时按「是否被拒凭证」区分错误码。
 * 地址候选与响应解析的纯逻辑另有 `provider-models-fetch.test.ts`。
 */

let temporaryDirectory: string
let secretStore: SecretStore

function payload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

function payloadData(response: ServerResponse): Record<string, unknown> {
  return payload(response).data as Record<string, unknown>
}

function mockUpstream(statusCode: number, body: string): void {
  vi.mocked(coreNetworkClient.requestHttpBuffered).mockResolvedValue({ statusCode, headers: {}, body })
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-fetch-models-'))
  await initDatabases(temporaryDirectory)
  secretStore = {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  }
  configureSecretStore(secretStore)
  vi.mocked(coreNetworkClient.requestHttpBuffered).mockReset()
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('fetch provider models route', () => {
  it('供应商不存在时返回 404', async () => {
    const response = mockResponse()
    await providerModelFetchRoutes.invoke('/api/provider/fetch-models', response, {
      protocol: 'openai-completions',
      providerId: 'prov_missing',
    })

    expect(response.statusCode).toBe(404)
    expect(payload(response).errorCode).toBe('NOT_FOUND')
  })

  it('供应商没有地址时返回 400（而不是拿占位地址去探测）', async () => {
    const provider = await createProvider({ name: 'No Url', apiKeyReference: 'key_no_url', enabled: true })

    const response = mockResponse()
    await providerModelFetchRoutes.invoke('/api/provider/fetch-models', response, {
      protocol: 'openai-completions',
      providerId: provider.id,
    })

    expect(response.statusCode).toBe(400)
    expect(payload(response).errorCode).toBe('ENDPOINT_URL_MISSING')
    expect(coreNetworkClient.requestHttpBuffered).not.toHaveBeenCalled()
  })

  it('命中第一个可用候选地址后返回模型列表与尝试记录', async () => {
    const provider = await createProvider({ name: 'Fetchable', apiKeyReference: 'key_fetchable', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com' })
    mockUpstream(200, JSON.stringify({ data: [{ id: 'gpt-4o', owned_by: 'openai' }] }))

    const response = mockResponse()
    await providerModelFetchRoutes.invoke('/api/provider/fetch-models', response, {
      protocol: 'openai-completions',
      providerId: provider.id,
    })

    const data = payloadData(response) as { models: unknown[]; matchedUrl: string; attempts: unknown[] }
    expect(data.matchedUrl).toBe('https://api.example.com/models')
    expect(data.models).toEqual([{ id: 'gpt-4o', ownedBy: 'openai', displayName: null, createdTime: null }])
    expect(data.attempts).toEqual([])
  })

  it('用端点地址之外传来的 baseUrl 与 apiKey 也能探测，不查库', async () => {
    mockUpstream(200, JSON.stringify({ data: [{ id: 'claude-3' }] }))

    const response = mockResponse()
    await providerModelFetchRoutes.invoke('/api/provider/fetch-models', response, {
      protocol: 'anthropic-messages',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'sk-temp',
    })

    expect(payloadData(response).models).toEqual([
      { id: 'claude-3', ownedBy: null, displayName: null, createdTime: null },
    ])
    expect(coreNetworkClient.requestHttpBuffered).toHaveBeenCalledTimes(1)
  })

  it('全部候选被拒凭证时返回 UPSTREAM_AUTH_FAILED', async () => {
    mockUpstream(401, 'unauthorized')

    const response = mockResponse()
    await providerModelFetchRoutes.invoke('/api/provider/fetch-models', response, {
      protocol: 'openai-completions',
      baseUrl: 'https://api.example.com',
    })

    expect(response.statusCode).toBe(502)
    expect(payload(response).errorCode).toBe('UPSTREAM_AUTH_FAILED')
    // 两个候选地址都试过（裸 base 与 /v1 变体）
    expect(coreNetworkClient.requestHttpBuffered).toHaveBeenCalledTimes(2)
  })

  it('全部候选失败但非凭证问题时返回 UPSTREAM_MODELS_UNAVAILABLE', async () => {
    mockUpstream(500, 'boom')

    const response = mockResponse()
    await providerModelFetchRoutes.invoke('/api/provider/fetch-models', response, {
      protocol: 'openai-completions',
      baseUrl: 'https://api.example.com',
    })

    expect(response.statusCode).toBe(502)
    expect(payload(response).errorCode).toBe('UPSTREAM_MODELS_UNAVAILABLE')
  })

  it('上游返回 200 但不是模型列表时也算失败', async () => {
    mockUpstream(200, JSON.stringify({ nope: true }))

    const response = mockResponse()
    await providerModelFetchRoutes.invoke('/api/provider/fetch-models', response, {
      protocol: 'openai-completions',
      baseUrl: 'https://api.example.com/v1/models',
    })

    expect(response.statusCode).toBe(502)
    expect(payload(response).errorCode).toBe('UPSTREAM_MODELS_UNAVAILABLE')
  })

  it('网络异常不会被吞成成功', async () => {
    vi.mocked(coreNetworkClient.requestHttpBuffered).mockRejectedValue(new Error('connect ECONNREFUSED'))

    const response = mockResponse()
    await providerModelFetchRoutes.invoke('/api/provider/fetch-models', response, {
      protocol: 'openai-completions',
      baseUrl: 'https://api.example.com/v1/models',
    })

    expect(response.statusCode).toBe(502)
    expect(payload(response).errorCode).toBe('UPSTREAM_MODELS_UNAVAILABLE')
  })

  it('客户端关了页面就停手：不再试下一个候选，也不往已断的响应里写', async () => {
    // 用户关掉面板后，这次探测已经没有接收方。继续把剩下的候选地址跑一遍，
    // 既没有任何人会看到结果，又白白占住一条可能是给他自己用的出站代理。
    const request = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> }
    request.method = 'POST'
    request.url = '/api/provider/fetch-models'
    request.headers = { host: 'localhost', 'content-type': 'application/json' }

    vi.mocked(coreNetworkClient.requestHttpBuffered).mockImplementation(async () => {
      // 第一次请求就在路上被中断（关面板 / 断网）。
      request.emit('aborted')
      return { statusCode: 500, headers: {}, body: 'boom' }
    })

    const response = mockResponse()
    await providerModelFetchRoutes.invoke(
      '/api/provider/fetch-models',
      response,
      { protocol: 'openai-completions', baseUrl: 'https://api.example.com' },
      request as never,
    )

    // 裸 base 与 /v1 变体两个候选，中断后第二个不该再发。
    expect(coreNetworkClient.requestHttpBuffered).toHaveBeenCalledTimes(1)
    expect(response.end).not.toHaveBeenCalled()
  })
})
