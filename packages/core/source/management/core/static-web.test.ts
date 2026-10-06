import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStaticWebHost, type StaticWebHost } from './static-web'

// 真起一个 HTTP 服务而不是构造 `ServerResponse` 替身：这条链路里真正容易错的
// 地方是流式发送与 URL 归一化（`sendFile` 用 `createReadStream().pipe(res)`，
// 替身得把可写流实现一遍才测得准）。端口用 0，让内核分配。
let temporaryDirectory: string
let server: http.Server
let host: StaticWebHost
let baseUrl: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-static-web-'))
  fs.mkdirSync(path.join(temporaryDirectory, 'assets'))
  fs.writeFileSync(path.join(temporaryDirectory, 'index.html'), '<!doctype html><html><head><title>console</title></head><body></body></html>')
  fs.writeFileSync(path.join(temporaryDirectory, 'assets', 'app-abc123.js'), 'console.log(1)')
  fs.writeFileSync(path.join(temporaryDirectory, 'notes.txt'), 'hello')
  // 目录里的 index.html：`/docs` 这种无扩展名路径命中目录时要发它。
  fs.mkdirSync(path.join(temporaryDirectory, 'docs'))
  fs.writeFileSync(path.join(temporaryDirectory, 'docs', 'index.html'), '<!doctype html><title>docs</title>')

  host = createStaticWebHost(temporaryDirectory)
  server = http.createServer(async (req, res) => {
    const handled = await host.handle(req, res)
    if (!handled) {
      res.statusCode = 200
      res.end('api')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('createStaticWebHost', () => {
  it('serves the entry file for the root path', async () => {
    const response = await fetch(`${baseUrl}/`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    // 入口文件必须每次回源，否则升级后浏览器仍在跑旧版本。
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.text()).toContain('console')
  })

  it('falls back to the entry file for client-side routes', async () => {
    const response = await fetch(`${baseUrl}/runtime-settings`)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('console')
  })

  it('serves hashed assets with an immutable cache header', async () => {
    const response = await fetch(`${baseUrl}/assets/app-abc123.js`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('console.log(1)')
  })

  it('answers HEAD with headers but no body', async () => {
    const response = await fetch(`${baseUrl}/notes.txt`, { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String('hello'.length))
    expect(await response.text()).toBe('')
  })

  it('does not fall back to HTML when a hashed asset is missing', async () => {
    // 回退成 index.html 会让浏览器把 HTML 当 JS 解析，报出来的错完全对不上真实原因。
    const response = await fetch(`${baseUrl}/assets/missing-deadbeef.js`)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ success: false, errorCode: 'RESOURCE_NOT_FOUND' })
  })

  it('serves a directory index when one exists', async () => {
    const response = await fetch(`${baseUrl}/docs`)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('docs')
  })

  it('returns false so the api layer keeps ownership of /api paths', async () => {
    // 用真实的 socket：宿主说「不归我管」时，外面那层会把请求当成 API 处理（这里就是 200 'api'）。
    for (const pathname of ['/api', '/api/proxy/status']) {
      const response = await fetch(`${baseUrl}${pathname}`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('api')
    }
  })

  it('returns false for non GET and HEAD methods', async () => {
    const response = await fetch(`${baseUrl}/`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('api')
  })

  it('confines path traversal attempts to the web root', async () => {
    const outsideName = `osw-outside-${process.pid}.txt`
    const secret = path.join(temporaryDirectory, '..', outsideName)
    fs.writeFileSync(secret, 'secret')
    try {
      // 前两条会被 `URL` 自身归一化掉，最后一条（编码过的斜杠）只有靠 `locateFile`
      // 的「解析后仍在根目录内」校验才拦得住。
      for (const attempt of [
        `/../${outsideName}`,
        `/%2e%2e/${outsideName}`,
        `/%2e%2e%2f${outsideName}`,
        `/assets/../../${outsideName}`,
      ]) {
        const response = await fetch(`${baseUrl}${attempt}`)
        expect(await response.text()).not.toContain('secret')
        // 无扩展名路径会落到 SPA 回退（发 index.html），带扩展名的直接 404——
        // 两种都行，关键是**没有**把根目录外的文件发出去。
        expect([200, 400, 404]).toContain(response.status)
      }
    } finally {
      fs.rmSync(secret, { force: true })
    }
  })

  it('reports 404 when the entry file itself is missing', async () => {
    fs.rmSync(path.join(temporaryDirectory, 'index.html'))
    const response = await fetch(`${baseUrl}/runtime-settings`)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ success: false, errorCode: 'RESOURCE_NOT_FOUND' })
  })

  it('turns down a path it cannot even decode instead of guessing', async () => {
    // `%E0%A4%A` 是一段断在中间的 UTF-8 序列。真去猜它的意图，要么抛未捕获异常、
    // 要么把后半截当成文件名去磁盘上找——两种都不是「没有这个文件」这个事实。
    //
    // 走真实 HTTP 而不是 `mockResponse()`：`fetch` 与 Node 的解析器都会原样保留这段
    // 坏编码（`URL` 本身也不会替我们解码），于是「解不开的路径」确实是在宿主的
    // `decodeURIComponent` 那里被拦下的，而不是被请求构造过程先吃掉了。
    const response = await fetch(`${baseUrl}/assets/%E0%A4%A`)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('ignores the query string when locating a file', async () => {
    // 开发期带 `?v=...` 破缓存、带锚点跳转都很常见；查询串不是文件名的一部分。
    const response = await fetch(`${baseUrl}/notes.txt?cache-bust=1`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello')
  })
})
