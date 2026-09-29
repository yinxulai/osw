/**
 * 宿主侧：核心服务进程的遥控器与生命周期。
 *
 * 它只做五件事——起进程、等就绪、转发调用、崩了重起、退出时收尾。业务状态一概不在这边，
 * 这是这次改动的全部价值：主进程的事件循环里不再有 `DatabaseSync`。
 *
 * 两个刻意的选择：
 *
 * 1. **怎么起进程由宿主注入。** 这个文件住在 `packages/core`，而 `utilityProcess` 是
 *    Electron 独有的 API；core 不依赖 Electron（它还要被 `apps/cli` 复用），所以
 *    `spawn` 是必填项而不是有默认值的可选项。桌面端那份实现见
 *    `apps/app/source/server-host.ts`，测试注入一个 `worker_threads` 版本。
 *    把「起进程」隔离成唯一的替换点，协议、重启策略、缓存一条都不用动。
 *
 * 2. **宿主缓存最近一份设置。** 托盘、菜单、自动启动都会问设置，而设置变更本来就由
 *    服务推过来（`settings.changed`）。缓存之后那些调用完全不过线，服务重启的空窗里
 *    也还能答得出来。
 *
 * 为什么是独立进程而不是 `worker_threads` 线程：asar。线程读不了 `app.asar`（Electron
 * 只给主进程那份 `fs` 装了 asar 解析），产物与迁移基线因此只能摊到 asar 外面，多出
 * 一整套路径推导；`utilityProcess` 走主进程同一套模块加载，asar 里的入口与它的 ESM
 * 分包都能直接加载。代价是冷启动多约 100 ms，换来的是真进程隔离：服务崩溃不再可能
 * 带走主进程。选型过程与实测数字在 `apps/app/source/server-host.ts`。
 */
import { createRpcEndpoint, reviveError, type RpcEndpoint, type RpcPort } from './rpc'
import type { HostCalls, HostLogLine, RuntimeStartResult, ServiceCalls, ServiceEvents } from './protocol'
import type { Settings } from '@common/schemas'
import type { SecretStore } from '@common/secret-store'
import type { RuntimeConfig } from '@common/runtime-config'
import type { ProxyServerStatus } from '../proxy/runtime/server'
import type { SystemProxyResolver } from '../infrastructure/network/outbound-connector'

/** 宿主能提供的、核心拿不到的东西。 */
export interface ServiceHostOptions {
  runtimeConfig: RuntimeConfig
  secretStore: SecretStore
  systemProxyResolver: SystemProxyResolver
  /** 服务进程入口产物（`output/command/service-main.mjs`）。 */
  serviceEntry: string
  /**
   * 怎么起这个进程。**没有默认值**，理由见文件头。桌面端用 `utilityProcess`，
   * 测试用 `worker_threads`（跑在 `ELECTRON_RUN_AS_NODE=1` 下的 Electron 里，
   * 那里没有 `utilityProcess`）。
   */
  spawn: ServiceProcessFactory
  /** `null` 表示崩了不重起，直接把错误交给宿主（测试用）。 */
  restart?: RestartPolicy | null
}

/**
 * 崩溃后的重启预算。
 *
 * `stableUptimeMilliseconds` 是这里唯一有意思的字段：只数次数的话，「每两小时崩一次」
 * 也会在十小时后把预算耗光、然后永远退出。稳定跑够一段就清零，把「偶发崩溃」和
 * 「起来就崩的坏版本」区分开。
 */
export interface RestartPolicy {
  maxAttempts: number
  delayMilliseconds: number
  stableUptimeMilliseconds: number
}

/**
 * 宿主看到的「服务进程」。
 *
 * 刻意**不**写成「结构上兼容 `Worker` / `UtilityProcess`」：两者的 `on` 重载集不一样，
 * 终止方法的返回类型也不一样（`UtilityProcess.kill()` 返回 `boolean`，`Worker.terminate()`
 * 返回 `Promise<number>`），硬凑结构兼容最后会和某一方的类型定义绑死，换个驱动就得跟着改。
 * 也没让 `RpcPort` 直接复用：`RpcPort` 要保持与 `MessagePort` 同形（测试里拿它当假端口），
 * 多挂一个 `kill()` 上去反而把那个约束弄糊。驱动方各写十行适配，换来的是这里能精确表达
 * 「我们只用到这四件事」。
 */
