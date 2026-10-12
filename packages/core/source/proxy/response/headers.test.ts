import { describe, expect, it } from 'vitest'
import { createDownstreamHeaders, createUpstreamRequestHeaders, redactHeaders } from '@server/proxy/response/headers'

describe('proxy headers', () => {
  it('redacts credentials and cookies before persistence', () => {
    expect(redactHeaders({
      authorization: 'Bearer client-token',
      'x-api-key': 'provider-key',
      cookie: 'session=secret',
      'set-cookie': ['session=secret'],
      'content-type': 'application/json',
    })).toEqual({
      authorization: '[REDACTED]',
      'x-api-key': '[REDACTED]',
      cookie: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      'content-type': 'application/json',
    })
  })

  it('redacts a configured custom authentication header case-insensitively', () => {
    expect(redactHeaders({ 'X-Custom-Key': 'provider-key', accept: 'application/json' }, ['x-custom-key'])).toEqual({
      'X-Custom-Key': '[REDACTED]',
      accept: 'application/json',
    })
  })

  it('preserves end-to-end request headers and replaces authentication', () => {
    const result = createUpstreamRequestHeaders({
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'x-goog-user-project': 'billing-project',
      'x-goog-api-client': 'genai-js/1.0',
      authorization: 'Bearer client-token',
      'x-goog-api-key': 'client-key',
      connection: 'keep-alive, x-remove-me',
      'x-remove-me': 'private',
      'transfer-encoding': 'chunked',
    }, { replace: { 'x-goog-api-key': 'provider-key' }, fill: {} }, 42)

    expect(result).toEqual({
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'x-goog-user-project': 'billing-project',
      'x-goog-api-client': 'genai-js/1.0',
      'x-goog-api-key': 'provider-key',
      'content-length': '42',
    })
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

  it('merges plugin headers after the provider credential', () => {
    // 插件（`resolveRequest`）附加的租户/组织标识要与凭据并存：它加的是「另外一个头」，
    // 不是「换个地方放密钥」。
    const result = createUpstreamRequestHeaders(
      { 'content-type': 'application/json' },
      { replace: { authorization: 'Bearer provider-key' }, fill: {} },
      0,
      { 'x-tenant-id': 'tenant-1', 'openai-organization': 'org-1' },
    )

    expect(result).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer provider-key',
      'x-tenant-id': 'tenant-1',
      'openai-organization': 'org-1',
    })
  })

  it('never lets plugin headers override authentication or position headers', () => {
    // 让插件改鉴权头等于把「密钥只由一个字段决定」这条规则废掉；位置类与逐跳头由链路自己算。
    const result = createUpstreamRequestHeaders(
      { accept: 'application/json', connection: 'keep-alive, x-remove-me', 'x-remove-me': 'private' },
      { replace: { authorization: 'Bearer provider-key' }, fill: {} },
      7,
      {
        authorization: 'Bearer sneaky',
        'content-length': '999',
        host: 'evil.example',
        'x-remove-me': 'still-private',
        'x-tenant-id': 'tenant-1',
      },
    )

    expect(result).toEqual({
      accept: 'application/json',
      authorization: 'Bearer provider-key',
      'x-tenant-id': 'tenant-1',
      'content-length': '7',
    })
  })

  it('keeps the client value when the plugin adds a header the client already sent', () => {
    // 额外头走 `Object.assign` 落在最后：插件说的比客户端更具体（它知道这个请求要发给谁），
    // 因此同名时以插件为准——但它仍然碰不到上面那三类头。
    const result = createUpstreamRequestHeaders(
      { 'x-tenant-id': 'from-client' },
      { replace: {}, fill: {} },
      0,
      { 'x-tenant-id': 'from-plugin' },
    )

    expect(result).toEqual({ 'x-tenant-id': 'from-plugin' })
  })
})
