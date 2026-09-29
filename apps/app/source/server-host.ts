import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { utilityProcess } from 'electron'
import { ServiceHost, type ServiceHostState, type ServiceHostOptions, type ServiceProcess } from '@server/host/service-host'
import type { Settings } from '@common/schemas'
import type { TrayLogicalModelSummary } from '@common/tray-panel'
import type { ProxyServerStatus } from '@server/proxy/runtime/server'
import type { ForwardedLogLine } from './log-forwarder'

/**
 * 应用与核心服务之间的**唯一**接口。
 *
 * 核心服务跑在一个独立进程里（`node:sqlite` 是同步 API，留在主进程就会卡住界面，
 * 见 issue #9），所以应用这边不能再 `import '@server/...'` 拿业务函数——那样只是把
 * 数据库又拖回主进程。这个文件是那道边界的具象：上面是 Electron，下面是服务进程。
 *
 * 它刻意**导出与核心同名的函数**（`getSettings` / `startProxyServer` / …），于是
 * 托盘、国际化、自动启动那几处的改动只剩下一行 import 的来源。少一层改名，就少
 * 一种「两套名字指向同一个东西」的漂移。
 *
 * 唯一真正需要意识到的差别：这些调用会跨进程，所以它们**可能被拒绝**（服务正在重启）。
 * 调用方原本就有 try/catch（那些地方读不到设置时本来就允许降级），这里不需要额外约定。
 */

/** 服务进程入口产物。名字由 `vite.server.config.ts` 的 `entryFileNames` 钉死。 */
const serviceEntry = fileURLToPath(new URL('./service-main.mjs', import.meta.url))

/**
 * 用 `utilityProcess` 起核心服务进程。
 *
 * 选它而不是 `worker_threads`，**唯一**的理由是 asar：Electron 只给主进程那份 `fs`
 * 装了 asar 解析（`lib/node/init.ts` 的 `wrapFsWithAsar`），`worker_threads` 的加载
 * 路径完全没有这层补丁，`app.asar/...` 在线程里就是 ENOENT——上一版因此不得不把
 * 服务产物连同迁移基线一起摊到 `app.asar.unpacked`，再多出一整套路径推导。
 * `utilityProcess` 是官方的 Node 子进程原语，走主进程同一套模块加载，asar 里的入口
 * 与它的 ESM 分包都能直接加载，于是上面那些补丁全部可以删掉。
 *
 * 代价是启动比线程慢约 100 ms（实测热启动 163 ms vs 59 ms），换来的是：
 *   - 产物只有一份、只在 asar 里，`packages/core/source/database/index.ts` 的迁移基线
 *     只需面对一种布局；
 *   - 真进程隔离：服务崩溃不可能带走主进程，`process.exit()` 也不再是禁品。
 *
 * `stdio: 'inherit'` 是有意的：核心服务的日志自己落 `runtime_logs`，这个选项只是让
 * 从终端直接启动 Electron 时能看到启动期那几行（迁移耗时、监听端口）。`serviceName`
 * 让它在进程列表里有名字，排查「谁占着端口」时不用靠猜。
 */
function spawnServiceProcess(entry: string): ServiceProcess {
  const child = utilityProcess.fork(entry, [], { stdio: 'inherit', serviceName: 'OSW Core' })
  return {
    postMessage: message => {
      child.postMessage(message)
    },
    onMessage: listener => {
      child.on('message', listener)
    },
    onExit: listener => {
      child.on('exit', code => {
        // 服务进程消失是「整个应用还在、但功能全没了」的根因，退出码是这里唯一能带上的事实。
        // 正常停止也会走到这里，所以用 info 而非 error：是不是崩溃由后面的重启日志回答。
        console.log(`[service-host] service process exited code=${code}`)
        listener(code)
      })
    },
    kill: () => {
      child.kill()
    },
  }
}

/** 崩溃后的重启预算：最多 5 次，第 n 次等 n × 500 ms；稳定跑够 1 分钟后清零。 */
const RESTART_POLICY = {
  maxAttempts: 5,
  delayMilliseconds: 500,
  stableUptimeMilliseconds: 60_000,
}

