import type { Server } from 'node:http'
import http from 'node:http'
import { handleProxyRequest } from './request-entry'
import { getErrorResponseMessage, isErrorCode, normalizeError } from '../errors'

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
      if (this.state === 'running') return
      this.endpoint = endpoint
      this.state = 'starting'
      const candidate = this.createServer(endpoint)
      try {
        await listen(candidate, endpoint)
        this.server = candidate
        this.state = 'running'
      } catch (error) {
        await close(candidate)
        this.state = 'stopped'
        throw error
      }
    })
  }

  stop(): Promise<void> {
    return this.enqueue(async () => {
      if (this.state === 'stopped') return
      this.state = 'stopping'
      const active = this.server
      this.server = null
      await close(active)
      this.state = 'stopped'
    })
  }

  restart(endpoint = this.endpoint): Promise<void> {
    return this.enqueue(async () => {
      if (this.state === 'running' || this.state === 'starting') {
        this.state = 'stopping'
        const active = this.server
        this.server = null
        await close(active)
        this.state = 'stopped'
      }
      this.endpoint = endpoint
      this.state = 'starting'
      const candidate = this.createServer(endpoint)
      try {
        await listen(candidate, endpoint)
        this.server = candidate
        this.state = 'running'
      } catch (error) {
        await close(candidate)
        this.state = 'stopped'
        throw error
      }
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(operation, operation)
    this.operation = result.catch(() => undefined)
    return result
  }

  private createServer(endpoint: ProxyEndpoint): Server {
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