export interface ServiceProcess {
  postMessage(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
  /** 进程退出。崩溃与被 `kill()` 都走这里，`code` 是退出码。 */
  onExit(listener: (code: number) => void): void
  kill(): void
}

export type ServiceProcessFactory = (entry: string) => ServiceProcess

export type ServiceHostState =
  | { kind: 'created' }
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'restarting'; attempt: number; error: unknown }
  | { kind: 'stopped' }
  | { kind: 'failed'; error: unknown }

export type SettingsListener = (settings: Settings) => void
export type ServiceHostStateListener = (state: ServiceHostState) => void

interface PendingReady {
  resolve: (value: RuntimeStartResult) => void
  reject: (error: unknown) => void
}

/** 把一个 `ServiceProcess` 当成 `RpcPort` 用。 */
function portOf(child: ServiceProcess): RpcPort {
  return {
    postMessage: message => child.postMessage(message),
    on: (_event, listener) => child.onMessage(listener),
  }
}

export class ServiceHost {
  private readonly options: ServiceHostOptions

  private readonly restart: RestartPolicy | null

  private readonly settingsListeners = new Set<SettingsListener>()

  private readonly stateListeners = new Set<ServiceHostStateListener>()

  private state: ServiceHostState = { kind: 'created' }

  private child: ServiceProcess | null = null

  private endpoint: RpcEndpoint | null = null

  private pendingReady: PendingReady | null = null

  private settings: Settings | null = null

  private attempts = 0

  private stableTimer: NodeJS.Timeout | null = null

  private restartTimer: NodeJS.Timeout | null = null

  private stopping = false

  constructor(options: ServiceHostOptions) {
    this.options = options
    this.restart = options.restart ?? null
  }

  getState(): ServiceHostState {
    return this.state
  }

  /**
   * 首次启动。失败**直接抛**，不走重启预算：启动失败（端口被占、实例锁被别的实例
   * 持有、数据目录不可写）重试多少次都是同一个结果，重试只是把错误推迟几百毫秒再报。
   */
  async start(): Promise<RuntimeStartResult> {
    if (this.state.kind === 'starting' || this.state.kind === 'running') {
      throw new Error(`Service host is already ${this.state.kind}`)
    }
    this.stopping = false
    this.attempts = 0
    return this.launch()
  }

  /**
   * 停服务。可重复调用（`before-quit` 与 `did-fail-load` 都会来一次）。
   *
   * 先请服务自己收（`runtime.stop` 会释放实例锁、关数据库），再断端口、结束进程。
   * 自己收这一步没有超时，是因为**只有**它能在退出时干净地放掉实例锁；宿主那边
   * 已经用 `Promise.race` 兜了 5 秒，硬砍的是宿主而不是这里。
   */
  async stop(): Promise<void> {
    this.stopping = true
    this.clearStableTimer()
    this.clearRestartTimer()

    const child = this.child
    const endpoint = this.endpoint
    const pending = this.pendingReady
    this.child = null
    this.endpoint = null
    this.settings = null
    this.pendingReady = null

    // 正在启动（或正在重启）时被叫停：`launch()` 还挂在 `ready` 上，不唤醒它就永远
    // 等不到答案，重启路径那个 `.catch` 也永远不会跑——于是没有任何一处知道它结束了。
    pending?.reject(new Error('Service host stopped'))

    if (child !== null && endpoint !== null) {
      try {
        await endpoint.call('runtime.stop', undefined)
      } catch (error) {
        console.warn('[service-host] graceful stop failed', error)
      }
    }

    endpoint?.dispose(new Error('Service host stopped'))
    // `kill()` 是异步生效的，但这里不必等 `exit`：锁已经在 `runtime.stop` 里放掉了，
    // 而进程无论早晚都会死。等它反而会把退出流程多拖一个事件循环。
    child?.kill()
    this.setState({ kind: 'stopped' })
  }

  /**
   * 最近一次拿到的设置。
   *
   * 缓存为空时才过线，而且**不**因为服务正在重启就报错：宿主侧的 `i18n` 与
   * `AutoLaunchManager` 在启动路径上就会问一次，这时报错只会让本地化退回系统语言。
   */
  getSettings(): Promise<Settings> {
    const cached = this.settings
    if (cached !== null) return Promise.resolve(cached)
    return this.call('settings.get')
  }

