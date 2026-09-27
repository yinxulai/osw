import type { Server } from 'node:http'
import http from 'node:http'
import { handleProxyRequest } from '@server/proxy/request/request-entry'
import { PROXY_ERROR_HEADERS, proxyErrorBody } from '@server/proxy/response/proxy-response'
import { matchLocalEndpoint } from '@server/proxy/local/registry'
import { getErrorResponseMessage, isErrorCode, normalizeError } from '@server/errors'
import { CLIENT_REQUEST_ABORTED } from '@common/error-codes'

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
    return this.runSerialized(async () => {
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
    return this.runSerialized(async () => {
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
    return this.runSerialized(async () => {
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

  private runSerialized(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(operation, operation)
    this.operation = result.catch(() => undefined)
    return result
  }

  private createServer(): Server {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, 'http://localhost')
        const localEndpoint = matchLocalEndpoint(req.method, url.pathname)
        if (localEndpoint) {
          await localEndpoint.handle({ request: req, response: res })
          return
        }
        // 代理入口不需要指定逻辑模型：请求自己带的模型名决定落到哪个逻辑模型。
        await handleProxyRequest(req, res)
      } catch (error) {
        const normalized = normalizeError(error)
        if (isErrorCode(normalized, CLIENT_REQUEST_ABORTED)) {
          if (!res.writableEnded) res.destroy()
          return
        }
        console.error(`[proxy] request boundary failed: ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'} code=${normalized.code} message=${normalized.message}`)
        if (res.headersSent || res.writableEnded) {
          res.destroy(normalized)
          return
        }
        writeJsonError(res, normalized.statusCode, normalized.code, getErrorResponseMessage(normalized, 'Proxy request failed'))
      }
    })
    server.on('upgrade', (_req, socket) => socket.end(UNSUPPORTED_TRANSPORT_RESPONSE))
    return server
  }
}

/**
 * 未实现的传输形态必须显式拒绝，而不是假装没这回事。
 *
 * `TransportKind` 里保留着 `'websocket'`（见 `@common/schemas`），说明这套架构承认这种形态；
 * 但这一版没有任何 WS 实现。两端都不能走：不注册 `upgrade` 监听器的话，Node 会直接把
 * socket 销毁，客户端只看到「连接莫名断开」，而这从代理一侧完全查不出来；反过来真去接 WS，就得
 * 手写 RFC 6455 的分帧与握手——那是真正的过度实现。
 *
 * 因此这里只做一件事：回一个带可读原因的响应，然后关闭。**不含任何 WebSocket 协议细节**，
 * 所以将来实现 WS 时，这个处理函数是被替换掉的第一个东西，而不是被扩写的第一个东西。
 */
const UNSUPPORTED_TRANSPORT_RESPONSE = (() => {
  const body = JSON.stringify({
    error: {
      code: 'TRANSPORT_NOT_IMPLEMENTED',
      message: 'WebSocket transport is not implemented yet, use the HTTP endpoints instead',
    },
  })
  return [
    'HTTP/1.1 501 Not Implemented',
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n')
})()

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

function writeJsonError(res: http.ServerResponse, statusCode: number, errorCode: string, errorMessage: string): void {
  if (res.writableEnded) return
  res.statusCode = statusCode
  for (const [name, value] of Object.entries(PROXY_ERROR_HEADERS)) res.setHeader(name, value)
  res.end(proxyErrorBody(errorCode, errorMessage))
}
