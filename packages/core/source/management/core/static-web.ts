/**
 * 控制台静态托管。
 *
 * 只做一件事：把宿主编好的一堆静态文件按 HTTP 语义发出去。**根目录由宿主给**
 * （App 给 asar 里的路径，CLI 给自己 `output/web`），这里不猜、也不写死任何路径——
 * core 是函数库，不该知道宿主把前端产物放在了哪儿。
 *
 * SPA 回退规则：带扩展名的路径（`/assets/x.js`）找不到就是 404，不回退。回退成
 * `index.html` 会让浏览器把 HTML 当 JS 解析，报出来的错完全对不上真实原因。
 *
 * 托管是**唯一**一种「页面从管理服务自己的端口加载」的形态（命令行 `--web`）。这时页面与
 * API 同源，但同源并不意味着能读到响应——管理 API 仍然要凭证（见 `../token.ts`），所以
 * 入口文件在被送出之前会被注入一行 `window.__OSW__`，把这次的凭证交给页面。
 * 桌面形态不走这里（它 `loadFile` 加载产物，凭证由 preload 注入），所以注入是可选参数。
 *
 * ## 注入有条件：`Host` 必须是回环
 *
 * 这是整条链路上**唯一**还看 `Host` 的地方，理由很具体：DNS rebinding 的页面（攻击者的
 * 域名解析到 `127.0.0.1`）在浏览器眼里与本服务同源，于是它读得到本服务发回的任意响应体
 * ——包括这段注入了凭证的 HTML。`Host` 是页面上唯一改不动的东西，那种请求带的是攻击者
 * 的域名。
 *
 * 非回环 `Host` 仍然拿得到页面（它本来就是公开的前端产物），只是**不带**凭证：后续每条
 * API 调用都会 `401`。换句话说，这里不拒绝请求，只是不把秘密交给它。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { hasLoopbackHost } from './loopback-host'
import { sendError } from './response'
import type { IncomingMessage, ServerResponse } from 'node:http'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

/** 带扩展名的路径按资源处理：找不到就 404，不做 SPA 回退。 */
const HAS_EXTENSION = /\.[a-z0-9]+$/i

