import http from 'node:http'
import { getSettings } from '../database/settings-store'
import { isAllowedHost } from '../security/host-validation'
import { authorizeLocalRequest } from '../management/auth/service'
import { handleProxyRequest } from './request-entry'
import type { Server } from 'node:http'

export interface ProxyServerStatus {
  running: boolean
  host: string
  port: number
}

let proxyServer: Server | null = null
let proxyStartupPromise: Promise<Server> | null = null
let lifecyclePromise: Promise<void> = Promise.resolve()

export interface ProxyServerOptions {
  port?: number
}

export function startProxyServer(options: ProxyServerOptions = {}): Promise<Server> {
  if (proxyServer?.listening) return Promise.resolve(proxyServer)
  if (proxyStartupPromise) return proxyStartupPromise

  let candidate: Server | null = null
  const startup = (async () => {
    const settings = await getSettings()
    const listenPort = options.port ?? settings.listenPort
    candidate = http.createServer(async (req, res) => {
      try {
        if (!isAllowedHost(req.headers.host, settings.listenHost, listenPort)) {
          writeJsonError(res, 403, 'INVALID_HOST', 'Host 不被允许')
          return
        }
        if (!await authorizeLocalRequest(req.headers)) {
          writeJsonError(res, 401, 'UNAUTHORIZED', '需要有效的本地访问 Token')
          return
        }
        const url = new URL(req.url!, 'http://localhost')

        if (url.pathname === '/v1/models') {
          await writeModelsResponse(res)
          return
        }

        await handleProxyRequest(req, res, 'default')
      } catch (error) {
        if (res.headersSent) {
          res.destroy(error instanceof Error ? error : new Error(String(error)))
          return
        }
        writeJsonError(res, 500, 'PROXY_INTERNAL_ERROR', '代理处理失败')
      }
    })

    proxyServer = candidate
    const server = await listen(candidate, settings.listenHost, listenPort)
    console.log(`[one-switch] proxy server listening on ${settings.listenHost}:${listenPort}`)
    return server
  })()

  proxyStartupPromise = startup
    .then(server => {
      proxyStartupPromise = null
      return server
    })
    .catch(error => {
      if (proxyServer === candidate) proxyServer = null
      proxyStartupPromise = null
      throw error
    })

  return proxyStartupPromise
}

export function stopProxyServer(): Promise<void> {
  return runLifecycleOperation(async () => {
    if (proxyStartupPromise) await proxyStartupPromise
    const activeServer = proxyServer
    proxyServer = null
    if (activeServer?.listening) await close(activeServer)
  })
}

export function restartProxyServer(): Promise<Server> {
  let restartedServer: Server | null = null
  return runLifecycleOperation(async () => {
    if (proxyStartupPromise) await proxyStartupPromise
    const activeServer = proxyServer
    proxyServer = null
    if (activeServer?.listening) await close(activeServer)
    restartedServer = await startProxyServer()
  }).then(() => restartedServer!)
}

export async function getProxyServerStatus(): Promise<ProxyServerStatus> {
  const settings = await getSettings()
  const address = proxyServer?.address()
  return {
    running: proxyServer?.listening ?? false,
    host: settings.listenHost,
    port: address && typeof address !== 'string' ? address.port : settings.listenPort,
  }
}

function runLifecycleOperation(operation: () => Promise<void>): Promise<void> {
  const result = lifecyclePromise.then(operation, operation)
  lifecyclePromise = result.catch(() => undefined)
  return result
}

function listen(server: Server, host: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off('listening', handleListening)
      reject(error)
    }
    const handleListening = () => {
      server.off('error', handleError)
      resolve(server)
    }
    server.once('error', handleError)
    server.once('listening', handleListening)
    server.listen(port, host)
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}

function writeModelsResponse(res: http.ServerResponse): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({
    object: 'list',
    data: [{ id: 'default', object: 'model', created: 0, owned_by: 'one-switch' }],
  }))
}

function writeJsonError(res: http.ServerResponse, statusCode: number, errorCode: string, errorMessage: string): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: false, errorCode, errorMessage }))
}
