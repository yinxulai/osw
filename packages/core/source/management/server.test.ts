import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import { startManagementServer, stopManagementServer, type ManagementServerOptions } from './server'

/**
 * 管理服务的生命周期与请求边界。
 *
 * 三个协作者——静态托管、请求守卫、API 路由——各自有自己的测试，这里替身掉它们，
 * 只盯 `server.ts` 自己负责的那几件事：**谁先接手一个请求**、成功/失败各留什么级别的日志、
 * 请求边界上的异常是回一份 4xx/5xx 还是直接掐掉连接，以及启停的幂等性。
 * 监听用真实的 `http.Server`（端口 0）：要被验的正是 listen / close 这段真实行为。
 */

const mocks = vi.hoisted(() => ({
  createStaticWebHost: vi.fn(),
  applyManagementRequestGuards: vi.fn(),
  handleApiRequest: vi.fn(),
}))

vi.mock('./core/static-web', () => ({ createStaticWebHost: mocks.createStaticWebHost }))
vi.mock('./core/request-guards', () => ({ applyManagementRequestGuards: mocks.applyManagementRequestGuards }))
vi.mock('./router', () => ({ handleApiRequest: mocks.handleApiRequest }))

/** 被替身的静态托管：`handle` 的结果决定这条请求是否已经在它那里结束。 */
let webHandle: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  webHandle = vi.fn(async () => false)
  mocks.createStaticWebHost.mockReset()
  mocks.createStaticWebHost.mockReturnValue({ root: 'C:/console', handle: webHandle })
  mocks.applyManagementRequestGuards.mockReset()
  mocks.applyManagementRequestGuards.mockResolvedValue(true)
  mocks.handleApiRequest.mockReset()
  mocks.handleApiRequest.mockImplementation(async (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.statusCode = 200
    res.end('ok')
  })
})

afterEach(async () => {
  await stopManagementServer()
  vi.restoreAllMocks()
})

async function start(options: ManagementServerOptions = {}): Promise<{ server: http.Server; origin: string }> {
  const server = await startManagementServer({ host: '127.0.0.1', port: 0, ...options })
  const address = server.address() as AddressInfo
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

describe('startManagementServer', () => {
  it('starts a real server and hands the same one back on a second call', async () => {
    const server = await startManagementServer({ host: '127.0.0.1', port: 0 })

    expect(server.listening).toBe(true)
    // 重复调用必须复用：宿主在启动流程里可能多处触发，第二次再 listen 会撞 EADDRINUSE。
    await expect(startManagementServer({ host: '127.0.0.1', port: 0 })).resolves.toBe(server)
  })

  it('shares one in-flight startup instead of racing two listens', async () => {
    const first = startManagementServer({ host: '127.0.0.1', port: 0 })
    const second = startManagementServer({ host: '127.0.0.1', port: 0 })

    // 同一个 promise 对象：并发调用不会各自 createServer。
    expect(second).toBe(first)
    await expect(first).resolves.toBe(await second)
  })

  it('rejects a port it cannot bind and forgets the failed attempt', async () => {
    const blocker = http.createServer()
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve))
    const occupied = (blocker.address() as AddressInfo).port

    try {
      await expect(startManagementServer({ host: '127.0.0.1', port: occupied })).rejects.toMatchObject({ code: 'EADDRINUSE' })
      // 失败不能留下一个「半开着」的引用：下一次启动必须能拿到新端口。
      await expect(startManagementServer({ host: '127.0.0.1', port: 0 })).resolves.toMatchObject({ listening: true })
    } finally {
      await new Promise<void>(resolve => blocker.close(() => resolve()))
    }
  })
})

