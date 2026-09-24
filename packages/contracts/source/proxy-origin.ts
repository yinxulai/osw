/**
 * 代理监听地址 → 客户端能直接使用的地址。
 *
 * 通配地址不能直接连（`0.0.0.0` 只有 Linux 允许回连），统一收敛到回环地址；
 * IPv6 要补方括号，否则 `::1:9300` 会被当成主机名解析。
 *
 * 渲染层（引导页、请求详情）和主进程（托盘菜单）展示的是同一个地址，
 * 所以这段判断只能有一份，放在 `@common` 让两边共用。
 */

const WILDCARD_HOSTS = ['0.0.0.0', '::', '[::]']
const LOOPBACK_HOST = '127.0.0.1'

/** 监听通配地址时，配置里写的 host 不是客户端能连的 host。 */
export function isWildcardHost(host: string | null | undefined): boolean {
  return typeof host === 'string' && WILDCARD_HOSTS.includes(host)
}

/**
 * 拼出 `http://127.0.0.1:19300` 这样的地址前缀（不带协议路径）。
 *
 * host / port 不全时返回 `null`：宁可让调用方禁用按钮，也不要拼半个地址出来。
 */
export function resolveProxyOrigin(host: string | null, port: number | null): string | null {
  if (!host || !port) return null
  const resolved = isWildcardHost(host) ? LOOPBACK_HOST : host
  return `http://${resolved.includes(':') ? `[${resolved}]` : resolved}:${port}`
}
