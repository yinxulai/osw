import { AppError } from '../../errors'
import type { OutboundProxyMode } from '@common/schemas'

const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'])

export function normalizeProxyUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new AppError('VALIDATION_ERROR', 400, '请输入自定义代理 URL')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch (error) {
    throw new AppError('VALIDATION_ERROR', 400, '自定义代理 URL 格式无效', { cause: error })
  }

  if (!SUPPORTED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new AppError('VALIDATION_ERROR', 400, '自定义代理仅支持 HTTP、HTTPS 和 SOCKS 协议')
  }
  if (!url.hostname || (url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
    throw new AppError('VALIDATION_ERROR', 400, '自定义代理 URL 只能包含协议、主机、端口和凭据')
  }
  return url.toString().replace(/\/$/, '')
}

export function validateOutboundProxyModeAndUrl(mode: OutboundProxyMode, proxyUrl: string): void {
  if (mode !== 'custom') return
  normalizeProxyUrl(proxyUrl)
}

export function redactProxyUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.username) url.username = '***'
    if (url.password) url.password = '***'
    return url.toString().replace(/\/$/, '')
  } catch {
    return '<invalid-proxy-url>'
  }
}

export function shouldBypassProxy(targetUrl: string, bypassList: string): boolean {
  const target = new URL(targetUrl)
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const port = target.port || (target.protocol === 'https:' ? '443' : '80')

  return splitBypassList(bypassList).some(pattern => {
    if (pattern === '<local>') return !hostname.includes('.')
    const normalized = pattern.toLowerCase().replace(/^\[|\]$/g, '')
    const separator = normalized.lastIndexOf(':')
    const hasSingleColon = normalized.indexOf(':') === separator
    const hasPort = separator > 0 && hasSingleColon && /^\d+$/.test(normalized.slice(separator + 1))
    const patternHost = hasPort ? normalized.slice(0, separator) : normalized
    if (hasPort && normalized.slice(separator + 1) !== port) return false
    if (patternHost === '*') return true
    if (patternHost.startsWith('*.')) return hostname === patternHost.slice(2) || hostname.endsWith(patternHost.slice(1))
    if (patternHost.startsWith('.')) return hostname === patternHost.slice(1) || hostname.endsWith(patternHost)
    return hostname === patternHost
  })
}

export function resolveChromiumProxyRule(rule: string, targetUrl: string): string {
  const entries = rule.split(';').map(entry => entry.trim()).filter(Boolean)
  for (const entry of entries) {
    if (entry.toUpperCase() === 'DIRECT') return ''
    const separator = entry.indexOf(' ')
    const scheme = separator < 0 ? 'PROXY' : entry.slice(0, separator).toUpperCase()
    const address = separator < 0 ? entry : entry.slice(separator + 1).trim()
    if (!address) continue
    if (scheme === 'DIRECT') return ''
    if (scheme === 'PROXY' || scheme === 'HTTP') return `http://${address}`
    if (scheme === 'HTTPS') return `https://${address}`
    if (scheme === 'SOCKS' || scheme === 'SOCKS5') return `socks5://${address}`
    if (scheme === 'SOCKS4') return `socks4://${address}`
  }
  if (rule.trim() === '') return ''
  throw new AppError('SYSTEM_PROXY_RESOLUTION_FAILED', 502, `系统代理返回了不支持的规则（目标：${new URL(targetUrl).origin}）`)
}

function splitBypassList(value: string): string[] {
  return value.split(/[;,\s]+/).map(item => item.trim()).filter(Boolean)
}