describe('request boundary', () => {
  it('lets the static host take a request first, and stops there', async () => {
    webHandle.mockImplementation(async (_req, res: http.ServerResponse) => {
      res.statusCode = 200
      res.end('index.html')
      return true
    })
    const { origin } = await start({ webRoot: 'C:/console', environment: 'production' })

    const response = await fetch(`${origin}/runtime-settings`)

    expect(await response.text()).toBe('index.html')
    // 静态托管的 SPA 回退必须拿到未被改写过的请求，所以它在守卫与路由之前。
    expect(mocks.applyManagementRequestGuards).not.toHaveBeenCalled()
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it('does not create a static host when no web root is given', async () => {
    const { origin } = await start({ environment: 'production' })

    const response = await fetch(`${origin}/api/anything`, { method: 'POST' })

    expect(await response.text()).toBe('ok')
    expect(mocks.createStaticWebHost).not.toHaveBeenCalled()
  })

  it('stops at the guard when it turns the request down, and logs it as a warning', async () => {
    mocks.applyManagementRequestGuards.mockImplementation(async (_req, res: http.ServerResponse) => {
      res.statusCode = 404
      res.end('not found')
      return false
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { origin } = await start({ environment: 'production' })

    const response = await fetch(`${origin}/not-an-api-path`)

    expect(response.status).toBe(404)
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('handled by guard'))
  })

  it('logs a rejected preflight at debug, not as a warning', async () => {
    // 浏览器对每个跨源请求都会先问一次 OPTIONS。把它记成 warn 会让日志里全是
    // 这条预期之内的拒绝，真正的问题被淹掉。
    mocks.applyManagementRequestGuards.mockImplementation(async (_req, res: http.ServerResponse) => {
      res.statusCode = 204
      res.end()
      return false
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const { origin } = await start({ environment: 'production' })

    await fetch(`${origin}/api/settings/get`, { method: 'OPTIONS' })

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('handled by guard'))
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes the configured environment down to the API layer', async () => {
    const { origin } = await start({ environment: 'development' })

    await fetch(`${origin}/api/settings/get`, { method: 'POST' })

    expect(mocks.handleApiRequest).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'development')
  })

  it('marks a 5xx as an error and a 4xx as a warning', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { origin } = await start({ environment: 'production' })

    mocks.handleApiRequest.mockImplementation(async (_req, res: http.ServerResponse) => {
      res.statusCode = 503
      res.end('nope')
    })
    await fetch(`${origin}/api/broken`, { method: 'POST' })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('status=503'))

    mocks.handleApiRequest.mockImplementation(async (_req, res: http.ServerResponse) => {
      res.statusCode = 400
      res.end('bad')
    })
    await fetch(`${origin}/api/wrong`, { method: 'POST' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('status=400'))
  })

  it('warns about a slow request even when it succeeded', async () => {
    // 一个 200 但花了 20 秒的请求，在用户那里和失败没有区别；只按状态码分级会把它藏起来。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let clock = 0
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    mocks.handleApiRequest.mockImplementation(async (_req, res: http.ServerResponse) => {
      clock = 20_000
      res.statusCode = 200
      res.end('slow')
    })
    const { origin } = await start({ environment: 'production' })

    await fetch(`${origin}/api/slow`, { method: 'POST' })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duration=20000ms'))
  })

  it('answers a request-boundary failure with a real error response', async () => {
    mocks.applyManagementRequestGuards.mockRejectedValue(new AppError('VALIDATION_ERROR', 400, 'bad host header'))
    const { origin } = await start({ environment: 'production' })

    const response = await fetch(`${origin}/api/settings/get`, { method: 'POST' })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('hangs up instead of writing a second response once headers are out', async () => {
    // 已经在往下流的时候再 `sendError` 只会抛 ERR_HTTP_HEADERS_SENT，把真实原因盖掉。
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.handleApiRequest.mockImplementation(async (_req, res: http.ServerResponse) => {
      res.statusCode = 200
      res.write('partial')
      throw new Error('upstream died mid-body')
    })
    const { origin } = await start({ environment: 'production' })

    await expect(fetch(`${origin}/api/streamed`, { method: 'POST' })).rejects.toThrow()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('request boundary failed'), expect.anything())
  })
})

describe('stopManagementServer', () => {
  it('waits for an in-flight startup and then closes the listener', async () => {
    const pending = startManagementServer({ host: '127.0.0.1', port: 0 })

    // 同一 tick 里就要求停：启动还在路上，不能因为「还没 listening」就跳过关闭，
    // 否则端口会一直开着，下一次启动直接 EADDRINUSE。
    await stopManagementServer()

    expect((await pending).listening).toBe(false)
  })

  it('is a no-op when nothing is running', async () => {
    await expect(stopManagementServer()).resolves.toBeUndefined()
    await expect(stopManagementServer()).resolves.toBeUndefined()
  })

  it('releases the port so a later start can bind the same one', async () => {
    const server = await startManagementServer({ host: '127.0.0.1', port: 0 })
    const port = (server.address() as AddressInfo).port

    await stopManagementServer()

    const restarted = await startManagementServer({ host: '127.0.0.1', port })
    expect((restarted.address() as AddressInfo).port).toBe(port)
  })
})