let host: ServiceHost | null = null
const stateListeners = new Set<(state: ServiceHostState) => void>()

/** 起服务时要传的东西。`serviceEntry`、怎么起进程与重启策略由本文件决定，调用方不用管。 */
export type StartServerOptions = Omit<ServiceHostOptions, 'serviceEntry' | 'spawn' | 'restart'>

/** 服务进程的状态变化（重启中 / 重启预算用尽）。 */
export function onServerStateChanged(listener: (state: ServiceHostState) => void): () => void {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

/**
 * 起核心服务。
 *
 * 参数形状与从前的 `startServer()` 完全一致——**不要**以为可以少传：`secretStore`
 * 与 `systemProxyResolver` 是服务进程拿不到的东西（Electron 的 `safeStorage` 与
 * `session` 只存在于主进程），它们现在是一次反向调用，而不是一个共享模块。
 */
export async function startServer(options: StartServerOptions): Promise<void> {
  if (host !== null) throw new Error('The service host is already running')
  // 入口不在的时候提前报出来。`utilityProcess.fork` 面对一个不存在的路径不一定会立刻
  // 说清楚，而「产物没构建出来」是开发态最常见的启动失败，值得一句准确的错误。
  if (!fs.existsSync(serviceEntry)) throw new Error(`Core service bundle is missing: ${serviceEntry}`)

  const next = new ServiceHost({
    ...options,
    serviceEntry,
    spawn: spawnServiceProcess,
    restart: RESTART_POLICY,
  })
  next.onStateChanged(state => {
    if (state.kind === 'restarting') {
      console.warn(`[service-host] restarting after a crash attempt=${state.attempt}`, state.error)
    }
    if (state.kind === 'failed') {
      console.error('[service-host] restart budget exhausted; giving up', state.error)
    }
    // 这里不再包一层 try/catch：`ServiceHost` 的 `setState` 已经逐个兜住了监听器的
    // 异常（并打出同一条日志），再兜一次只会让同一个错误被记两遍。
    for (const listener of stateListeners) {
      listener(state)
    }
  })
  try {
    await next.start()
  } catch (error) {
    // 起不来就别把句柄留下：`stopServer()` 之后应该看到的是一个干净的状态。
    void next.stop()
    throw error
  }
  host = next
  console.info('[osw] server started successfully')
}

export async function stopServer(): Promise<void> {
  const current = host
  host = null
  await current?.stop()
}

/** 设置：变更由服务推过来，宿主缓存着（见 `ServiceHost`）。 */
export function getSettings(): Promise<Settings> {
  if (host === null) return Promise.reject(new Error('Service host is not running'))
  return host.getSettings()
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  if (host === null) return () => undefined
  return host.onSettingsChanged(listener)
}

export function getProxyServerStatus(): Promise<ProxyServerStatus> {
  if (host === null) return Promise.reject(new Error('Service host is not running'))
  return host.getProxyStatus()
}

export function startProxyServer(): Promise<void> {
  if (host === null) return Promise.reject(new Error('Service host is not running'))
  return host.startProxy()
}

export function stopProxyServer(): Promise<void> {
  if (host === null) return Promise.reject(new Error('Service host is not running'))
  return host.stopProxy()
}

export function getTrayLogicalModels(): Promise<TrayLogicalModelSummary[]> {
  if (host === null) return Promise.reject(new Error('Service host is not running'))
  return host.getTrayLogicalModels()
}

/**
 * 把主进程 console 的一行交给服务进程落进 `runtime_logs`（见
 * `packages/core/source/host/protocol.ts` 的 `logs.write`）。
 *
 * 服务不在时**静默丢弃**：这是旁路，丢一行日志不该让调用方（`console.log`）出错；
 * 启动期那几行由 `log-forwarder.ts` 自己攒着补送，不走这里。
 */
export function forwardRuntimeLog(line: ForwardedLogLine): void {
  host?.writeLog(line)
}
