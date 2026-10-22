import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { hasLoopbackHost, isLoopbackHost } from './loopback-host'

function requestWithHost(host: string | undefined): IncomingMessage {
  const headers: Record<string, string> = {}
  if (host !== undefined) headers.host = host
  return { headers } as unknown as IncomingMessage
}

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1:19301', '127.0.0.1', 'localhost', 'localhost:9301', '[::1]:19301', '[::1]'])('accepts %s', host => {
    expect(isLoopbackHost(host)).toBe(true)
  })

  it.each(['evil.example.com', 'evil.example.com:19301', '127.0.0.1.evil.example.com', '0.0.0.0:19301', '192.168.1.5:19301'])(
    'refuses %s',
    host => {
      // DNS rebinding 的请求正是这个形状：域名解析到回环，但 `Host` 仍是攻击者的域名。
      expect(isLoopbackHost(host)).toBe(false)
    },
  )

  it('refuses a host it cannot even parse', () => {
    // 裸 `::1` 不是合法的 `Host`（IPv6 必须带方括号），`new URL` 也解析不了它。
    // 猜一个默认值出来只会让畸形输入变成放行。
    expect(isLoopbackHost('::::')).toBe(false)
    expect(isLoopbackHost('::1')).toBe(false)
  })
})

describe('hasLoopbackHost', () => {
  it('reads the header off the request', () => {
    expect(hasLoopbackHost(requestWithHost('127.0.0.1:19301'))).toBe(true)
    expect(hasLoopbackHost(requestWithHost('evil.example.com'))).toBe(false)
  })

  it('treats a missing Host as not loopback', () => {
    // 凭证不能发给一条说不清自己奔着谁来的请求。
    expect(hasLoopbackHost(requestWithHost(undefined))).toBe(false)
  })
})
