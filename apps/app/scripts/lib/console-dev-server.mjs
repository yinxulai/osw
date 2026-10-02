// 控制台 dev server 的就绪等待。
//
// `dev.mjs`（开发启动）与 `screenshots.mjs`（无头补拍）都要先确认它起来了：Electron 加载的是
// 这个 dev server，它没起来就只能加载到一张失败页。两边各写一份会各自漂移，所以收在这里。

/** 控制台 dev server 的默认地址，与 `packages/console/vite.config.ts` 里写死的端口一致（那里 `strictPort`）。 */
export const DEFAULT_CONSOLE_DEV_URL = process.env.CONSOLE_DEV_URL ?? 'http://localhost:5173'

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * 等 dev server 能**真正给出响应**。
 *
 * 必须区分三件事，它们的处理办法完全不同：
 *
 *   1. 连不上（`ECONNREFUSED`）——还没起。继续等，最后按「没起」报错。
 *   2. 连上了但请求一直不返回——起了，但**没在干活**。这不是「再等等就好」，等再久也不会变：
 *      典型原因是这个 vite 进程没有控制终端（后台任务），它监听端口却卡在读 TTY，
 *      于是页面永远转圈、截图永远空白。单独报这一类并给出重启命令。
 *   3. 返回 5xx——起来了但内部出错（例如依赖预构建失败）。同样别干等。
 *
 * 每次请求都带独立的短超时（`AbortSignal.timeout`），否则第 2 类会把整个等待拖成一次挂起——
 * 那正是这个函数要防的东西。
 */
export async function waitForConsoleServer(params = {}) {
  const {
    consoleDevUrl = DEFAULT_CONSOLE_DEV_URL,
    timeoutMillis = 60_000,
    probeTimeoutMillis = 1_500,
    onWait,
  } = params
  const deadline = Date.now() + timeoutMillis
  const startedAt = Date.now()
  let sawConnection = false

  while (Date.now() < deadline) {
    try {
      const response = await fetch(consoleDevUrl, { signal: AbortSignal.timeout(probeTimeoutMillis) })
      sawConnection = true
      if (response.status < 500) return
      throw new Error(
        `Console dev server at ${consoleDevUrl} responded with HTTP ${response.status}. `
        + 'Check its own terminal/log for the failure.',
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes('responded with HTTP')) throw error

      if (error instanceof Error && error.name === 'TimeoutError') {
        // 端口通了但不应答：重启它是唯一出路，继续等没有意义。
        throw new Error(
          `Console dev server at ${consoleDevUrl} accepted the connection but never responded. `
          + 'It is most likely running without a controlling TTY (started as a background job). '
          + 'Restart it in the foreground, or with: nohup pnpm --filter @osw/console run dev > /tmp/osw-console.log 2>&1 &',
        )
      }

      // 连接被拒/域名解析失败：还没起，继续等。
      onWait?.({ elapsedMillis: Date.now() - startedAt, sawConnection })
      await sleep(500)
    }
  }

  throw new Error(
    sawConnection
      ? `Console dev server at ${consoleDevUrl} kept failing every probe for ${Math.round(timeoutMillis / 1000)}s `
        + '(the connection is accepted but the HTTP request never completes).'
      : `Console dev server is not reachable at ${consoleDevUrl} (start it with: pnpm dev)`,
  )
}

/**
 * 管理服务（`runtime-profile` 的 `managementApiUrl`）是否在监听。
 *
 * 不算硬错误：页面照样能画出来，只是数据全空、截出来的图没意义。所以只提示，
 * 让调用方决定要不要拦。
 */
export async function isManagementApiReachable(apiBase, params = {}) {
  const { probeTimeoutMillis = 1_500 } = params
  try {
    const response = await fetch(apiBase, { signal: AbortSignal.timeout(probeTimeoutMillis) })
    return response.status < 500
  } catch {
    return false
  }
}