  onSettingsChanged(listener: SettingsListener): () => void {
    this.settingsListeners.add(listener)
    return () => {
      this.settingsListeners.delete(listener)
    }
  }

  onStateChanged(listener: ServiceHostStateListener): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  getProxyStatus(): Promise<ProxyServerStatus> {
    return this.call('proxy.status')
  }

  startProxy(): Promise<void> {
    return this.call('proxy.start')
  }

  stopProxy(): Promise<void> {
    return this.call('proxy.stop')
  }

  /**
   * 把宿主 console 的一行交给服务落库（见协议里的 `logs.write`）。
   *
   * 刻意**不等**结果也不抛：转发是尽力而为的旁路，通道断了、服务正在重启、
   * 消息被当成未知方法——都只是这一行没记上，没有理由反过来让宿主的 `console.log` 变成
   * 一个会 reject 的东西（那才是真会把主进程弄崩的做法）。
   */
  writeLog(line: HostLogLine): void {
    const endpoint = this.endpoint
    if (endpoint === null) return
    void endpoint.call('logs.write', line).catch(() => undefined)
  }

  private call<TName extends keyof ServiceCalls & string>(
    method: TName,
  ): Promise<ServiceCalls[TName]['result']> {
    const endpoint = this.endpoint
    if (endpoint === null) return Promise.reject(new Error('Service process is not running'))
    return endpoint.call(method, undefined) as Promise<ServiceCalls[TName]['result']>
  }

  private async launch(): Promise<RuntimeStartResult> {
    this.setState({ kind: 'starting' })
    // 先挂上 pendingReady 再起进程：进程里的 `service.ready` 最早也要等它自己启动完
    // （实测 150 ms 量级）才送得到，但这个顺序让「事件先到」在结构上不可能发生。
    const ready = this.createReadyPromise()
    this.createProcess()

    try {
      const result = await ready
      this.settings = result.settings
      this.startStableTimer()
      this.setState({ kind: 'running' })
      this.notifySettingsChanged()
      return result
    } catch (error) {
      // 起不来就把进程收干净，否则它会带着半截状态留在那里占用端口和锁。
      this.disposeCurrent()
      throw error
    }
  }

  private createReadyPromise(): Promise<RuntimeStartResult> {
    return new Promise((resolve, reject) => {
      this.pendingReady = { resolve, reject }
    })
  }

  private createProcess(): void {
    const child = this.options.spawn(this.options.serviceEntry)
    const endpoint = createRpcEndpoint(portOf(child))
    this.child = child
    this.endpoint = endpoint

    // 处理器必须在进程发出第一条请求之前就位。这里不需要额外同步：服务的第一件事
    // 就是把 `runtime.config` 发过来，而那时进程才刚启动完（150 ms 量级），
    // 这几行的执行时刻远早于它。
    this.registerHostCalls(endpoint)

    endpoint.on('service.ready', payload => {
      const pending = this.pendingReady
      this.pendingReady = null
      pending?.resolve(payload as ServiceEvents['service.ready'])
    })
    endpoint.on('service.failed', payload => {
      // 还原成错误对象而不是现造一个 `new Error(message)`：`InstanceLockError` 这类
      // 错误的 `name` 是宿主唯一能用来分类的线索（见 `reviveError`）。
      const pending = this.pendingReady
      this.pendingReady = null
      pending?.reject(reviveError(payload as ServiceEvents['service.failed']))
    })
    endpoint.on('settings.changed', payload => {
      this.settings = payload as Settings
      this.notifySettingsChanged()
    })

    child.onExit(code => {
      this.handleTermination(new Error(`Service process exited with code ${code}`))
    })
  }

  private registerHostCalls(endpoint: RpcEndpoint): void {
    endpoint.handle('runtime.config', () => this.options.runtimeConfig)
    endpoint.handle('secrets.set', params => {
      const { reference, value } = params as HostCalls['secrets.set']['params']
      return this.options.secretStore.set(reference, value)
    })
    endpoint.handle('secrets.get', params => {
      const { reference } = params as HostCalls['secrets.get']['params']
      return this.options.secretStore.get(reference)
    })
    endpoint.handle('secrets.delete', params => {
      const { reference } = params as HostCalls['secrets.delete']['params']
      return this.options.secretStore.delete(reference)
    })
    endpoint.handle('system.resolveProxy', params => {
      const { targetUrl } = params as HostCalls['system.resolveProxy']['params']
      return this.options.systemProxyResolver(targetUrl)
    })
  }

