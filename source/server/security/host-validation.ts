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
  if (normalizedListenHost && normalizedListenHost !== '0.0.0.0' && normalizedListenHost !== '::') {
    allowedHosts.add(normalizedListenHost)
  }
  // 当监听 0.0.0.0 / ::（所有网卡）时，属于用户显式选择暴露到网络，
  // 接受任意合法的 Host 头，把网络访问控制交给用户（防火墙 / listenHost 选择）。
  if (normalizedListenHost === '0.0.0.0' || normalizedListenHost === '::') {
    return true
  }

  return allowedHosts.has(hostname)
}

function normalizeHost(hostname: string): string {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (net.isIP(value) === 6 && value === '0:0:0:0:0:0:0:1') return '::1'
  return value
}
