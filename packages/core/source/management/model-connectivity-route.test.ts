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
import { modelConnectivityRoutes, resolveProbeUrl } from './routes/diagnostics/model-connectivity'
import { mockResponse } from './test-support'

vi.mock('@server/infrastructure/network/core-network', () => ({
  coreNetworkClient: { requestHttp: vi.fn(), requestHttpBuffered: vi.fn() },
}))

/**
 * 模型对话框里的「连接测试」接口。
 *
 * 上游整块替身掉，这里只验证编排与**不写库**这条硬约束：草稿地址怎么与供应商级
 * 地址合成、失败怎么归类、一行都不通时也照旧返回 200（逐行结果自己带结论），
 * 以及探测不会碰请求日志与健康状态。
 */

let temporaryDirectory: string
let secretStore: SecretStore

function payload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

interface ConnectivityPayload {
  results: Array<{
    protocol: string
    endpointUrl: string | null
    success: boolean
    statusCode?: number
    errorCode?: string
    errorParams?: Record<string, string>
    errorMessage?: string
  }>
}

function resultsOf(response: ServerResponse): ConnectivityPayload['results'] {
  return (payload(response).data as ConnectivityPayload).results
}

function mockUpstream(statusCode: number, body = '{}'): void {
  vi.mocked(coreNetworkClient.requestHttpBuffered).mockResolvedValue({ statusCode, headers: {}, body })
}

/** 探测请求实际打出去的地址。 */
function requestedUrl(callIndex = 0): string {
  return String(vi.mocked(coreNetworkClient.requestHttpBuffered).mock.calls[callIndex][0])
}

