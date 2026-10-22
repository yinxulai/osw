import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConsoleHost, type ConsoleHost } from './console-host'

/**
 * 控制台静态托管。
 *
 * 真起 HTTP 服务而不是构造 `ServerResponse` 替身：这条链路里真正容易错的地方是流式发送
 * 与 URL 归一化（`sendFile` 用 `createReadStream().pipe(res)`），替身得把可写流实现一遍
 * 才测得准。端口用 0，让内核分配。
 */

let temporaryDirectory: string
let host: ConsoleHost
let server: http.Server
let baseUrl: string
/** 带凭证的用例各起一个服务；`afterEach` 要一并关掉。 */
const extraServers: http.Server[] = []

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-console-host-'))
  fs.mkdirSync(path.join(temporaryDirectory, 'assets'))
  fs.writeFileSync(path.join(temporaryDirectory, 'index.html'), '<!doctype html><html><head><title>console</title></head><body></body></html>')
  fs.writeFileSync(path.join(temporaryDirectory, 'assets', 'app-abc123.js'), 'console.log(1)')
  fs.writeFileSync(path.join(temporaryDirectory, 'notes.txt'), 'hello')
  // 目录里的 index.html：`/docs` 这种无扩展名路径命中目录时要发它。
  fs.mkdirSync(path.join(temporaryDirectory, 'docs'))
  fs.writeFileSync(path.join(temporaryDirectory, 'docs', 'index.html'), '<!doctype html><title>docs</title>')

  host = createConsoleHost(temporaryDirectory, null)
  server = await listenWith(host)
  baseUrl = originOf(server)
})

afterEach(async () => {
  await Promise.all([server, ...extraServers.splice(0)].map(next => new Promise<void>(resolve => next.close(() => resolve()))))
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function originOf(target: http.Server): string {
  const address = target.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  return `http://127.0.0.1:${address.port}`
}

/** 一个真实的 HTTP 服务：托管说「不归我管」时，外面这层把请求当成 API 处理（200 `api`）。 */
async function listenWith(consoleHost: ConsoleHost): Promise<http.Server> {
  const next = http.createServer(async (req, res) => {
    if (!await consoleHost.handle(req, res)) {
      res.statusCode = 200
      res.end('api')
    }
  })
  await new Promise<void>(resolve => next.listen(0, '127.0.0.1', resolve))
  return next
}

async function startWithToken(token: string): Promise<string> {
  const next = await listenWith(createConsoleHost(temporaryDirectory, token))
  extraServers.push(next)
  return originOf(next)
}

/**
 * 发一条 `Host` 由我们指定的 GET。
 *
 * 不能用 `fetch`：`Host` 是 Fetch 规范的 forbidden header，undici 会静默丢掉它并按 URL
 * 自己生成——那样测的永远是 `127.0.0.1`，用例会「看起来通过了」但什么都没测到。
 */
async function getWithHost(baseUrlValue: string, pathname: string, hostHeader: string): Promise<string> {
  const url = new URL(pathname, baseUrlValue)
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET', headers: { host: hostHeader } },
      response => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      },
    )
    request.on('error', reject)
    request.end()
  })
}

