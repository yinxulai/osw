import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { callManagementApi, isPortListening } from './management-client'

/**
 * 管理 API 客户端。
 *
 * 它是 `stop` 与 `status` 判断「另一个进程怎么了」的唯一手段，而那两个命令的下一步动作完全
 * 取决于**三态**里的哪一态（连不上 / 被拒绝 / 成功）——把这三种压成一个异常，
 * `stop` 就没法区分「该清理失效的运行时文件」和「该报错退出」。所以这里逐态钉死。
 *
 * 不 mock `fetch`：真正跑一个回环 HTTP 服务。客户端要处理的是「响应形状不对」「不是 JSON」
 * 「端口没人听」「对面不回话」这类**传输层事实**，钉在 mock 上只能测出我对 fetch 的想象。
 */

const servers: http.Server[] = []

/** 起一个回环服务，把「收到什么」记下来，返回端口。 */
async function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ port: number; requests: Array<{ method: string; url: string; body: string }> }> {
  const requests: Array<{ method: string; url: string; body: string }> = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') })
      handler(req, res)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as AddressInfo).port, requests }
}

/** 一个没人监听的端口：先占住再放开，操作系统不会立刻把它分给别人。 */
async function closedPort(): Promise<number> {
  const server = http.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('callManagementApi', () => {
  it('posts JSON and unwraps the data of a successful response', async () => {
    const { port, requests } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: true, data: { running: true, port: 9300 } }))
    })

    const result = await callManagementApi({ host: '127.0.0.1', port, path: '/api/proxy/status', body: { probe: 1 } })

    expect(result).toEqual({ ok: true, data: { running: true, port: 9300 } })
    // 管理 API 全是 POST + JSON；改掉任一条，服务端会拿不到 body。
    expect(requests).toEqual([{ method: 'POST', url: '/api/proxy/status', body: '{"probe":1}' }])
  })

  it('sends an empty object when no body is given', async () => {
    // 服务端一律按 JSON 解析 body：漏发 body 会让它拿到空串而不是一个对象。
    const { port, requests } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: true, data: null }))
    })

    await callManagementApi({ host: '127.0.0.1', port, path: '/api/proxy/status' })

    expect(requests[0]!.body).toBe('{}')
  })

  it('connects to loopback when the listen host is a wildcard', async () => {
    // 传进来的是服务端自报的**监听地址**，`0.0.0.0` 不是能连过去的地址。
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: true, data: 'ok' }))
    })

    const result = await callManagementApi({ host: '0.0.0.0', port, path: '/api/proxy/status' })

    expect(result).toEqual({ ok: true, data: 'ok' })
  })

  it('reports a non-success payload as rejected rather than success', async () => {
    // 200 但 `success: false`：管理 API 的响应体固定是 `ApiResponse`，
    // 拿到别的形状就说明对面不是我们的服务，不能把 `data` 当结果用。
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: false, errorCode: 'VALIDATION_ERROR', errorMessage: 'nope' }))
    })

    expect(await callManagementApi({ host: '127.0.0.1', port, path: '/api/proxy/start' })).toEqual({
      ok: false,
      reason: 'rejected',
      status: 200,
    })
  })

  it('reports a success flag that is missing or not boolean as rejected', async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      // `success: 'true'` 是字符串：只认布尔真值，别被真值语义放进来。
      res.end(JSON.stringify({ success: 'true', data: { running: true } }))
    })

    expect(await callManagementApi({ host: '127.0.0.1', port, path: '/api/x' })).toMatchObject({ ok: false, reason: 'rejected' })
  })

  it('carries the HTTP status through when the server refuses', async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: false, errorCode: 'INTERNAL_ERROR', errorMessage: 'boom' }))
    })

    expect(await callManagementApi({ host: '127.0.0.1', port, path: '/api/proxy/status' })).toEqual({
      ok: false,
      reason: 'rejected',
      status: 500,
    })
  })

  it('reports a body that is not JSON as rejected instead of throwing', async () => {
    // 端口上坐着的可能是个别的服务（静态托管、别人的 dev server）。
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>not our service</html>')
    })

    expect(await callManagementApi({ host: '127.0.0.1', port, path: '/api/proxy/status' })).toMatchObject({
      ok: false,
      reason: 'rejected',
    })
  })

  it('reports a connection that nobody answers as unreachable', async () => {
    const port = await closedPort()

    expect(await callManagementApi({ host: '127.0.0.1', port, path: '/api/proxy/status' })).toEqual({
      ok: false,
      reason: 'unreachable',
    })
  })

  it('reports a server that never replies as unreachable instead of hanging', async () => {
    // 卡住不返回比报一句「没实例响应」难用得多，所以超时按「连不上」处理。
    const { port } = await startServer(() => {
      // 故意不回：连接建立后就晾着。
    })

    const started = Date.now()
    const result = await callManagementApi({ host: '127.0.0.1', port, path: '/api/proxy/status', timeoutMilliseconds: 150 })

    expect(result).toEqual({ ok: false, reason: 'unreachable' })
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describe('isPortListening', () => {
  it('is true when something is listening there', async () => {
    const { port } = await startServer((_req, res) => res.end())

    expect(await isPortListening('127.0.0.1', port)).toBe(true)
  })

  it('is false when nothing is listening', async () => {
    // 「端口根本没起来」与「端口在听但不回话」给用户的下一步完全不同。
    expect(await isPortListening('127.0.0.1', await closedPort())).toBe(false)
  })

  it('is false when the connection goes nowhere', async () => {
    // 用 RFC 2606 保留的 `.invalid` 域名：解析必定失败，`net.connect` 会走到 error 分支。
    // 不要改用「保留 IP 段」（如 192.0.2.1）来造不可达——那只是**通常**不可路由，
    // 装了 TUN/透明代理的机器会照单全收，用例就随环境飘了（本仓库踩过）。
    expect(await isPortListening('osw-unreachable.invalid', 9300, 200)).toBe(false)
  })

  it('normalizes a wildcard listen address before connecting', async () => {
    const { port } = await startServer((_req, res) => res.end())

    expect(await isPortListening('0.0.0.0', port)).toBe(true)
  })
})

describe('timeouts', () => {
  it('gives up when the reply arrives after the timeout, and reports it as unreachable', async () => {
    // 「回话太慢」与「不回话」在调用方看来是同一件事：这个实例现在没法用。
    // 两者都必须落成 `unreachable`，而不是抛出去——`stop` 靠这个三元结果决定下一步。
    const { port } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: 1 }))
      }, 400)
    })

    const result = await callManagementApi({ host: '127.0.0.1', port, path: '/api/x', timeoutMilliseconds: 100 })

    expect(result).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('does not cut off a reply that arrives inside the timeout', async () => {
    const { port } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: 'in time' }))
      }, 50)
    })

    expect(await callManagementApi({ host: '127.0.0.1', port, path: '/api/x', timeoutMilliseconds: 2_000 })).toEqual({
      ok: true,
      data: 'in time',
    })
  })
})
