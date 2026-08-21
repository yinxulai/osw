import http from 'node:http'
import https from 'node:https'

export type UpstreamRequestOptions = http.RequestOptions
export type UpstreamResponse = http.IncomingMessage
export type UpstreamResponseHeaders = http.IncomingHttpHeaders

export interface ResponseIdleTimeout {
  dispose(): void
}

export interface DownstreamAbortBinding {
  dispose(): void
}

export interface TransportHooks {
  onResponse(response: UpstreamResponse): void
  onError(error: Error): void
  onTimeout(request: http.ClientRequest): void
}

export function sendUpstreamRequest(url: URL, options: UpstreamRequestOptions, body: Buffer, hooks: TransportHooks | ((response: UpstreamResponse) => void)): http.ClientRequest {
  const transport = url.protocol === 'https:' ? https : http
  const normalizedHooks: TransportHooks = typeof hooks === 'function'
    ? { onResponse: hooks, onError: () => undefined, onTimeout: request => request.destroy(new Error('Connection timeout')) }
    : hooks
  const request = transport.request(options, normalizedHooks.onResponse)
  request.on('error', normalizedHooks.onError)
  request.on('timeout', () => normalizedHooks.onTimeout(request))
  if (body.length > 0) request.write(body)
  request.end()
  return request
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

export function attachDownstreamAbort(request: http.IncomingMessage, response: http.ServerResponse, upstreamRequest: http.ClientRequest, onAbort: () => void): DownstreamAbortBinding {
  let disposed = false
  const abort = () => {
    if (disposed) return
    disposed = true
    upstreamRequest.destroy(new Error('CLIENT_REQUEST_ABORTED'))
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
