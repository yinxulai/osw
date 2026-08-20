import http from 'node:http'
import https from 'node:https'

export type UpstreamRequestOptions = http.RequestOptions
export type UpstreamResponse = http.IncomingMessage
export type UpstreamResponseHeaders = http.IncomingHttpHeaders

export function sendUpstreamRequest(url: URL, options: UpstreamRequestOptions, body: Buffer, onResponse: (response: UpstreamResponse) => void): http.ClientRequest {
  const transport = url.protocol === 'https:' ? https : http
  const request = transport.request(options, onResponse)
  if (body.length > 0) request.write(body)
  request.end()
  return request
}
