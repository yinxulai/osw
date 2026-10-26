import { describe, expect, it } from 'vitest'
import { createDownstreamHeaders, createUpstreamRequestHeaders, redactHeaders } from '@server/proxy/response/headers'
import {
  CREDENTIAL_HEADERS,
  CUSTOM_AUTH_HEADER_NAMES,
  CUSTOM_AUTH_HEADERS,
  REDACTED_CREDENTIAL_HEADERS,
  REDACTED_CUSTOM_AUTH_HEADERS,
  UPSTREAM_AUTH,
  UPSTREAM_CLIENT_HEADERS,
  UPSTREAM_CONTENT_LENGTH,
  UPSTREAM_FORWARDED_HEADERS,
} from './test-support'

describe('proxy headers', () => {
  it('redacts credentials and cookies before persistence', () => {
    expect(redactHeaders(CREDENTIAL_HEADERS)).toEqual(REDACTED_CREDENTIAL_HEADERS)
  })

  it('redacts a configured custom authentication header case-insensitively', () => {
    expect(redactHeaders(CUSTOM_AUTH_HEADERS, CUSTOM_AUTH_HEADER_NAMES)).toEqual(REDACTED_CUSTOM_AUTH_HEADERS)
  })

  it('preserves end-to-end request headers and replaces authentication', () => {
    const result = createUpstreamRequestHeaders(UPSTREAM_CLIENT_HEADERS, UPSTREAM_AUTH, UPSTREAM_CONTENT_LENGTH)

    expect(result).toEqual(UPSTREAM_FORWARDED_HEADERS)
  })

  it('forwards unknown custom headers verbatim, including their casing', () => {
    // 官方接口各有各的方言，代理不可能穷举。这条用例钉住的是「默认转发」：
    // 没有出现在任何例外清单里的头，连名字的大小写都不许动。
    const result = createUpstreamRequestHeaders({
      'OpenAI-Beta': 'assistants=v2',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'x-stainless-lang': 'js',
      originator: 'codex_cli_rs',
      'session_id': 'session-1',
      'X-App': 'cli',
      'user-agent': 'Claude-Code/1.0',
    }, { replace: {}, fill: {} }, 0)

    expect(result).toEqual({
      'OpenAI-Beta': 'assistants=v2',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'x-stainless-lang': 'js',
      originator: 'codex_cli_rs',
      'session_id': 'session-1',
      'X-App': 'cli',
      'user-agent': 'Claude-Code/1.0',
    })
  })

  it('never asks the upstream for a compressed body', () => {
    // 没有任何解压环节能读懂压缩正文，所以这个协商头必须就地丢掉，
    // 而不是跟着客户端的偏好一起转给上游。
    const result = createUpstreamRequestHeaders(
      { accept: 'application/json', 'accept-encoding': 'gzip, deflate, br', 'x-request-id': 'request-1' },
      { replace: {}, fill: {} },
      0,
    )

    expect(result).toEqual({ accept: 'application/json', 'x-request-id': 'request-1' })
  })

  it('fills a protocol fixed header only when the client did not send one', () => {
    // 协议固定头是「协议长什么样」的兜底值，不是凭据。客户端自己带了这个头就说明
    // 它比我们清楚自己在说哪个版本，我们没有理由盖掉它。
    expect(createUpstreamRequestHeaders(
      { 'content-type': 'application/json' },
      { replace: { 'x-api-key': 'provider-key' }, fill: { 'anthropic-version': '2023-06-01' } },
      0,
    )).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'provider-key',
      'anthropic-version': '2023-06-01',
    })

    expect(createUpstreamRequestHeaders(
      { 'Anthropic-Version': '2024-10-22' },
      { replace: { 'x-api-key': 'provider-key' }, fill: { 'anthropic-version': '2023-06-01' } },
      0,
    )).toEqual({
      'Anthropic-Version': '2024-10-22',
      'x-api-key': 'provider-key',
    })
  })

  it('preserves SSE response headers while removing hop-by-hop headers', () => {
    const result = createDownstreamHeaders({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-request-id': 'request-1',
      connection: 'keep-alive, x-remove-me',
      'x-remove-me': 'private',
      'transfer-encoding': 'chunked',
    })

    expect(result).toEqual({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-request-id': 'request-1',
    })
  })

  it('replaces a custom authentication header case-insensitively', () => {
    const result = createUpstreamRequestHeaders(
      { 'x-custom-key': 'client-key', accept: 'application/json' },
      { replace: { 'X-Custom-Key': 'provider-key' }, fill: {} },
      0,
    )

    expect(result).toEqual({
      accept: 'application/json',
      'X-Custom-Key': 'provider-key',
    })
  })
})
