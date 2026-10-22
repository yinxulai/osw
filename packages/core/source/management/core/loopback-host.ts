/**
 * 「这条请求是奔着回环地址来的吗」。
 *
 * 只有**一个**用途：控制台静态托管要不要把本次启动的凭证注入入口 HTML
 * （见 `./static-web.ts`）。它不是访问控制——管理 API 的门是凭证，`Host` 挡不住任何
 * 拿着凭证的调用方，拿不到凭证的调用方本来也进不来。
 *
 * 之所以这一处还留着它：DNS rebinding。攻击者把自己的域名解析到 `127.0.0.1`，浏览器
 * 就认为那个页面与本服务**同源**，于是它读得到本服务发回的任意响应体——包括入口 HTML
 * 里那行 `window.__OSW__={apiToken:...}`。`Host` 是页面上唯一改不动的东西，那种请求带
 * 的是攻击者的域名，在这里就能被认出来。反过来，只要不把凭证发出去，页面对 API 的
 * 每次调用都会 `401`，`Host` 也就没必要再管别的了。
 */

import type { IncomingMessage } from 'node:http'

/** 请求头里的 `Host` 指向回环地址时返回 `true`。缺头或畸形一律当「不是」。 */
export function hasLoopbackHost(req: IncomingMessage): boolean {
  const host = req.headers.host
  return typeof host === 'string' && isLoopbackHost(host)
}

/**
 * `Host` 去掉端口后必须是回环地址。
 *
 * 用 `URL` 解析而不是自己按 `:` 切——IPv6 的写法（`[::1]:19301`）里冒号不止一个，手工切
 * 必然出错。解析失败（畸形 Host）一律当不合法。
 */
export function isLoopbackHost(host: string): boolean {
  try {
    const { hostname } = new URL(`http://${host}`)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    return false
  }
}
