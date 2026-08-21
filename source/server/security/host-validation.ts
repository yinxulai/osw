import net from 'node:net'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export function isAllowedHost(hostHeader: string | undefined, listenHost: string, listenPort: number): boolean {
  if (!hostHeader) return false

  let url: URL
  try {
    url = new URL(`http://${hostHeader}`)
  } catch {
    return false
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false
  const hostname = normalizeHost(url.hostname)
  const expectedPort = String(listenPort)
  if (url.port && url.port !== expectedPort) return false

  const allowedHosts = new Set(LOOPBACK_HOSTS)
  const normalizedListenHost = normalizeHost(listenHost)
  if (normalizedListenHost && normalizedListenHost !== '0.0.0.0' && normalizedListenHost !== '::') allowedHosts.add(normalizedListenHost)
  return allowedHosts.has(hostname)
}

function normalizeHost(hostname: string): string {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (net.isIP(value) === 6 && value === '0:0:0:0:0:0:0:1') return '::1'
  return value
}
