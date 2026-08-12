import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const CLIENT_AUTH_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
])

export function createUpstreamHeaders(source: IncomingHttpHeaders, authHeaders: Record<string, string>, contentLength: number): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  const connectionHeaders = parseConnectionHeaders(source.connection)
  const replacementAuthHeaders = new Set(Object.keys(authHeaders).map(name => name.toLowerCase()))

  for (const [name, value] of Object.entries(source)) {
    const normalizedName = name.toLowerCase()
    if (value === undefined) continue
    if (normalizedName === 'host' || normalizedName === 'content-length') continue
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || connectionHeaders.has(normalizedName)) continue
    if (CLIENT_AUTH_HEADERS.has(normalizedName) || replacementAuthHeaders.has(normalizedName)) continue
    headers[name] = value
  }

  Object.assign(headers, authHeaders)
  if (contentLength > 0) headers['content-length'] = String(contentLength)
  return headers
}

export function createDownstreamHeaders(source: IncomingHttpHeaders): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {}
  const connectionHeaders = parseConnectionHeaders(source.connection)

  for (const [name, value] of Object.entries(source)) {
    const normalizedName = name.toLowerCase()
    if (value === undefined) continue
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || connectionHeaders.has(normalizedName)) continue
    headers[name] = value
  }

  return headers
}

function parseConnectionHeaders(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(Boolean),
  )
}
