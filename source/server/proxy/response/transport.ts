import http from 'node:http'
import {
  coreNetworkClient,
  type BufferedCoreHttpResponse,
  type CoreHttpHooks,
  type CoreHttpRequestOptions,
  type CoreHttpResponse,
  type CoreHttpResponseHeaders,
} from '@server/infrastructure/network/core-network'

export type UpstreamResponse = CoreHttpResponse
export type UpstreamRequestOptions = CoreHttpRequestOptions
export type UpstreamResponseHeaders = CoreHttpResponseHeaders

export interface ResponseIdleTimeout {
  dispose(): void
}

export interface DownstreamAbortBinding {
  dispose(): void
}

export type TransportHooks = CoreHttpHooks

export type BufferedUpstreamResponse = BufferedCoreHttpResponse

export function sendUpstreamRequest(url: URL, options: UpstreamRequestOptions, body: Buffer, hooks: TransportHooks | ((response: UpstreamResponse) => void)): http.ClientRequest {
  return coreNetworkClient.requestHttp(url, options, body, hooks)
}

export function requestBufferedUpstream(url: URL, options: UpstreamRequestOptions, body: Buffer): Promise<BufferedUpstreamResponse> {
  return coreNetworkClient.requestHttpBuffered(url, options, body)
}

export function attachResponseIdleTimeout(response: UpstreamResponse, timeoutMilliseconds: number): ResponseIdleTimeout {
  let timer: NodeJS.Timeout | null = null
  let disposed = false

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const armTimer = () => {
    clearTimer()
    if (timeoutMilliseconds <= 0 || disposed) return
    timer = setTimeout(() => {
      timer = null
      response.destroy(new Error('Idle timeout'))
    }, timeoutMilliseconds)
  }
  const dispose = () => {
    disposed = true
    clearTimer()
    response.removeListener('data', armTimer)
    response.removeListener('end', dispose)
    response.removeListener('close', dispose)
    response.removeListener('error', dispose)
  }

  response.on('data', armTimer)
  response.once('end', dispose)
  response.once('close', dispose)
  response.once('error', dispose)
  armTimer()

  return { dispose }
}

export function attachDownstreamAbort(request: http.IncomingMessage, response: http.ServerResponse, providerRequest: http.ClientRequest, onAbort: () => void): DownstreamAbortBinding {
  let disposed = false
  const abort = () => {
    if (disposed) return
    disposed = true
    providerRequest.destroy(new Error('CLIENT_REQUEST_ABORTED'))
    onAbort()
  }
  const onResponseClose = () => {
    if (!response.writableEnded) abort()
  }
  const dispose = () => {
    disposed = true
    request.removeListener('aborted', abort)
    response.removeListener('close', onResponseClose)
  }

  request.once('aborted', abort)
  response.once('close', onResponseClose)
  return { dispose }
}