describe('serving files', () => {
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

  it('hands /api paths back to the api layer', async () => {
    // 用真实的 socket：托管说「不归我管」时，外面那层把请求当成 API 处理。
    for (const pathname of ['/api', '/api/proxy/status']) {
      const response = await fetch(`${baseUrl}${pathname}`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('api')
    }
  })

  it('hands non GET and HEAD methods back to the api layer', async () => {
    const response = await fetch(`${baseUrl}/`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('api')
  })

  it('confines path traversal attempts to the web root', async () => {
    const outsideName = `osw-outside-${process.pid}.txt`
    const secret = path.join(temporaryDirectory, '..', outsideName)
    fs.writeFileSync(secret, 'secret')
    try {
      // 前两条会被 `URL` 自身归一化掉，最后两条（编码过的斜杠）只有靠 `locateFile`
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

/*
 * 凭证注入。
 *
 * 管理 API 要凭证，而 `--web` 形态下页面是从这个端口拿到的，没有别的渠道能把它交给页面。
 * 所以凭证随入口 HTML 一起下发：同源的页面才拿得到，带 `no-cache` 就不会被缓存下来。
 */
describe('runtime config injection', () => {
  const TOKEN = 'injected-management-token'

  it('injects the token into the entry file only', async () => {
    const tokenized = await startWithToken(TOKEN)

    const entry = await fetch(`${tokenized}/`)
    const html = await entry.text()
    expect(html).toContain(`window.__OSW__={apiToken:"${TOKEN}"}`)
    // 插在 `</head>` 之前：`boot.js` 这种首帧脚本要先跑，注入的配置不参与首帧。
    expect(html.indexOf('window.__OSW__')).toBeLessThan(html.indexOf('</head>'))
    expect(html).toContain('<title>console</title>')
    // 内容变了，长度也必须跟着变，否则浏览器会按旧长度截断或挂住。
    expect(entry.headers.get('content-length')).toBe(String(Buffer.byteLength(html)))

    // 静态资源原样发出：它们不需要凭证，也不该被改写（否则内容哈希就失效了）。
    const asset = await fetch(`${tokenized}/assets/app-abc123.js`)
    expect(await asset.text()).toBe('console.log(1)')
  })

  it('injects into the SPA fallback and directory indexes too', async () => {
    const tokenized = await startWithToken(TOKEN)

    // 前端路由回退的也是入口文件；目录 index 同样是别的入口，都要带上凭证。
    for (const pathname of ['/runtime-settings', '/docs']) {
      const html = await (await fetch(`${tokenized}${pathname}`)).text()
      expect(html).toContain(`window.__OSW__={apiToken:"${TOKEN}"}`)
    }
  })

  it('reports the injected length on HEAD without sending a body', async () => {
    const tokenized = await startWithToken(TOKEN)

    const response = await fetch(`${tokenized}/`, { method: 'HEAD' })

    // HEAD 不带正文，但 `Content-Length` 必须是注入后的长度：浏览器会拿它当 GET 的预期。
    const get = await fetch(`${tokenized}/`)
    expect(response.headers.get('content-length')).toBe(get.headers.get('content-length'))
    expect(await response.text()).toBe('')
  })

  it('leaves the entry file untouched when no token is configured', async () => {
    // 桌面形态用 `loadFile` 加载产物，凭证由 preload 注入，这里的 `token` 就是 null。
    const response = await fetch(`${baseUrl}/`)

    expect(await response.text()).not.toContain('window.__OSW__')
  })

  it('withholds the token from a request whose Host is not loopback', async () => {
    // DNS rebinding：攻击者的域名解析到 127.0.0.1，浏览器就认为那个页面与本服务同源，
    // 于是它读得到入口 HTML——包括里面那行凭证。`Host` 是页面上唯一改不动的东西。
    // 这里不拒绝请求（前端产物本来就是公开的），只是不把凭证交给它。
    const tokenized = await startWithToken(TOKEN)

    const html = await getWithHost(tokenized, '/', 'evil.example.com')

    expect(html).not.toContain('window.__OSW__')
    expect(html).toContain('<title>console</title>')
  })

  it('withholds the token from the SPA fallback when the Host is not loopback', async () => {
    // 前端路由回退发的也是入口文件，漏掉这条就等于把凭证从后门递出去。
    const tokenized = await startWithToken(TOKEN)

    const html = await getWithHost(tokenized, '/runtime-settings', 'evil.example.com')

    expect(html).not.toContain('window.__OSW__')
    expect(html).toContain('<title>console</title>')
  })

  it('still hands the token to the IPv6 loopback Host', async () => {
    // `[::1]:19301` 是最容易在手写解析里出错的一种回环写法；它必须拿到凭证。
    const tokenized = await startWithToken(TOKEN)

    const html = await getWithHost(tokenized, '/', '[::1]:19301')

    expect(html).toContain(`window.__OSW__={apiToken:"${TOKEN}"}`)
  })
})
