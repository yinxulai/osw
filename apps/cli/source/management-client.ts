/**
 * 调管理 API 的最小客户端。
 *
 * `stop` 与 `status` 一共只有两处调用，所以不引入 HTTP 依赖，直接用 Node 22 的全局 `fetch`。
 * 管理 API 全是 POST + JSON（见 core 的 `management/routes`），静态托管与 API 共用同一个端口。
 *
 * 失败**不抛异常**，而是分成三态返回：调用方必须能区分「连不上」（实例没在跑）与
 * 「连上了但被拒绝」（服务端出错 / 对面不是我们的服务）——把两者压成一个异常，`stop`
 * 就没法区分「该清理失效的运行时文件」和「该报错退出」。
 */

import net from 'node:net'
import { connectHost, formatUrl } from './host'

export type ManagementCallResult =
  | { ok: true; data: unknown }
  | { ok: false; reason: 'unreachable' }
  | { ok: false; reason: 'rejected'; status: number }

export interface ManagementCallOptions {
  host: string
  port: number
  /** 以 `/api` 开头，例如 `/api/proxy/status`。 */
  path: string
  body?: unknown
  timeoutMilliseconds?: number
  /**
   * 本次启动的管理 API 凭证（可选）。
   *
   * 凭证只在宿主的**内存**里（见 `@server/management/token`），不落盘，所以命令行
   * 根本读不到它——`stop` / `status` 都不传这个字段，靠的是「请求里没有 `Origin` /
   * `Sec-Fetch-*` → 判为非浏览器客户端 → 免凭证」（见 core 的 `../management/core/request-guards.ts`）。
   *
   * 保留这个字段是给“手里真的能拿到凭证”的调用方用的（例如将来的宿主机内调用），
   * 传了就带上，没传就不带——绝不能送一个空头，那会让服务端把「没有凭证」
   * 和「凭证是空字符串」混成一件事。
   */
  token?: string | null
}

const DEFAULT_TIMEOUT_MILLISECONDS = 5_000

export async function callManagementApi(options: ManagementCallOptions): Promise<ManagementCallResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token) headers['x-osw-token'] = options.token

  let response: Response
  try {
    response = await fetch(formatUrl(options.host, options.port) + options.path, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body ?? {}),
      // 管理服务只监听回环，但端口被防火墙/代理占着时连接会挂很久。超时按「连不上」处理：
      // `stop` 卡住不返回，比报一句「没实例响应」难用得多。
      signal: AbortSignal.timeout(options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS),
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  if (!response.ok) return { ok: false, reason: 'rejected', status: response.status }

  try {
    const payload = (await response.json()) as { success?: unknown; data?: unknown }
    // 只认 `success: true`：管理 API 的响应体固定是 `ApiResponse`（见 @common/schemas），
    // 走到这里还拿到别的形状，说明对面不是我们的服务。
    if (payload.success !== true) return { ok: false, reason: 'rejected', status: response.status }
    return { ok: true, data: payload.data }
  } catch {
    return { ok: false, reason: 'rejected', status: response.status }
  }
}

/**
 * 端口是否在监听。
 *
 * 只建 TCP 连接、不发请求：用来把 `status` 里的「进程活着但管理服务不答应」再拆一层——
 * 「端口根本没起来」（启动失败、或已经关了一半）与「端口在听但不回话」（卡死）
 * 给用户的下一步完全不同，压成一句话就等于没说。
 *
 * 传进来的通常是**监听地址**（`0.0.0.0` 之类），所以先过一遍 `connectHost`。
 */
export function isPortListening(host: string, port: number, timeoutMilliseconds = 1_000): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host: connectHost(host), port })
    const settle = (listening: boolean): void => {
      socket.destroy()
      resolve(listening)
    }
    socket.setTimeout(timeoutMilliseconds)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}
