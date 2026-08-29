import { describe, expect, it } from 'vitest'
import { normalizeProxyUrl, redactProxyUrl, resolveChromiumProxyRule, shouldBypassProxy } from './outbound-proxy'

describe('outbound proxy utilities', () => {
  it('normalizes supported URLs and preserves credentials', () => {
    expect(normalizeProxyUrl(' http://user:pass@127.0.0.1:7890 ')).toBe('http://user:pass@127.0.0.1:7890')
    expect(normalizeProxyUrl('socks5://localhost:1080')).toBe('socks5://localhost:1080')
  })

  it('rejects unsupported URL content', () => {
    expect(() => normalizeProxyUrl('ftp://localhost:21')).toThrow('仅支持 HTTP、HTTPS 和 SOCKS')
    expect(() => normalizeProxyUrl('http://localhost:7890/path')).toThrow('只能包含协议、主机、端口和凭据')
    expect(() => normalizeProxyUrl('')).toThrow('请输入自定义代理 URL')
  })

  it('redacts credentials without hiding the endpoint', () => {
    expect(redactProxyUrl('http://user:secret@proxy.example:8080')).toBe('http://***:***@proxy.example:8080')
  })

  it('matches bypass hosts, ports and wildcard domains', () => {
    const bypass = 'localhost,127.0.0.1,*.example.com,api.test:8443,<local>'
    expect(shouldBypassProxy('http://localhost/path', bypass)).toBe(true)
    expect(shouldBypassProxy('http://[::1]/path', '::1')).toBe(true)
    expect(shouldBypassProxy('https://a.example.com/path', bypass)).toBe(true)
    expect(shouldBypassProxy('https://api.test:8443/path', bypass)).toBe(true)
    expect(shouldBypassProxy('https://api.test/path', bypass)).toBe(false)
    expect(shouldBypassProxy('https://other.test/path', bypass)).toBe(false)
  })

  it('converts Chromium proxy rules in priority order', () => {
    expect(resolveChromiumProxyRule('PROXY proxy.test:8080; DIRECT', 'https://example.com')).toBe('http://proxy.test:8080')
    expect(resolveChromiumProxyRule('SOCKS5 proxy.test:1080', 'https://example.com')).toBe('socks5://proxy.test:1080')
    expect(resolveChromiumProxyRule('DIRECT', 'https://example.com')).toBe('')
  })
})
