/**
 * `start`：前台跑起服务，`Ctrl+C` 收尾。
 *
 * 这里起来的**就是**桌面形态那套服务：同一个数据目录（`host.ts` 的 `defaultDataDirectory()`）、
 * 同一对数据库文件、同一份设置与日志。「命令行」与「桌面」只是驱动方式的差别，
 * 所以 `startServer` 的调用只有三处不一样，都写在这一段里：
 *   1. 优雅退出的兜底时限（命令行不能让用户卡在「退不掉」的状态）
 *   2. 退出握手（`stop` 靠它停掉另一个进程）与运行时文件
 *   3. 终端语言要跟随后端设置
 * 另有两处固定值属于形态差异而非行为差异，见 `apps/docs/product/packaging.md` §5.2 与 §5.1：
 * `--web` 默认开（命令行没有窗口，控制台只能由管理服务托管）、`secretStore` 用文件加密
 * （命令行拿不到系统钥匙串）。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRuntimeConfig } from '@common/runtime-config'
import type { RuntimeConfig } from '@common/runtime-config'
import type { ServerEndpoints } from '@server/index'
import { InstanceLockError } from '@server/runtime/instance-lock'
import { delay } from '../async'
import { describeError } from '../errors'
import { cliTranslator, startCliLanguageSync } from '../native-i18n'
import {
  CLI_RUNTIME_ENVIRONMENT,
  consoleWebRoot,
  formatEndpoint,
  formatUrl,
  isLoopbackHost,
  resolveDataDirectory,
} from '../host'
import {
  isProcessAlive,
  readRuntimeState,
  removeRuntimeState,
  writeRuntimeState,
  type RuntimeFileState,
} from '../runtime-state'
import { EncryptedFileSecretStore } from '../secret-store'
import type { CliArguments } from '../options'

/**
 * 优雅退出的兜底时限。
 *
 * `Ctrl+C` 之后卡住不退，比退得不够漂亮严重得多：端口不释放，用户只能 `kill -9`。
 * 桌面形态不需要这个（进程自己说了算），见 `apps/docs/product/packaging.md` §5.5。
 */
const SHUTDOWN_TIMEOUT_MILLISECONDS = 5_000

