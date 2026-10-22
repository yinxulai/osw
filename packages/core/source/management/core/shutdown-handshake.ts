/**
 * 优雅退出握手。
 *
 * CLI 的 `stop` 需要「请另一个进程优雅退出」，而它不能靠信号：Windows 上 `SIGTERM`
 * 是硬杀，数据库与监听端口都来不及收尾。所以走本机 HTTP 握手（`POST /api/runtime/shutdown`）。
 *
 * **本模块不是鉴权**：它只回答一个问题——**本次宿主是否允许被外部请求停掉**。
 * 桌面形态不配置它，端点当作不存在（用户自己点「退出」）；命令行形态配置它，
 * `stop` 才有办法收尾。至于「浏览器能不能调这个端点」，靠网关里的本次启动凭证
 * （`x-osw-token`，见 `../gateway/access.ts`）；`osw stop` 自己是本机非浏览器进程，
 * 读不到不落盘的凭证，走的是同一条通道里的豁免。
 */

export interface ShutdownHandshake {
  /** 端点被请求时的回调。宿主在这里决定何时真正退出（通常是 `stopServer()`）。 */
  onRequest: () => void
}

let handshake: ShutdownHandshake | null = null

export function configureShutdownHandshake(next: ShutdownHandshake | null): void {
  handshake = next
}

export function getShutdownHandshake(): ShutdownHandshake | null {
  return handshake
}