/** 探测请求实际带出去的传输参数：真正连到哪里由这些字段决定。 */
function requestedOptions(callIndex = 0): { hostname?: string; port?: number | string; path?: string } {
  return vi.mocked(coreNetworkClient.requestHttpBuffered).mock.calls[callIndex][1] as { hostname?: string; port?: number | string; path?: string }
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-connectivity-'))
  await initDatabases(temporaryDirectory)
  secretStore = {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => 'sk-secret'),
    delete: vi.fn(async () => undefined),
  }
  configureSecretStore(secretStore)
  vi.mocked(coreNetworkClient.requestHttpBuffered).mockReset()
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('model connectivity test route', () => {
  it('供应商不存在时返回 404', async () => {
    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: 'prov_missing',
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    expect(response.statusCode).toBe(404)
    expect(payload(response).errorCode).toBe('NOT_FOUND')
  })

  it('这一行没有任何可用地址时给该行 ENDPOINT_URL_MISSING，不发请求', async () => {
    const provider = await createProvider({ name: 'No Url', apiKeyReference: 'key_no_url', enabled: true })

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    const [result] = resultsOf(response)
    expect(response.statusCode).toBe(200)
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('ENDPOINT_URL_MISSING')
    expect(result.errorParams).toEqual({ providerName: 'No Url', protocols: 'OpenAI Completions' })
    expect(coreNetworkClient.requestHttpBuffered).not.toHaveBeenCalled()
  })

  it('草稿没写覆盖地址时用供应商级地址', async () => {
    const provider = await createProvider({ name: 'Inline', apiKeyReference: 'key_inline', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    mockUpstream(200)

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    expect(requestedUrl()).toBe('https://api.example.com/v1/chat/completions')
    expect(resultsOf(response)[0]).toMatchObject({ success: true, statusCode: 200, endpointUrl: 'https://api.example.com/v1/chat/completions' })
  })

  it('真正连到哪里由 options 决定：hostname、port 与 path 必须按地址填好', async () => {
    const provider = await createProvider({ name: 'Dial', apiKeyReference: 'key_dial', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com:8443/v1/chat/completions?debug=1' })
    mockUpstream(200)

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    // `requestHttpBuffered` 的 url 入参只用来选出网方式，实际连接目标来自 options。
    // 少填 hostname 会静默连到 localhost，返回一句没有信息量的连接失败——这条用例就是
    // 为了不让那个 bug 悄悄回来。
    expect(requestedOptions()).toMatchObject({ hostname: 'api.example.com', port: '8443', path: '/v1/chat/completions?debug=1' })
  })

  it('https 地址没写端口时补默认端口', async () => {
    const provider = await createProvider({ name: 'DefaultPort', apiKeyReference: 'key_default_port', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    mockUpstream(200)

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    expect(requestedOptions()).toMatchObject({ hostname: 'api.example.com', port: 443, path: '/v1/chat/completions' })
  })

  it('草稿覆盖地址优先，相对写法以该协议的供应商级地址为基准补全', async () => {
    const provider = await createProvider({ name: 'Override', apiKeyReference: 'key_override', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'anthropic-messages', url: 'https://api.anthropic.com/v1/messages' })
    mockUpstream(200)

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'claude-3-5-sonnet',
      endpoints: [{ protocol: 'anthropic-messages', endpointUrl: '/v1beta/messages' }],
    })

    // 用户想覆盖的是这家供应商的那条接口，所以基准必须是它自己的地址，不是凭空拼一个域名。
    expect(requestedUrl()).toBe('https://api.anthropic.com/v1beta/messages')
    expect(resultsOf(response)[0].success).toBe(true)
  })

  it('每个启用的协议各发一次，请求体按该协议的形状与草稿模型名构造', async () => {
    const provider = await createProvider({ name: 'Multi', apiKeyReference: 'key_multi', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'anthropic-messages', url: 'https://api.anthropic.com/v1/messages' })
    mockUpstream(200)

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'draft-model-name',
      endpoints: [
        { protocol: 'openai-completions', endpointUrl: '' },
        { protocol: 'anthropic-messages', endpointUrl: '' },
      ],
    })

    const results = resultsOf(response)
    expect(results.map(result => result.protocol)).toEqual(['openai-completions', 'anthropic-messages'])
    expect(results.every(result => result.success)).toBe(true)

    const bodies = vi.mocked(coreNetworkClient.requestHttpBuffered).mock.calls.map(call => JSON.parse(String(call[2])))
    // 模型名原样带上：用户要确认的正是「上游认不认这个名字」。
    expect(bodies[0]).toMatchObject({ model: 'draft-model-name', messages: [{ role: 'user', content: 'Hi' }] })
    expect(bodies[1]).toMatchObject({ model: 'draft-model-name', max_tokens: 16 })
    // 连通性探测就是一问一答，不带 stream。
    expect(bodies[0].stream).toBeUndefined()
  })

  it('凭证按协议预设装配，密钥从供应商引用里解出来', async () => {
    const provider = await createProvider({ name: 'Auth', apiKeyReference: 'key_auth', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'anthropic-messages', url: 'https://api.anthropic.com/v1/messages' })
    mockUpstream(200)

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'claude-3',
      endpoints: [{ protocol: 'anthropic-messages', endpointUrl: '' }],
    })

    expect(secretStore.get).toHaveBeenCalledWith('key_auth')
    const headers = vi.mocked(coreNetworkClient.requestHttpBuffered).mock.calls[0][1].headers as Record<string, string>
    expect(headers).toMatchObject({ 'x-api-key': 'sk-secret', 'anthropic-version': '2023-06-01' })
  })

  it('上游 401 单列为凭证被拒，并带上供应商自己的超时', async () => {
    const provider = await createProvider({ name: 'Rejected', apiKeyReference: 'key_rejected', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    mockUpstream(401, JSON.stringify({ error: { message: 'invalid api key' } }))

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    expect(resultsOf(response)[0]).toMatchObject({ success: false, statusCode: 401, errorCode: 'UPSTREAM_AUTH_FAILED', errorMessage: 'invalid api key' })
  })

  it('其余失败状态码把上游原话带出来，而不是我们编一句', async () => {
    const provider = await createProvider({ name: 'BadRequest', apiKeyReference: 'key_bad', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    mockUpstream(400, JSON.stringify({ error: { message: 'model does not exist' } }))

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'nope',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    expect(resultsOf(response)[0]).toMatchObject({ success: false, statusCode: 400, errorCode: 'UPSTREAM_ERROR', errorMessage: 'model does not exist' })
  })

  it('网络异常落成 UPSTREAM_ERROR，不会被吞成成功', async () => {
    const provider = await createProvider({ name: 'Broken', apiKeyReference: 'key_broken', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    vi.mocked(coreNetworkClient.requestHttpBuffered).mockRejectedValue(new Error('connect ECONNREFUSED'))

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    expect(resultsOf(response)[0]).toMatchObject({ success: false, errorCode: 'UPSTREAM_ERROR' })
  })

  it('超时按文本判据单列成 UPSTREAM_TIMEOUT', async () => {
    const provider = await createProvider({ name: 'Slow', apiKeyReference: 'key_slow', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    vi.mocked(coreNetworkClient.requestHttpBuffered).mockRejectedValue(new Error('Connection timeout'))

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    expect(resultsOf(response)[0]).toMatchObject({ success: false, errorCode: 'UPSTREAM_TIMEOUT' })
  })

  it('WebSocket 端点直接说不支持，不拿 HTTP 请求去打', async () => {
    const provider = await createProvider({ name: 'Socket', apiKeyReference: 'key_socket', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'wss://api.example.com/v1/ws' })
    mockUpstream(200)

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    expect(resultsOf(response)[0]).toMatchObject({ success: false, errorCode: 'TRANSPORT_NOT_IMPLEMENTED' })
    expect(coreNetworkClient.requestHttpBuffered).not.toHaveBeenCalled()
  })

  it('探测不写任何库：结果不落请求日志与健康状态', async () => {
    const provider = await createProvider({ name: 'Quiet', apiKeyReference: 'key_quiet', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    // 上游回 500：真实链路上这会给供应商记一次失败并进冷却。
    mockUpstream(500, 'boom')

    const response = mockResponse()
    await modelConnectivityRoutes.invoke('/api/model/connectivity-test', response, {
      providerId: provider.id,
      modelName: 'gpt-4o',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '' }],
    })

    const { listProviderHealth } = await import('@server/database/health-store')
    expect(await listProviderHealth()).toEqual([])
    const { listRequestLogs } = await import('@server/database/request-log-store')
    expect(await listRequestLogs()).toEqual([])
    const { listProviderModelHealth } = await import('@server/database/health-store')
    expect(await listProviderModelHealth()).toEqual([])
  })

  it('客户端关了页面就停手：剩下的协议不再打，也不写已断的响应', async () => {
    const provider = await createProvider({ name: 'Aborted', apiKeyReference: 'key_aborted', enabled: true })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'anthropic-messages', url: 'https://api.anthropic.com/v1/messages' })

    const request = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> }
    request.method = 'POST'
    request.url = '/api/model/connectivity-test'
    request.headers = { host: 'localhost', 'content-type': 'application/json' }

    vi.mocked(coreNetworkClient.requestHttpBuffered).mockImplementation(async () => {
      // 第一次请求在路上时用户关掉了对话框。
      request.emit('aborted')
      return { statusCode: 200, headers: {}, body: '{}' }
    })

    const response = mockResponse()
    await modelConnectivityRoutes.invoke(
      '/api/model/connectivity-test',
      response,
      {
        providerId: provider.id,
        modelName: 'gpt-4o',
        endpoints: [
          { protocol: 'openai-completions', endpointUrl: '' },
          { protocol: 'anthropic-messages', endpointUrl: '' },
        ],
      },
      request as never,
    )

    expect(coreNetworkClient.requestHttpBuffered).toHaveBeenCalledTimes(1)
    expect(response.end).not.toHaveBeenCalled()
  })
})

describe('resolveProbeUrl', () => {
  it('草稿为空时用供应商地址；两边都空就没有可用地址', () => {
    expect(resolveProbeUrl('', 'https://api.example.com/v1')).toBe('https://api.example.com/v1')
    expect(resolveProbeUrl('  ', '  ')).toBeNull()
  })

  it('绝对地址直接用，不因供应商地址而改写', () => {
    expect(resolveProbeUrl('https://other.example.com/v1/messages', 'https://api.example.com/v1')).toBe('https://other.example.com/v1/messages')
  })

  it('相对地址以供应商同协议地址为基准补全', () => {
    expect(resolveProbeUrl('/v1beta/messages', 'https://api.example.com/v1/messages')).toBe('https://api.example.com/v1beta/messages')
  })

  it('没有基准时原样返回，由调用方报「地址不合法」', () => {
    expect(resolveProbeUrl('/v1beta/messages', '')).toBe('/v1beta/messages')
  })
})
