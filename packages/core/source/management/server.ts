/**
 * 管理服务的**生命周期**：listen、close、凭证文件的写入与删除，以及一条请求跑完之后的
 * 日志分级。
 *
 * 请求该不该被应答、由谁应答，全部归 `./gateway.ts`。这台服务以前也兼着做访问控制，
 * 于是「这次启动开了哪些门」要跨六个文件拼出来；现在那些判断只有 `gateway.ts` 一处。
 *
 * 凭证文件为什么归这里：它的生命周期**就是**管理服务的生命周期——listen 成功后写、
 * 退出时删。放在宿主里写，就得让 CLI、桌面主进程、桌面服务子进程各写一遍，还要各自
 * 记得在崩溃与正常退出两条路径上删；放在这里只有一处。见 `./token-file.ts`。
 */

import http from 'node:http'
import { normalizeError } from '@server/errors'
import { createManagementGateway, type GatewayOutcome, type ManagementGateway } from './gateway'
import { sendManagementError } from './core/response'
import { managementTokenFilePath, removeManagementToken, writeManagementToken } from './token-file'
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
  /**
   * 数据目录。给了才把凭证写成文件，供同用户的其他进程（`osw stop` / `osw status`）读取。
   * 不给就没有文件——测试与进程内调用不需要它。
   */
  dataDir?: string | null
}

let managementServer: Server | null = null
let startupPromise: Promise<Server> | null = null
/** 凭证文件写在哪个目录。删的时候必须与写的时候是同一个，所以单独记着。 */
let tokenFileDataDir: string | null = null

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
  tokenFileDataDir = options.dataDir ?? null
  const startup = new Promise<Server>((resolve, reject) => {
    const handleError = (error: Error) => {
      console.error(`[management-lifecycle] listen error host=${host} port=${port}`, error)
      candidate.off('listening', handleListening)
      if (managementServer === candidate) managementServer = null
      tokenFileDataDir = null
      reject(error)
    }
    const handleListening = async () => {
      candidate.off('error', handleError)
      console.log(`[osw] management server listening on ${host}:${port}`)
      // 凭证文件必须在 resolve 之前写好：调用方拿到 server 就会去用（或者去停），
      // 而 `osw stop` 靠的正是这份文件。写失败则关掉刚开的端口再失败，
      // 不留一个「起得来但停不掉」的进程。
      try {
        await publishTokenFile(options)
        resolve(candidate)
      } catch (error) {
        if (managementServer === candidate) managementServer = null
        tokenFileDataDir = null
        candidate.close(() => reject(error))
      }
    }
    candidate.once('error', handleError)
    candidate.once('listening', () => void handleListening())
    candidate.listen(port, host)
  })
  // 记住的必须是**同一个** promise 对象：并发的第二次调用要复用这次启动，
  // 而不是各自 `createServer`。写凭证文件是 resolve 之前的一步异步，所以这里
  // 不能提前清空——否则那段时间里进来的调用会另起一个监听。
  startupPromise = startup
  const forget = () => {
    if (startupPromise === startup) startupPromise = null
  }
  void startup.then(forget, forget)
  return startup
}

/**
 * 把凭证交给同一用户的其他进程。
 *
 * 写不进去就**让启动失败**：没有这份文件，`osw stop` 与 `osw status` 一律 401，而一个
 * 「起得来但停不掉」的进程比一次启动失败更难收拾（与 `apps/cli/source/commands/start.ts`
 * 对 `runtime.json` 的取舍是同一条理由）。
 */
async function publishTokenFile(options: ManagementServerOptions): Promise<void> {
  const token = options.token ?? null
  const dataDir = options.dataDir ?? null
  if (token === null || dataDir === null) return
  try {
    await writeManagementToken(dataDir, token)
    console.log(`[management-lifecycle] management token written path=${managementTokenFilePath(dataDir)}`)
  } catch (error) {
    console.error(`[management-lifecycle] failed to write the management token path=${managementTokenFilePath(dataDir)}`, error)
    throw error
  }
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
  const dataDir = tokenFileDataDir
  tokenFileDataDir = null
  // 先删文件再关端口：反过来的话，文件还在的那一小段时间里，`status` 会读到一份指向
  // 已经关掉的服务的凭证，然后把「连不上」报成「无响应」而不是「未运行」。
  await removeTokenFile(dataDir)
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

/**
 * 删凭证文件。
 *
 * 删不掉只留诊断，不让收尾失败：进程已经在退出，把一个「退不干净」变成「退出时报错」
 * 只会让用户更难判断发生了什么。留下的是一份**已经作废**的凭证——下一次启动会原子覆盖它。
 */
async function removeTokenFile(dataDir: string | null): Promise<void> {
  if (dataDir === null) return
  try {
    await removeManagementToken(dataDir)
    console.log(`[management-lifecycle] management token removed path=${managementTokenFilePath(dataDir)}`)
  } catch (error) {
    console.error(`[management-lifecycle] failed to remove the management token path=${managementTokenFilePath(dataDir)}`, error)
  }
}
