import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import { createCoreNetworkClient } from '../infrastructure/network/core-network'
import { createOutboundConnector, getSystemProxyResolver } from '../infrastructure/network/outbound-connector'
import { outboundProxyTestRoutes } from './routes/diagnostics/outbound-proxy-test'
import { mockResponse } from './test-support'

vi.mock('../infrastructure/network/outbound-connector', () => ({
  createOutboundConnector: vi.fn(),
  getSystemProxyResolver: vi.fn(() => ({})),
}))

vi.mock('../infrastructure/network/core-network', () => ({
  createCoreNetworkClient: vi.fn(),
  coreNetworkClient: { requestHttp: vi.fn(), requestHttpBuffered: vi.fn() },
}))

/**
 * 出站代理连通性测试接口。
 *
 * 真正的网络与连接器都被替身掉，这里只验证编排：非法配置在 schema 层被拒绝、
 * 非 HTTP 目标给 VALIDATION_ERROR、成功时回传状态码与耗时、连接错误被分类成对应错误码，
 * 以及无论成败都收掉连接器与 abort 监听。
 */

interface Hooks {
  onResponse: (response: { statusCode: number | null; resume: () => void }) => void
  onError: (error: Error) => void
  onTimeout: (request: { destroy: (error: Error) => void }) => void
}

let connector: { initialize: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
let hookCalls: Hooks[]
let destroyedErrors: Error[]
let lastRequest: { destroy: (error: Error) => void }

function payload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

/** 等待处理器走到真正发起请求那一步，拿到它交给网络客户端的回调。 */
async function nextHooks(): Promise<Hooks> {
  while (hookCalls.length === 0) await new Promise(resolve => setImmediate(resolve))
  return hookCalls[hookCalls.length - 1]
}

beforeEach(() => {
  hookCalls = []
  destroyedErrors = []
  connector = { initialize: vi.fn(async () => undefined), destroy: vi.fn() }
  vi.mocked(createOutboundConnector).mockReturnValue(connector as never)
  vi.mocked(getSystemProxyResolver).mockReturnValue({} as never)
  vi.mocked(createCoreNetworkClient).mockReturnValue({
    requestHttp: (_url: URL, _options: unknown, _body: Buffer, hooks: Hooks) => {
      hookCalls.push(hooks)
      // 真实客户端在 `destroy(error)` 后会把错误抛回 `onError`，替身照做，否则超时路径永远不会落地。
      lastRequest = { destroy: (error: Error) => { destroyedErrors.push(error); hooks.onError(error) } }
      return lastRequest
    },
  } as never)
})

const validBody = {
  mode: 'direct',
  proxyUrl: '',
  bypass: '',
  targetUrl: 'https://example.com/health',
}

function invoke(body: Record<string, unknown>, response: ServerResponse = mockResponse(), request: IncomingMessage = createTestRequest()): Promise<void> {
  return outboundProxyTestRoutes.invoke('/api/outbound-proxy/test', response, body, request)
}

/** 路由只用到 `once('aborted')`，一个事件发射器就是完整替身。 */
function createTestRequest(): IncomingMessage {
  const request = new EventEmitter() as EventEmitter & IncomingMessage
  request.method = 'POST'
  request.url = '/api/outbound-proxy/test'
  request.headers = { host: 'localhost', 'content-type': 'application/json' } as never
  return request
}

describe('outbound proxy test route', () => {
  it('解析成功时回传目标、状态码与耗时，并销毁连接器', async () => {
    const response = mockResponse()
    const pending = invoke(validBody, response)
    const hooks = await nextHooks()
    hooks.onResponse({ statusCode: 204, resume: vi.fn() })
    await pending

    expect(payload(response).data).toMatchObject({ targetUrl: 'https://example.com/health', statusCode: 204 })
    expect(payload(response).data).toHaveProperty('durationMilliseconds')
    expect(connector.initialize).toHaveBeenCalled()
    expect(connector.destroy).toHaveBeenCalled()
  })

  it('状态码缺失时按 0 回传', async () => {
    const response = mockResponse()
    const pending = invoke(validBody, response)
    const hooks = await nextHooks()
    hooks.onResponse({ statusCode: null, resume: vi.fn() })
    await pending

    expect(payload(response).data).toMatchObject({ statusCode: 0 })
    expect(connector.destroy).toHaveBeenCalled()
  })

  it('custom 模式下非法代理地址在 schema 层被拒绝', async () => {
    await expect(invoke({ ...validBody, mode: 'custom', proxyUrl: 'not a url' })).rejects.toThrow()
    expect(connector.initialize).not.toHaveBeenCalled()
  })

  it('非 HTTP/HTTPS 的目标地址直接判定为校验错误', async () => {
    await expect(invoke({ ...validBody, targetUrl: 'ftp://example.com/file' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 })
    expect(connector.initialize).not.toHaveBeenCalled()
  })

  it('已有 AppError 原样透出', async () => {
    const pending = invoke(validBody)
    const hooks = await nextHooks()
    hooks.onError(new AppError('UPSTREAM_TIMEOUT', 504, 'timed out'))
    await expect(pending).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' })
    expect(connector.destroy).toHaveBeenCalled()
  })

  it('把代理鉴权失败分类成 OUTBOUND_PROXY_AUTH_REQUIRED', async () => {
    const pending = invoke(validBody)
    const hooks = await nextHooks()
    hooks.onError(new Error('Proxy Authentication Required (407)'))
    await expect(pending).rejects.toMatchObject({ code: 'OUTBOUND_PROXY_AUTH_REQUIRED' })
  })

  it('把隧道被拒分类成 OUTBOUND_PROXY_TUNNEL_REJECTED', async () => {
    const pending = invoke(validBody)
    const hooks = await nextHooks()
    hooks.onError(new Error('Tunnel connection failed'))
    await expect(pending).rejects.toMatchObject({ code: 'OUTBOUND_PROXY_TUNNEL_REJECTED' })
  })

  it('其余连接错误归为 OUTBOUND_PROXY_UNREACHABLE', async () => {
    const pending = invoke(validBody)
    const hooks = await nextHooks()
    hooks.onError(new Error('connect ECONNREFUSED 127.0.0.1:7890'))
    await expect(pending).rejects.toMatchObject({ code: 'OUTBOUND_PROXY_UNREACHABLE' })
  })

  it('超时回调会销毁请求并带出 504', async () => {
    const pending = invoke(validBody)
    const hooks = await nextHooks()
    hooks.onTimeout(lastRequest)
    await expect(pending).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT', statusCode: 504 })

    expect(destroyedErrors).toHaveLength(1)
    expect(destroyedErrors[0].message).toContain('timed out')
  })

  it('界面关掉之后中断探针，而不是让它把 15 秒走完', async () => {
    // 探针最长可跑 15 秒。用户点了「测试」又立刻关掉面板时，那条连接还挂在别人的代理上，
    // 而我们手里已经没有任何接收方。中断把它按 499 结算，供上一层直接丢掉。
    const request = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> }
    request.method = 'POST'
    request.url = '/api/outbound-proxy/test'
    request.headers = { host: 'localhost', 'content-type': 'application/json' }

    const pending = invoke(validBody, mockResponse(), request as never)
    await nextHooks()
    request.emit('aborted')

    await expect(pending).rejects.toMatchObject({ code: 'CLIENT_REQUEST_ABORTED', statusCode: 499 })
    expect(destroyedErrors).toHaveLength(1)
    expect(connector.destroy).toHaveBeenCalled()
  })
})