  /**
   * 进程没了。三种来路共用这一条路：启动期崩溃、运行期崩溃、`stop()` 之外的终止。
   */
  private handleTermination(error: unknown): void {
    if (this.child === null) return
    this.clearStableTimer()
    const pending = this.pendingReady
    this.disposeCurrent()

    if (pending !== null) {
      // 启动期的失败由 `launch()` 的 catch 决定怎么报，这里只负责把它唤醒。
      pending.reject(error)
      return
    }

    if (this.stopping) return
    this.scheduleRestart(error)
  }

  /**
   * 断端口、结束进程、清引用。重复调用安全。
   *
   * 这里**不**等 `kill()` 的 `exit` 事件再往下走：调用点要么是 `exit` 自己
   * （进程已经死了，`kill()` 是空操作），要么是启动失败（进程无论早晚都会死，
   * 而它没拿到过锁、也没绑上端口）。唯一真正依赖「前一个进程必须已经死了」的是
   * 实例锁——那条路走的是 `exit`，因而天然满足。
   */
  private disposeCurrent(): void {
    const child = this.child
    const endpoint = this.endpoint
    this.child = null
    this.endpoint = null
    this.pendingReady = null
    endpoint?.dispose(new Error('Service process terminated'))
    child?.kill()
  }

  private scheduleRestart(error: unknown): void {
    const policy = this.restart
    // `stop()` 之后不该再有重启。正在重启的那次启动会被 `stop()` 以「已停止」拒掉，
    // 它的 catch 会顺着走到这里来——那条路不是崩溃，不能算进重启预算。
    if (this.stopping) return
    if (policy === null || this.attempts >= policy.maxAttempts) {
      // 预算用尽：把错误交出去，让宿主弹窗退出。继续无限重起只会把「起不来」
      // 变成「一直起不来」——用户看到的是转不完的启动动画。
      this.setState({ kind: 'failed', error })
      return
    }
    this.attempts += 1
    this.setState({ kind: 'restarting', attempt: this.attempts, error })
    this.clearRestartTimer()
    // 线性退避：第 n 次等 n × delay。不是指数，因为服务崩溃绝大多数是一次性的
    // （端口刚被释放、WAL 恢复），把用户拦太久反而像卡死。
    //
    // 这段等待还兼着一个正确性职责：下一条命是新 pid，而实例锁的持有者还是上一个
    // 进程的 pid。进程已经退出（这条路径只从 `exit` 进来），所以新进程能靠「pid 已死」
    // 正常接管；但如果不等、直接在 `exit` 里同步重启，新进程会在旧进程的 pid 还被
    // 系统标记为存活的那一瞬去看锁文件。
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.launch().catch((nextError: unknown) => {
        console.error('[service-host] restart attempt failed', nextError)
        this.scheduleRestart(nextError)
      })
    }, policy.delayMilliseconds * this.attempts)
  }

  private startStableTimer(): void {
    const policy = this.restart
    if (policy === null) return
    this.clearStableTimer()
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null
      this.attempts = 0
    }, policy.stableUptimeMilliseconds)
  }

  private clearStableTimer(): void {
    if (this.stableTimer === null) return
    clearTimeout(this.stableTimer)
    this.stableTimer = null
  }

  private clearRestartTimer(): void {
    if (this.restartTimer === null) return
    clearTimeout(this.restartTimer)
    this.restartTimer = null
  }

  private notifySettingsChanged(): void {
    const settings = this.settings
    if (settings === null) return
    for (const listener of this.settingsListeners) {
      try {
        listener(settings)
      } catch (error) {
        console.error('[service-host] settings listener failed', error)
      }
    }
  }

  private setState(state: ServiceHostState): void {
    this.state = state
    for (const listener of this.stateListeners) {
      try {
        listener(state)
      } catch (error) {
        console.error('[service-host] state listener failed', error)
      }
    }
  }
}
