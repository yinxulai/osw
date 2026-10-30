/**
 * 故障切换和凭据处理这两类单测共用的夹具。
 *
 * `response.test.ts` 与 `headers.test.ts` 用这里的状态码表和请求头夹具锁定三件最高风险的事：
 * 非 2xx 要换通道、报文错误才归到客户端、密钥不能进日志也不能原样转给上游。
 */

import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { ProtocolAuthHeaders } from '@common/protocols'

export const SUCCESS_STATUS_CODES: readonly number[] = [200, 201, 204]
export const FAILOVER_STATUS_CODES: readonly number[] = [300, 301, 399, 400, 401, 403, 404, 405, 408, 409, 422, 429, 500, 502, 503, 599]
export const CLIENT_ATTRIBUTABLE_STATUS_CODES: readonly number[] = [400, 413, 414, 422]
export const NOT_CLIENT_ATTRIBUTABLE_STATUS_CODES: readonly number[] = [200, 300, 401, 403, 404, 405, 408, 409, 429, 500, 502, 503]

export const CREDENTIAL_HEADERS: OutgoingHttpHeaders = {
  authorization: 'Bearer client-token',
  'x-api-key': 'provider-key',
  cookie: 'session=secret',
  'set-cookie': ['session=secret'],
  'content-type': 'application/json',
}

export const REDACTED_CREDENTIAL_HEADERS: Record<string, string> = {
  authorization: '[REDACTED]',
  'x-api-key': '[REDACTED]',
  cookie: '[REDACTED]',
  'set-cookie': '[REDACTED]',
  'content-type': 'application/json',
}

export const CUSTOM_AUTH_HEADERS: OutgoingHttpHeaders = {
  'X-Custom-Key': 'provider-key',
  accept: 'application/json',
}

export const CUSTOM_AUTH_HEADER_NAMES: string[] = ['x-custom-key']

export const REDACTED_CUSTOM_AUTH_HEADERS: Record<string, string> = {
  'X-Custom-Key': '[REDACTED]',
  accept: 'application/json',
}

export const UPSTREAM_CLIENT_HEADERS: IncomingHttpHeaders = {
  accept: 'text/event-stream',
  'content-type': 'application/json',
  'x-goog-user-project': 'billing-project',
  'x-goog-api-client': 'genai-js/1.0',
  authorization: 'Bearer client-token',
  'x-goog-api-key': 'client-key',
  connection: 'keep-alive, x-remove-me',
  'x-remove-me': 'private',
  'transfer-encoding': 'chunked',
}

export const UPSTREAM_AUTH: ProtocolAuthHeaders = {
  replace: { 'x-goog-api-key': 'provider-key' },
  fill: {},
}

export const UPSTREAM_CONTENT_LENGTH = 42

export const UPSTREAM_FORWARDED_HEADERS: Record<string, string> = {
  accept: 'text/event-stream',
  'content-type': 'application/json',
  'x-goog-user-project': 'billing-project',
  'x-goog-api-client': 'genai-js/1.0',
  'x-goog-api-key': 'provider-key',
  'content-length': '42',
}
