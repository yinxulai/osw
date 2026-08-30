import type { Server } from 'node:http'
import http from 'node:http'
import { handleProxyRequest } from '@server/proxy/request/request-entry'
import { getErrorResponseMessage, isErrorCode, normalizeError } from '@server/errors'

export interface ProxyEndpoint {
  host: string
  port: number
}

export interface ProxyRuntimeStatus extends ProxyEndpoint {
  running: boolean
}

export class ProxyRuntime {
  private server: Server | null = null
  private state: 'stopped' | 'starting' | 'running' | 'stopping' = 'stopped'
  private operation: Promise<void> = Promise.resolve()
  private endpoint: ProxyEndpoint

  constructor(endpoint: ProxyEndpoint) {
    this.endpoint = endpoint
  }

  getStatus(): ProxyRuntimeStatus {
    const address = this.server?.address()
    const endpoint = address && typeof address !== 'string'
      ? { host: address.address, port: address.port }
      : this.endpoint
    return { ...endpoint, running: this.state === 'running' && this.server?.listening === true }
  }

  getServer(): Server | null {
    return this.server
  }

  start(endpoint = this.endpoint): Promise<void> {
    return this.enqueue(async () => {
      if (this.state === 'running') {
        console.debug('[proxy-lifecycle] start skipped reason=already-running')
        return
      }
      const startedAt = Date.now()
      this.endpoint = endpoint
      this.state = 'starting'
      console.info(`[proxy-lifecycle] start requested host=${endpoint.host} port=${endpoint.port}`)
      const candidate = this.createServer()
      try {
        await listen(candidate, endpoint)
        this.server = candidate
        this.state = 'running'
        console.info(`[proxy-lifecycle] listening host=${endpoint.host} port=${endpoint.port} duration=${Date.now() - startedAt}ms`)
      } catch (error) {
        await close(candidate)
        this.state = 'stopped'
        console.error(`[proxy-lifecycle] start failed host=${endpoint.host} port=${endpoint.port} duration=${Date.now() - startedAt}ms`, error)
        throw error
      }
    })
  }

  stop(): Promise<void> {
    return this.enqueue(async () => {
      if (this.state === 'stopped') {
        console.debug('[proxy-lifecycle] stop skipped reason=already-stopped')
        return
      }
      const startedAt = Date.now()
      this.state = 'stopping'
      console.info('[proxy-lifecycle] stop requested')
      const active = this.server
      this.server = null
      try {
        await close(active)
        this.state = 'stopped'
        console.info(`[proxy-lifecycle] stopped duration=${Date.now() - startedAt}ms`)
      } catch (error) {
        this.state = 'stopped'
        console.error(`[proxy-lifecycle] stop failed duration=${Date.now() - startedAt}ms`, error)
        throw error
      }
    })
  }

  restart(endpoint = this.endpoint): Promise<void> {
    return this.enqueue(async () => {
      const startedAt = Date.now()
      console.info(`[proxy-lifecycle] restart requested host=${endpoint.host} port=${endpoint.port}`)
      if (this.state === 'running' || this.state === 'starting') {
        this.state = 'stopping'
        const active = this.server
        this.server = null
        await close(active)
        this.state = 'stopped'
      }
      this.endpoint = endpoint
      this.state = 'starting'
      const candidate = this.createServer()
      try {
        await listen(candidate, endpoint)
        this.server = candidate
        this.state = 'running'
        console.info(`[proxy-lifecycle] restart completed host=${endpoint.host} port=${endpoint.port} duration=${Date.now() - startedAt}ms`)
      } catch (error) {
        await close(candidate)
        this.state = 'stopped'
        console.error(`[proxy-lifecycle] restart failed host=${endpoint.host} port=${endpoint.port} duration=${Date.now() - startedAt}ms`, error)
        throw error
      }
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(operation, operation)
    this.operation = result.catch(() => undefined)
    return result
  }

  private createServer(): Server {
    return http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, 'http://localhost')
        if (url.pathname === '/v1/models') {
          writeModelsResponse(res)
          return
        }
        await handleProxyRequest(req, res, 'default')
      } catch (error) {
        const normalized = normalizeError(error)
        if (isErrorCode(normalized, 'CLIENT_REQUEST_ABORTED')) {
          if (!res.writableEnded) res.destroy()
          return
        }
        console.error(`[proxy] request boundary failed: ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'} code=${normalized.code} message=${normalized.message}`)
        if (res.headersSent || res.writableEnded) {
          res.destroy(normalized)
          return
        }
        writeJsonError(res, normalized.statusCode, normalized.code, getErrorResponseMessage(normalized, '代理处理失败'))
      }
    })
  }
}

function listen(server: Server, endpoint: ProxyEndpoint): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(endpoint.port, endpoint.host)
  })
}

function close(server: Server | null): Promise<void> {
  if (!server || !server.listening) return Promise.resolve()
  server.closeIdleConnections?.()
  server.closeAllConnections?.()
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

function writeModelsResponse(res: http.ServerResponse): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ object: 'list', data: [{ id: 'default', object: 'model', created: 0, owned_by: 'one-switch' }] }))
}

function writeJsonError(res: http.ServerResponse, statusCode: number, errorCode: string, errorMessage: string): void {
  if (res.writableEnded) return
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: false, errorCode, errorMessage }))
}
