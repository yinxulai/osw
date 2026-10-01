import http from 'node:http'
import https from 'node:https'
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
  /**
   * 一问一答地取一份正文。
   *
   * 不设大小上限：这条路上没有「多大的正文算可疑」这种事，收多少就是多少
   * （同一条判断见 `apps/docs/specs/security-privacy.md` 的「请求与响应都不设大小上限」）。
   */
  requestHttpBuffered(url: URL, options: CoreHttpRequestOptions, body: Buffer): Promise<BufferedCoreHttpResponse>
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

    async requestHttpBuffered(url, options, body) {
      return new Promise((resolveResult, reject) => {
        let responseBody = ''

        this.requestHttp(url, options, body, {
          onResponse: response => {
            response.on('data', chunk => {
              responseBody += chunk.toString('utf8')
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