export async function runStart(values: CliArguments): Promise<number> {
  // 语言同步会替换取词函数实例，所以这里用 `let` 并在同步后再取一次；
  // 启动早期的报错（版本探测、产物缺失）用系统语言，那时数据库还没起来。
  let t = cliTranslator()

  if (!(await nodeSqliteAvailable())) {
    console.error(t('native.cli.error.sqliteTitle'))
    console.error(t('native.cli.error.sqliteBody', { version: process.versions.node }))
    return 1
  }

  const dataDir = resolveDataDirectory(values.dataDir)
  const webRoot = values.serveWeb ? consoleWebRoot() : null
  if (webRoot !== null && !existsSync(path.join(webRoot, 'index.html'))) {
    // 缺产物就报错退出，不静默降级成「只跑 API」：用户要的是控制台，少一层服务
    // 会被当成「服务坏了」。只要 API 的话，`--no-web` 才是明确表达。
    console.error(t('native.cli.error.webMissing', { path: webRoot }))
    return 1
  }

  // 单实例由 core 负责：数据目录是「一个实例」的边界，与「是命令行还是桌面端把它起来的」
  // 无关（桌面端双击两次、或者「桌面端在跑 + 命令行指定另一个端口启动」都算双实例）。
  // 拿不到锁时 `startServer` 会抛 `InstanceLockError`，在下面的 catch 里翻译成人话。

  /**
   * 收尾时拿掉运行时文件。
   *
   * 不碰实例锁：那归 core（`stopServer` → `stopResources()` 会释放它）。崩溃路径
   * （`onFatal`）跑不到这一步，但那时留下的锁会被存活判定认出来，下一次 `start`
   * 取锁时就地接管——两份记录不必由同一个进程维护，也没别人该去编辑它。
   */
  const cleanupState = async (): Promise<void> => {
    try {
      await removeRuntimeState(dataDir)
    } catch (error) {
      console.error('[cli] failed to remove the runtime file', error)
    }
  }

  // 崩溃兜底：正常路径的收尾（`shutdown`）走不到时，至少别把 `runtime.json` 留在磁盘上。
  // 它会让下一次启动看到假状态，也会让 `stop` 去等一个永远不会消失的进程。
  const onFatal = (kind: string) => (error: unknown): void => {
    console.error(`[cli] ${kind}`, error)
    // 日志先同步出去，再做异步清理。清理失败也必须退，否则留下一个「既没有输出、
    // 又不肯退出」的进程，那比崩溃本身更难查。
    void cleanupState().finally(() => process.exit(1))
    // 清理卡住（磁盘挂死之类）时仍然要退。这个定时器刻意不 unref：
    // 它需要在事件循环空了之后仍然把进程按住，否则会出现「崩溃但退出码 0」。
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MILLISECONDS)
  }
  process.on('uncaughtException', onFatal('uncaughtException'))
  process.on('unhandledRejection', onFatal('unhandledRejection'))

  // 上次崩溃（或 `kill -9`）留下的运行时文件：pid 已经不在，但它描述的状态会被
  // `status` 当真，也会让 `stop` 去等一个永远不会消失的进程。启动前顺手清掉。
  // 尽力而为：就算清不掉，后面的 `writeRuntimeState` 也会原子覆盖它。
  const previous = await readRuntimeState(dataDir)
  if (previous !== null && !isProcessAlive(previous.pid)) {
    try {
      await removeRuntimeState(dataDir)
      console.warn(`[cli] cleared a stale runtime file from pid ${previous.pid}`)
    } catch (error) {
      console.error('[cli] failed to remove the stale runtime file', error)
    }
  }

  // core 走动态 import：它内部的数据库层静态引用了 `node:sqlite`，静态加载会让
  // 「Node 版本不够」变成模块解析栈，上面的探测就永远跑不到。探测已通过，
  // 这里拿到的一定是同一个可用模块。
  const { startServer, stopServer } = await import('@server/index')

  const runtimeConfig = createRuntimeConfig({
    // 预设由 `host.ts` 唯一决定：数据目录名与默认端口都跟着它走。
    environment: CLI_RUNTIME_ENVIRONMENT,
    appVersion: __CLI_VERSION__,
    runtime: 'cli',
    dataDir,
    proxyHost: values.host ?? undefined,
    proxyPort: values.proxyPort ?? undefined,
    managementPort: values.managementPort ?? undefined,
    serveWeb: webRoot !== null,
    webRoot,
  })

  let finish: (() => void) | null = null
  const stopped = new Promise<void>(resolve => {
    finish = resolve
  })
  let stopLanguageSync: (() => void) | null = null
  let stopping = false

  const shutdown = async (): Promise<void> => {
    // 信号与退出握手可能几乎同时到达，只认第一次。
    if (stopping) return
    stopping = true
    stopLanguageSync?.()

    // 落败的那个 promise 仍然会拒绝（`race` 只转发已 settled 的那个）。不接住它，
    // 就会变成一个「未处理拒绝」撞上崩溃兜底，把已经退干净的进程改成退出码 1。
    const stoppingServer = stopServer()
    stoppingServer.catch(() => undefined)
    try {
      await Promise.race([stoppingServer, delay(SHUTDOWN_TIMEOUT_MILLISECONDS)])
    } catch (error) {
      // 已经决定要退出了，收尾失败只留诊断日志，不改变退出码——
      // 退出码要表达的是「服务跑得怎么样」，这里服务已经停了一半。
      console.error('[cli] graceful shutdown failed', error)
    }
    await cleanupState()
    finish?.()
  }

  let endpoints: ServerEndpoints
  try {
    endpoints = await startServer({
      runtimeConfig,
      secretStore: new EncryptedFileSecretStore(dataDir),
      // 桌面形态不传：同一个进程自己说了算。命令行必须传，`stop` 才能优雅停掉它。
      shutdown: { onRequest: () => void shutdown() },
    })
  } catch (error) {
    if (error instanceof InstanceLockError) {
      // 「已经在跑」不是启动失败：数据目录已经被另一个实例认领了（见 core 的 `instance-lock.ts`）。
      if (error.holder !== null) {
        console.error(t('native.cli.error.alreadyRunning', { pid: error.holder.pid, dataDir }))
      } else {
        // 读不出持有者、又还没过宽限期：可能是另一个刚启动的进程正在写锁，
        // 也可能是磁盘上的半截文件。两种情况都不该硬闯。
        console.error(t('native.cli.error.lockUnknown', { path: error.filePath }))
      }
      console.error(t('native.cli.error.alreadyRunningHint'))
      return 1
    }
    if (isAddressInUse(error)) {
      console.error(t('native.cli.error.portInUse', { address: inUseAddress(error, runtimeConfig) }))
      console.error(t('native.cli.error.portInUseHint'))
    } else {
      console.error(t('native.cli.error.startFailed', { message: describeError(error) }))
    }
    // 失败路径的锁由 core 自己释放（`ServerRuntime.start` 的 catch 会走 `stopResources`），
    // 这里不插手：那是它的声明，该由它收回。
    return 1
  }

  const state: RuntimeFileState = {
    pid: process.pid,
    appVersion: __CLI_VERSION__,
    environment: runtimeConfig.environment,
    managementHost: endpoints.managementHost,
    managementPort: endpoints.managementPort,
    proxyHost: endpoints.proxyHost,
    proxyPort: endpoints.proxyPort,
    webUrl: endpoints.webRoot === null ? null : formatUrl(endpoints.managementHost, endpoints.managementPort),
    startedAt: new Date().toISOString(),
  }

  try {
    // 写不进去就当作启动失败：一个「起得来但停不掉」的进程比启动失败更难收拾，
    // 而且它还会占着端口让下一次启动也失败。
    await writeRuntimeState(dataDir, state)
  } catch (error) {
    console.error(t('native.cli.error.startFailed', { message: describeError(error) }))
    await shutdown()
    return 1
  }

  try {
    stopLanguageSync = await startCliLanguageSync()
  } catch (error) {
    // 取词失败不该影响一个已经跑起来的服务：终端继续用系统语言。
    console.warn('[cli] language sync unavailable, using the system locale', error)
  }
  t = cliTranslator()

  console.log(t('native.cli.start.title', { version: __CLI_VERSION__, environment: runtimeConfig.environment }))
  if (state.webUrl !== null) {
    console.log(t('native.cli.start.console', { url: state.webUrl }))
  } else {
    console.log(t('native.cli.start.management', { url: `${formatUrl(endpoints.managementHost, endpoints.managementPort)}/api` }))
    console.log(t('native.cli.start.consoleDisabled'))
  }
  console.log(t('native.cli.start.proxy', { url: formatUrl(endpoints.proxyHost, endpoints.proxyPort) }))
  console.log(t('native.cli.start.dataDir', { path: dataDir }))
  console.log(t('native.cli.start.hint'))

  if (!isLoopbackHost(endpoints.proxyHost)) {
    // 安全提示：代理不带鉴权，谁连上谁就能用掉密钥、也能读到重写规则。判断必须落在
    // **监听地址**上（`0.0.0.0` 归一化成回环之后看着像本机，实际全网可达）。
    // 写 stderr：stdout 上那几行是「服务起来了吗」的答案，不该被告警插进去。
    console.warn(t('native.cli.start.exposedWarning', { host: endpoints.proxyHost }))
    console.warn(t('native.cli.start.exposedHint'))
  }

  // 只接收一次信号：第二次 `Ctrl+C` 落到默认处理，直接退出——那是「我不想等了」
  // 时该有的行为，否则用户只能 kill -9。
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  await stopped
  return 0
}

/**
 * `node:sqlite` 能力探测。
 *
 * 探测通过后模块就进了缓存，core 随后 import 到的是同一个可用模块；反过来则不成立：
 * 一旦让 core 静态加载，失败会发生在模块解析阶段，用户看到的是一坨栈，
 * 而不是「你的 Node 太旧」这句话（见 `native-i18n.ts` 的同一条注释）。
 */
async function nodeSqliteAvailable(): Promise<boolean> {
  try {
    await import('node:sqlite')
    return true
  } catch {
    return false
  }
}

function isAddressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

/**
 * 报出「哪个地址被占了」。
 *
 * libuv 会把请求的 `address` / `port` 挂在监听失败的错误上，正常都能取到。
 * 取不到时退回**管理服务**的地址：它是先启动的那个，端口冲突也最先在它身上暴露。
 */
function inUseAddress(error: unknown, runtimeConfig: RuntimeConfig): string {
  const candidate = error as { address?: unknown; port?: unknown }
  if (typeof candidate.address === 'string' && typeof candidate.port === 'number') {
    return formatEndpoint(candidate.address, candidate.port)
  }
  return formatEndpoint(runtimeConfig.managementHost, runtimeConfig.managementPort)
}
