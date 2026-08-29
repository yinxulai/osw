import http from 'node:http'
import https from 'node:https'
import { AppError } from '@server/errors'
import { createOutboundConnector, OutboundProxyConnectionError, type OutboundConnector } from './outbound-connector'

export type CoreHttpRequestOptions = http.RequestOptions
export type CoreHttpResponse = http.IncomingMessage
export type CoreHttpResponseHeaders = http.IncomingHttpHeaders

export interface CoreHttpHooks {
  onError(error: Error): void
  onResponse(response: CoreHttpResponse): void
  onTimeout(request: http.ClientRequest): void
}

export interface BufferedCoreHttpResponse {
  statusCode: number
  headers: CoreHttpResponseHeaders
  body: string
}

export interface CoreNetworkClient {
  requestHttp(url: URL, options: CoreHttpRequestOptions, body: Buffer, hooks: CoreHttpHooks | ((response: CoreHttpResponse) => void)): http.ClientRequest
  requestHttpBuffered(url: URL, options: CoreHttpRequestOptions, body: Buffer, maxResponseBytes?: number): Promise<BufferedCoreHttpResponse>
}

type ConnectorResolver = () => OutboundConnector

let sharedConnector: OutboundConnector | null = null
let fallbackConnector: OutboundConnector | null = null

export function configureCoreNetworkConnector(connector: OutboundConnector): void {
  fallbackConnector?.destroy()
  fallbackConnector = null
  sharedConnector = connector
}

export function resetCoreNetworkConnector(): void {
  fallbackConnector?.destroy()
  fallbackConnector = null
  sharedConnector = null
}

function resolveConnector(): OutboundConnector {
  if (sharedConnector) return sharedConnector
  fallbackConnector ??= createOutboundConnector(() => ({
    outboundProxyMode: 'direct',
    outboundProxyUrl: '',
    outboundProxyBypass: '',
  }))
  return fallbackConnector
}

function buildCoreNetworkClient(resolve: ConnectorResolver): CoreNetworkClient {
  return {
    requestHttp(url, options, body, hooks) {
      const connector = resolve()
      const transport = url.protocol === 'https:' ? https : http
      const normalizedHooks: CoreHttpHooks = typeof hooks === 'function'
        ? { onResponse: hooks, onError: () => undefined, onTimeout: request => request.destroy(new Error('Connection timeout')) }
        : hooks

      const request = transport.request({ ...options, ...connector.requestOptions(url) }, normalizedHooks.onResponse)
      request.on('error', error => normalizedHooks.onError(
        connector.isProxyRequest(request) ? new OutboundProxyConnectionError(error) : error,
      ))
      request.on('timeout', () => normalizedHooks.onTimeout(request))
      if (body.length > 0) request.write(body)
      request.end()
      return request
    },

    async requestHttpBuffered(url, options, body, maxResponseBytes = Number.POSITIVE_INFINITY) {
      return new Promise((resolveResult, reject) => {
        let responseBody = ''
        let bufferedBytes = 0

        this.requestHttp(url, options, body, {
          onResponse: response => {
            response.on('data', chunk => {
              const text = chunk.toString('utf8')
              bufferedBytes += Buffer.byteLength(text, 'utf8')
              if (bufferedBytes > maxResponseBytes) {
                response.destroy(new AppError('UPSTREAM_UNAVAILABLE', 502, `响应体超过限制（${maxResponseBytes} bytes）`))
                return
              }
              responseBody += text
            })
            response.on('end', () => resolveResult({
              statusCode: response.statusCode ?? 502,
              headers: response.headers,
              body: responseBody,
            }))
            response.on('error', reject)
          },
          onError: reject,
          onTimeout: request => request.destroy(new Error('Connection timeout')),
        })
      })
    },
  }
}

export function createCoreNetworkClient(connector: OutboundConnector): CoreNetworkClient {
  return buildCoreNetworkClient(() => connector)
}

export const coreNetworkClient: CoreNetworkClient = buildCoreNetworkClient(resolveConnector)
