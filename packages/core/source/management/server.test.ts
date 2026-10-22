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

/** 本次启动的凭证。它只是被原样往下传，所以固定值就够。 */
const TOKEN = 'test-management-token'

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

/**
 * 发一条 `Host` 由我们指定的 GET。
 *
 * 不能用 `fetch`：`Host` 是 Fetch 规范的 forbidden header，undici 会静默丢掉它并按 URL
 * 自己生成——那样请求的永远是 `127.0.0.1`，用例会「看起来通过了」但什么都没测到。
 */
async function getWithHost(baseUrl: string, pathname: string, hostHeader: string): Promise<{ status: number; body: string }> {
  const url = new URL(pathname, baseUrl)
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET', headers: { host: hostHeader } },
      response => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    request.on('error', reject)
    request.end()
  })
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
    // 凭证注入那一侧的 Host 判断归 `static-web.ts` 自己管，不在这条链路上。
    expect(mocks.applyManagementRequestGuards).not.toHaveBeenCalled()
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it('serves the console to a request whose Host is not loopback', async () => {
    // 以前这里会被 403 掉。凭证成为唯一的门之后，`Host` 不再是访问控制：前端产物
    // 本来就是公开的，挡住它只会让「用局域网 IP 打开」这种正常用法失效。真正会泄漏的
    // 是注入进入口 HTML 的凭证，那道判断收在 `static-web.ts` 里（见它的测试）。
    webHandle.mockImplementation(async (_req, res: http.ServerResponse) => {
      res.statusCode = 200
      res.end('index.html')
      return true
    })
    const { origin } = await start({ webRoot: 'C:/console', environment: 'production' })

    const response = await getWithHost(origin, '/runtime-settings', 'evil.example.com')

    expect(response.status).toBe(200)
    expect(response.body).toBe('index.html')
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

  it('hands the token to both the guard and the static host', async () => {
    const { origin } = await start({ webRoot: 'C:/console', token: TOKEN })

    // 静态托管要用它把凭证注入进 HTML，守卫要用它验每一个 API 请求：同一份值，两处都拿得到。
    expect(mocks.createStaticWebHost).toHaveBeenCalledWith('C:/console', TOKEN)

    await fetch(`${origin}/api/settings/get`, { method: 'POST' })
    expect(mocks.applyManagementRequestGuards).toHaveBeenCalledWith(expect.anything(), expect.anything(), TOKEN)
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

/*
 * 开发形态的凭证读取口。
 *
 * 这个口存在的唯一理由：无头截图是一个**另外的** Electron 进程，要驱动一个真浏览器去连
 * `pnpm dev` 那个实例，而凭证只在宿主内存里、磁盘上没有。所以三道边界必须一起断言，
 * 缺一条都会变成「生产环境上有个能白拿凭证的接口」：
 *   1. 只有 `environment === 'development'` 才应答；
 *   2. 只有宿主真的生成了凭证（`token !== null`）才应答；
 *   3. 只有非浏览器客户端能拿到（这一条由 `request-guards` 负责，不在这里重复）。
 */
describe('the development token endpoint', () => {
  it('answers with the token in development', async () => {
    const { origin } = await start({ environment: 'development', token: TOKEN })

    const response = await fetch(`${origin}/api/development/management-token`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { token: TOKEN } })
    // 它是旁路，不该顺路把真实路由也跑一遍。
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it('never answers outside development', async () => {
    // 生产形态下这条路径必须不存在。断言到「没走到这条路」为止，而不是只看状态码：
    // 路由层回 404 与这里有意的静默是两件不同的事，混淆会让以后有人顺手放宽环境判断。
    const { origin } = await start({ environment: 'production', token: TOKEN })

    const response = await fetch(`${origin}/api/development/management-token`, { method: 'POST' })

    expect(response.status).toBe(200) // 落到被替身的路由，真实路由会回 404
    expect(mocks.handleApiRequest).toHaveBeenCalled()
  })

  it('falls through when the host did not hand over a token', async () => {
    // 没有凭证时回一份 `token: null` 更糟：调用方会以为「宿主这次没生成」，
    // 带着空凭证去撞 401，而真正的原因（这条路径根本没开）就被掩掉了。
    const { origin } = await start({ environment: 'development', token: null })

    const response = await fetch(`${origin}/api/development/management-token`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(mocks.handleApiRequest).toHaveBeenCalled()
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