export interface StaticWebHost {
  /** 静态产物根目录（绝对路径）。 */
  readonly root: string
  /**
   * 尝试用静态产物响应这条请求。
   *
   * 返回 `true` 表示已响应（或已写出错误），调用方不要再往下走；返回 `false`
   * 表示这条请求不归静态托管管（`/api/*`、非 GET/HEAD），交回 API 链路。
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
}

export function createStaticWebHost(webRoot: string, token: string | null = null): StaticWebHost {
  const root = path.resolve(webRoot)
  const indexFile = path.join(root, 'index.html')

  return {
    root,
    async handle(req, res) {
      const method = req.method ?? 'GET'
      if (method !== 'GET' && method !== 'HEAD') return false

      const pathname = resolvePathname(req.url)
      if (pathname === null) {
        sendError(res, 'VALIDATION_ERROR', 'Malformed request path', 400)
        return true
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) return false

      // 凭证只交给「奔着回环来的」请求，理由见文件头注释。判断在**每次请求**上做，
      // 不能放到 `createStaticWebHost` 里——那样就把一个 per-request 的事实冻成了启动配置。
      const tokenForRequest = hasLoopbackHost(req) ? token : null

      const file = locateFile(root, pathname)
      if (file) {
        await sendFile(res, file, method === 'HEAD', tokenForRequest)
        return true
      }

      if (HAS_EXTENSION.test(pathname)) {
        console.warn(`[static-web] asset not found root=${root} path=${pathname}`)
        sendError(res, 'RESOURCE_NOT_FOUND', `Static asset not found: ${pathname}`, 404, { path: pathname })
        return true
      }

      // 前端路由（`/runtime-settings` 这类）由前端自己处理，交给 index.html。
      await sendFile(res, indexFile, method === 'HEAD', tokenForRequest)
      return true
    },
  }
}

/** 取 URL 的 pathname 并解码；解码失败说明 URL 本身是坏的，返回 `null`。 */
function resolvePathname(rawUrl: string | undefined): string | null {
  try {
    const url = new URL(rawUrl ?? '/', 'http://localhost')
    return decodeURIComponent(url.pathname)
  } catch {
    return null
  }
}

/**
 * 把 URL 路径映射到磁盘文件。
 *
 * `path.resolve` 之后必须再确认仍在根目录内：`/../../etc/passwd` 这类路径在解析阶段
 * 就会被 `URL` 归一化，但编码过的变体（`%2e%2e%2f`）不会，所以这里必须自己验。
 */
function locateFile(root: string, pathname: string): string | null {
  const candidate = path.resolve(root, `.${pathname}`)
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null

  const stat = statOrNull(candidate)
  if (stat?.isFile()) return candidate
  if (stat?.isDirectory()) {
    const directoryIndex = path.join(candidate, 'index.html')
    if (statOrNull(directoryIndex)?.isFile()) return directoryIndex
  }
  return null
}

function statOrNull(target: string): fs.Stats | null {
  try {
    return fs.statSync(target)
  } catch {
    return null
  }
}

async function sendFile(res: ServerResponse, file: string, headOnly: boolean, token: string | null = null): Promise<void> {
  const stat = statOrNull(file)
  if (!stat?.isFile()) {
    console.error(`[static-web] index file is missing file=${file}`)
    sendError(res, 'RESOURCE_NOT_FOUND', 'Static asset not found', 404)
    return
  }

  const isEntry = path.extname(file).toLowerCase() === '.html' && path.basename(file) === 'index.html'
  const injected = isEntry && token ? await injectRuntimeConfig(file, token) : null

  res.statusCode = 200
  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('Content-Length', String(injected === null ? stat.size : Buffer.byteLength(injected)))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // 产物带内容哈希，可以长缓存；入口文件必须每次回源，否则升级后浏览器仍在跑旧版本。
  res.setHeader('Cache-Control', isHashedAsset(file) ? 'public, max-age=31536000, immutable' : 'no-cache')

  if (headOnly) {
    res.end()
    return
  }

  // 注入了凭证就不能再流式转发（长度和内容都变了），整份读出来再写。
  if (injected !== null) {
    res.end(injected)
    return
  }

  await new Promise<void>(resolve => {
    const stream = createReadStream(file)
    stream.on('error', error => {
      console.error(`[static-web] read failed file=${file}`, error)
      if (res.headersSent) res.destroy(error)
      else sendError(res, 'INTERNAL_ERROR', 'Failed to read static asset', 500)
      resolve()
    })
    stream.on('end', resolve)
    stream.pipe(res)
  })
}

/**
 * 在入口 HTML 里补一行 `window.__OSW__`。
 *
 * 插在 `</head>` 之前而不是开头：`public/boot.js`（决定首帧主题与语言）是 `<head>` 里的
 * 同步脚本，让它先跑，注入的配置只是给应用用的，不参与首帧。
 *
 * 值用 `JSON.stringify` 序列化——凭证是 base64url，理论上不需要转义，但这里不依赖
 * 「凭证恰好是安全的字符」这个巧合。
 */
async function injectRuntimeConfig(file: string, token: string): Promise<string | null> {
  try {
    const html = await fs.promises.readFile(file, 'utf8')
    const snippet = `<script>window.__OSW__={apiToken:${JSON.stringify(token)}}</script>`
    const headEnd = html.lastIndexOf('</head>')
    if (headEnd === -1) return `${snippet}\n${html}`
    return `${html.slice(0, headEnd)}${snippet}\n${html.slice(headEnd)}`
  } catch (error) {
    // 读不出来就退回原始流式响应：页面照常打开，只是 API 调用会 401，
    // 这比「首页打不开」更容易被用户看懂，也不掩盖真正的问题。
    console.error(`[static-web] inject failed file=${file}`, error)
    return null
  }
}

function isHashedAsset(file: string): boolean {
  return path.basename(path.dirname(file)) === 'assets'
}
