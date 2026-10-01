import http from 'node:http'
import { handleApiRequest } from './router'
import { applyManagementRequestGuards } from './core/request-guards'
import { createStaticWebHost, type StaticWebHost } from './core/static-web'
import { normalizeError } from '@server/errors'
import { sendManagementError } from './core/response'
import type { Server } from 'node:http'
import type { RuntimeEnvironment } from '@common/runtime-profile'

export interface ManagementServerOptions {
  host?: string
  port?: number
  environment?: RuntimeEnvironment
  /**
   * 控制台静态产物根目录。给了才托管；桌面形态自己 `loadFile`，不走这里。
   * 路径由宿主决定，core 不猜（见 `apps/docs/product/packaging.md` §5.2）。
   */
  webRoot?: string | null
}

let managementServer: Server | null = null
let startupPromise: Promise<Server> | null = null

export function startManagementServer(options: ManagementServerOptions = {}): Promise<Server> {
  console.log(`[management-lifecycle] start requested host=${options.host ?? '127.0.0.1'} port=${options.port ?? 9301} listening=${managementServer?.listening ?? false} startupPending=${Boolean(startupPromise)}`)
  if (managementServer?.listening) return Promise.resolve(managementServer)
  if (startupPromise) return startupPromise

  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 9301
  const environment = options.environment ?? 'production'
  const webHost = options.webRoot ? createStaticWebHost(options.webRoot) : null
  if (webHost) console.log(`[management-lifecycle] serving console static root=${webHost.root}`)
  const candidate = http.createServer((req, res) => {
    void handleManagementRequest(req, res, environment, webHost)
  })

  managementServer = candidate
  startupPromise = new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      console.error(`[management-lifecycle] listen error host=${host} port=${port}`, error)
      candidate.off('listening', handleListening)
      if (managementServer === candidate) managementServer = null
      startupPromise = null
      reject(error)
    }
    const handleListening = () => {
      candidate.off('error', handleError)
      startupPromise = null
      console.log(`[osw] management server listening on ${host}:${port}`)
      resolve(candidate)
    }
    candidate.once('error', handleError)
    candidate.once('listening', handleListening)
    candidate.listen(port, host)
  })

  return startupPromise
}

async function handleManagementRequest(req: http.IncomingMessage, res: http.ServerResponse, environment: RuntimeEnvironment, webHost: StaticWebHost | null): Promise<void> {
  const startedAt = Date.now()
  console.debug(`[management] request begin method=${req.method ?? 'UNKNOWN'} path=${req.url ?? '/'} host=${req.headers.host ?? 'none'}`)
  try {
    // 静态托管优先接管非 /api 的 GET：它的 SPA 回退必须拿到「未被改写过的」请求。
    if (webHost && await webHost.handle(req, res)) {
      const duration = Date.now() - startedAt
      console.debug(`[management] static request completed path=${req.url ?? '/'} status=${res.statusCode} duration=${duration}ms`)
      return
    }
    if (!await applyManagementRequestGuards(req, res)) {
      const message = `[management] request handled by guard method=${req.method ?? 'UNKNOWN'} path=${req.url ?? '/'} status=${res.statusCode} duration=${Date.now() - startedAt}ms`
      if (req.method === 'OPTIONS') console.debug(message)
      else console.warn(message)
      return
    }
    await handleApiRequest(req, res, environment)
    const duration = Date.now() - startedAt
    const message = `[management] request completed method=${req.method ?? 'UNKNOWN'} path=${req.url ?? '/'} status=${res.statusCode} duration=${duration}ms`
    if (res.statusCode >= 500) console.error(message)
    else if (res.statusCode >= 400 || duration >= 1_000) console.warn(message)
    else console.debug(message)
  } catch (error) {
    console.error(`[management] request boundary failed: ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'}`, error)
    if (res.headersSent || res.writableEnded) {
      res.destroy(error instanceof Error ? error : new Error(String(error)))
      return
    }
    handleApiRequestError(res, error)
  }
}

function handleApiRequestError(res: http.ServerResponse, error: unknown): void {
  const normalized = normalizeError(error)
  sendManagementError(res, normalized)
}

export async function stopManagementServer(): Promise<void> {
  console.log(`[management-lifecycle] stop requested listening=${managementServer?.listening ?? false} startupPending=${Boolean(startupPromise)}`)
  if (startupPromise) await startupPromise
  const activeServer = managementServer
  managementServer = null
  if (!activeServer?.listening) {
    console.log('[management-lifecycle] stop skipped: server is not listening')
    return
  }
  console.log('[management-lifecycle] closing management server')
  activeServer.closeIdleConnections?.()
  activeServer.closeAllConnections?.()
  await new Promise<void>((resolve, reject) => {
    activeServer.close(error => error ? reject(error) : resolve())
  })
  console.log('[management-lifecycle] stop completed')
}
