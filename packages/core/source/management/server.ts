/**
 * 管理服务的**生命周期**：listen、close、以及一条请求跑完之后的日志分级。
 *
 * 请求该不该被应答、由谁应答，全部归 `./gateway.ts`。这里刻意不知道「静态托管」「凭证」
 * 「开发路径」这些概念——它只知道一个网关对象和两个 `if`。这台服务以前也兼着做访问控制，
 * 于是「这次启动开了哪些门」要跨六个文件拼出来；现在那些判断只有 `gateway.ts` 一处。
 */

import http from 'node:http'
import { normalizeError } from '@server/errors'
import { createManagementGateway, type GatewayOutcome, type ManagementGateway } from './gateway'
import { sendManagementError } from './core/response'
import type { IncomingMessage, Server } from 'node:http'
import type { RuntimeEnvironment } from '@common/runtime-profile'

export interface ManagementServerOptions {
  host?: string
  port?: number
  environment?: RuntimeEnvironment
  /** 控制台静态产物根目录。给了才托管，见 `./gateway.ts`。 */
  webRoot?: string | null
  /** 本次启动的管理 API 凭证。给了就强制校验，并注入进托管的入口页面。 */
  token?: string | null
}

let managementServer: Server | null = null
let startupPromise: Promise<Server> | null = null

export function startManagementServer(options: ManagementServerOptions = {}): Promise<Server> {
  console.log(`[management-lifecycle] start requested host=${options.host ?? '127.0.0.1'} port=${options.port ?? 9301} listening=${managementServer?.listening ?? false} startupPending=${Boolean(startupPromise)}`)
  if (managementServer?.listening) return Promise.resolve(managementServer)
  if (startupPromise) return startupPromise

  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 9301
  const gateway = createManagementGateway(options)
  if (gateway.consoleRoot !== null) console.log(`[management-lifecycle] serving console static root=${gateway.consoleRoot}`)
  const candidate = http.createServer((req, res) => {
    void handleManagementRequest(req, res, gateway)
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

/**
 * 一条请求的日志分级。
 *
 * 分级只看两件事：**走到哪一步**、**结果是什么**。这段判断以前混在请求主流程里与访问
 * 控制交错，读起来像是在决定「要不要继续」——它其实只决定日志级别。
 */
async function handleManagementRequest(req: IncomingMessage, res: http.ServerResponse, gateway: ManagementGateway): Promise<void> {
  const startedAt = Date.now()
  console.debug(`[management] request begin method=${req.method ?? 'UNKNOWN'} path=${req.url ?? '/'} host=${req.headers.host ?? 'none'}`)
  let outcome: GatewayOutcome = 'rejected'
  try {
    outcome = await gateway.handle(req, res)
  } catch (error) {
    console.error(
      `[management] request boundary failed method=${req.method ?? 'UNKNOWN'} path=${req.url ?? '/'} duration=${Date.now() - startedAt}ms`,
      error,
    )
    // 已经在往下流的时候再 `sendError` 只会抛 `ERR_HTTP_HEADERS_SENT`，把真实原因盖掉。
    if (res.headersSent || res.writableEnded) {
      res.destroy(error instanceof Error ? error : new Error(String(error)))
      return
    }
    sendManagementError(res, normalizeError(error))
    return
  }

  logCompleted(req, res, outcome, Date.now() - startedAt)
}

function logCompleted(req: IncomingMessage, res: http.ServerResponse, outcome: GatewayOutcome, duration: number): void {
  const message = `[management] request completed outcome=${outcome} method=${req.method ?? 'UNKNOWN'} path=${req.url ?? '/'} status=${res.statusCode} duration=${duration}ms`
  if (res.statusCode >= 500) {
    console.error(message)
    return
  }
  // 一个 200 但花了 20 秒的请求，在用户那里和失败没有区别；只按状态码分级会把它藏起来。
  if (res.statusCode >= 400 || duration >= 1_000) {
    // 预检被拒是预期之内的（浏览器对每个跨源请求都会先问一次），记成 warn 会把日志填满。
    if (outcome === 'rejected' && req.method === 'OPTIONS') console.debug(message)
    else console.warn(message)
    return
  }
  console.debug(message)
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
