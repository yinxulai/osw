import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import { startManagementServer, stopManagementServer, type ManagementServerOptions } from './server'

/**
 * 管理服务的**生命周期**与**日志分级**。
 *
 * 访问控制、静态托管、开发路径这些判断都不在这里，它们归 `./gateway.ts` 及其测试。这里
 * 只盯三件 `server.ts` 自己负责的事：listen / close 的幂等性，写不下去时的兜底，以及一条
 * 请求跑完之后记成什么级别——它明明只影响日志，却和访问控制写在同一段 `if` 里很久。
 *
 * 监听用真实的 `http.Server`（端口 0），请求也真的发出去：要被验的正是 listen / close
 * 这段真实行为。唯一被替身的是路由，因为它会连数据库。
 */

const mocks = vi.hoisted(() => ({ handleApiRequest: vi.fn() }))

vi.mock('./router', () => ({ handleApiRequest: mocks.handleApiRequest }))

let temporaryDirectory: string | null = null

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  mocks.handleApiRequest.mockReset()
  mocks.handleApiRequest.mockImplementation(async (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.statusCode = 200
    res.end('ok')
  })
})

afterEach(async () => {
  await stopManagementServer()
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = null
  vi.restoreAllMocks()
})

async function start(options: ManagementServerOptions = {}): Promise<{ server: http.Server; origin: string }> {
  const server = await startManagementServer({ host: '127.0.0.1', port: 0, ...options })
  const address = server.address() as AddressInfo
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

/** 一份最小的控制台产物目录，用于验证「静态托管确实排在所有门之前」。 */
function createWebRoot(): string {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-server-'))
  fs.writeFileSync(path.join(temporaryDirectory, 'index.html'), '<!doctype html><html><head></head><body>console</body></html>')
  return temporaryDirectory
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

describe('the request boundary', () => {
  it('serves the console before any access check runs', async () => {
    // 页面必须能从自己的端口加载，所以静态托管排在凭证之前——否则命令行 `--web` 形态
    // 连登录页都打不开。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { origin } = await start({ webRoot: createWebRoot(), token: 'test-management-token' })

    const response = await fetch(`${origin}/runtime-settings`)

    expect(await response.text()).toContain('console')
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs a plain success at debug', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const { origin } = await start({ environment: 'production' })

    await fetch(`${origin}/api/settings/get`, { method: 'POST' })

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('outcome=api'))
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('status=200'))
  })

  it('logs the step a rejected request stopped at, as a warning', async () => {
    // 日志里必须能看出「它没走到路由」，否则一个 404 到底是路径不对还是路由没实现
    // 就只能靠猜。拒绝只打一条 completed，不该再补一条 debug 把同一件事说两遍。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const { origin } = await start({ environment: 'production' })

    const response = await fetch(`${origin}/not-an-api-path`)

    expect(response.status).toBe(404)
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('outcome=rejected'))
    expect(debug).not.toHaveBeenCalledWith(expect.stringContaining('outcome=rejected'))
  })

  it('logs a rejected preflight at debug, not as a warning', async () => {
    // 浏览器对每个跨源请求都会先问一次 OPTIONS。把它记成 warn 会让日志里全是
    // 这条预期之内的拒绝，真正的问题被淹掉。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const { origin } = await start({ environment: 'production' })

    const response = await fetch(`${origin}/api/settings/get`, { method: 'OPTIONS' })

    expect(response.status).toBe(204)
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('outcome=rejected'))
    expect(warn).not.toHaveBeenCalled()
  })

  it('marks a 5xx as an error and a 4xx as a warning', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { origin } = await start({ environment: 'production' })

    mocks.handleApiRequest.mockImplementation(async (_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.statusCode = 503
      res.end('nope')
    })
    await fetch(`${origin}/api/broken`, { method: 'POST' })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('status=503'))

    mocks.handleApiRequest.mockImplementation(async (_req: http.IncomingMessage, res: http.ServerResponse) => {
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
    mocks.handleApiRequest.mockImplementation(async (_req: http.IncomingMessage, res: http.ServerResponse) => {
      clock = 20_000
      res.statusCode = 200
      res.end('slow')
    })
    const { origin } = await start({ environment: 'production' })

    await fetch(`${origin}/api/slow`, { method: 'POST' })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duration=20000ms'))
  })

  it('answers a request-boundary failure with a real error response', async () => {
    mocks.handleApiRequest.mockRejectedValue(new AppError('VALIDATION_ERROR', 400, 'bad request body'))
    const { origin } = await start({ environment: 'production' })

    const response = await fetch(`${origin}/api/settings/get`, { method: 'POST' })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('hangs up instead of writing a second response once headers are out', async () => {
    // 已经在往下流的时候再 `sendError` 只会抛 `ERR_HTTP_HEADERS_SENT`，把真实原因盖掉。
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.handleApiRequest.mockImplementation(async (_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.statusCode = 200
      res.write('partial')
      throw new Error('upstream died mid-body')
    })
    const { origin } = await start({ environment: 'production' })

    // 响应头已经发出去了，所以 `fetch` 本身会成功；断开发生在读 body 的时候。
    await expect(fetch(`${origin}/api/streamed`, { method: 'POST' }).then(response => response.text())).rejects.toThrow()
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
