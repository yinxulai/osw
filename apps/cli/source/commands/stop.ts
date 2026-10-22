/**
 * `stop`：请另一个进程优雅退出。
 *
 * 只能走 HTTP 握手，不能发信号：Windows 上没有真正的 `SIGTERM`（`process.kill` 是硬杀），
 * 数据库与监听端口都来不及收尾。握手契约见 core 的 `management/core/shutdown-handshake.ts`。
 */

import { waitFor } from '../async'
import { describeError } from '../errors'
import { cliTranslator } from '../native-i18n'
import { resolveDataDirectory } from '../host'
import { callManagementApi } from '../management-client'
import { readManagementToken } from '@server/management/token'
import { isProcessAlive, readRuntimeState, removeRuntimeState, runtimeFilePath } from '../runtime-state'
import type { CliArguments } from '../options'

/** 等它退出。超过这个时间就报失败：不猜它「大概快停了」。 */
const SHUTDOWN_TIMEOUT_MILLISECONDS = 10_000

export async function runStop(values: CliArguments): Promise<number> {
  const t = cliTranslator()
  const dataDir = resolveDataDirectory(values.dataDir)
  const filePath = runtimeFilePath(dataDir)
  const state = await readRuntimeState(dataDir)

  // 这里不碰实例锁：锁是 core 的声明（`runtime/instance-lock.ts`），宿主没有理由去
  // 编辑它。上次崩溃留下的锁会被持有者判定识破（pid 已死、或心跳早停），下一次
  // `start` 自己会接管——宿主多插一手，只会多出一条「谁该清它」的规矩。

  if (!state) {
    // 正常状态：从没启动过，或者上一次已经干净退出。
    console.log(t('native.cli.stop.notRunning', { path: filePath }))
    return 0
  }

  if (!isProcessAlive(state.pid)) {
    // 进程早就不在了——文件是上次异常退出（崩溃、被强杀）留下的。先清理再报告，
    // 否则 `status` 会一直说「无响应」，让人以为还有服务在跑。
    try {
      await removeRuntimeState(dataDir)
    } catch (error) {
      console.error(t('native.cli.stop.failed', { message: describeError(error) }))
      return 1
    }
    console.log(t('native.cli.stop.stale', { path: filePath }))
    return 0
  }

  console.log(t('native.cli.stop.requesting', { pid: state.pid }))
  const result = await callManagementApi({
    host: state.managementHost,
    port: state.managementPort,
    path: '/api/runtime/shutdown',
    // 凭证与 `runtime.json` 在同一个数据目录里，读不到就照旧发（服务会回 401），
    // 由下面「进程是否真的消失」来判定结果——请求被拒也未必意味着它没在停。
    token: await readManagementToken(dataDir),
  })

  // 不按响应判定成败：服务端收尾时会关掉监听，客户端可能在读完响应前就被断开，
  // 于是「已经停了」会被误报成「没人应答」。统一等进程真的消失——它对两种情况都成立。
  const exited = await waitFor(() => !isProcessAlive(state.pid), SHUTDOWN_TIMEOUT_MILLISECONDS)
  if (exited) {
    // 锁由对端自己释放；万一它在收尾途中崩掉，留下的锁也会被判成残留并被下一次
    // `start` 接管（见上面那段）。
    console.log(t('native.cli.stop.done'))
    return 0
  }

  if (result.ok === false && result.reason === 'rejected') {
    // 进程在、端口也在，但管理服务拒绝了这次请求：多半是数据目录里的这份快照与真正在跑的
    // 那个实例对不上（换过数据目录，或端口被别人占了）。不清理文件：进程还活着，文件还是它的。
    console.error(t('native.cli.stop.rejected'))
    return 1
  }

  console.error(
    t('native.cli.stop.timeout', { pid: state.pid, seconds: Math.round(SHUTDOWN_TIMEOUT_MILLISECONDS / 1000) }),
  )
  return 1
}
