/**
 * 服务进程里的运行时：把 `startServer` 挂到一条 RPC 端口上。
 *
 * 刻意**不**写进 `service-main.ts`，因为那是个只能由 `utilityProcess.fork()` 加载的入口
 * ——一旦逻辑长在里面，测试就只能真的拉起进程（慢，而且拿不到进程内部的状态）。放在
 * 这里之后，测试用一对 `MessageChannel` 端口就能把整条协议跑完。
 */
import { getSettings, onSettingsChanged } from '../database/settings-store'
import { writeRuntimeLog } from '../management/infrastructure/log-buffer'
import { startServer, stopServer } from '../index'
import { getProxyServerStatus, startProxyServer, stopProxyServer } from '../proxy/runtime/server'
import { subscribeLiveMetrics } from '../observability/live-metrics-hub'
import { createCaller, createRpcEndpoint, describeError, type RpcPort } from './rpc'
import type { HostCalls, HostLogLine, ServiceEvents } from './protocol'
import type { SecretStore } from '@common/secret-store'
import type { Settings } from '@common/schemas'
import type { SystemProxyResolver } from '../infrastructure/network/outbound-connector'

export interface ServiceRuntimeOptions {
  port: RpcPort
}

/**
 * 挂上协议并启动服务。返回时服务已经就绪（或已经推过一次 `service.failed`）
 * ——宿主只看事件，不看这个 Promise。
 *
 * 整段只有一个 `try`：从「向宿主要配置」到「服务起来」任一步失败，宿主看到的都是
 * 同一个 `service.failed`，不需要为「配置都没拿到」单开一条错误路径。
 */
export async function startServiceRuntime(options: ServiceRuntimeOptions): Promise<void> {
  const endpoint = createRpcEndpoint(options.port)
  const callHost = createCaller<HostCalls>(endpoint)
  let unsubscribeSettings: (() => void) | null = null
  // 实时指标的推送源：服务起来后才有意义（要读台账与数据库），所以先留空、就绪时再挂。
  let unsubscribeMetrics: (() => void) | null = null

  /**
   * 拆掉那条原生指标通道。
   *
   * 包成函数而不是就地写 `unsubscribeMetrics?.()`：赋值只发生在闭包里，TypeScript 看不到，
   * 会把顶层的 `unsubscribeMetrics` 窄化成初始的 `null`，于是可选调用落成「对 null 调用的
   * never」。进函数一趟，窄化从声明的联合类型重新开始。
   */
  function releaseMetrics(): void {
    unsubscribeMetrics?.()
    unsubscribeMetrics = null
  }

  /**
   * 按设置决定那条通往主进程的原生指标通道挂不挂。
   *
   * 这条出口只服务**菜单栏标题**（窗口角标在渲染进程里直接订阅 HTTP 推送，不经过这里），
   * 所以它的开合只由菜单栏开关决定：关掉菜单栏标题，就不该再有帧推给主进程——宿主收到
   * 「不再推」之后会把标题清空（见 `tray-manager.ts`）。指标本身的标准性不受影响，
   * 换的是「这条原生管道要不要接上」。
   *
   * 空的模板不算关闭——那是「用默认模板」（`DEFAULT_LIVE_METRIC_TEMPLATE`），
   * 真正的开合只看菜单栏开关本身。
   */
  function syncLiveMetricsSubscription(settings: Settings): void {
    const shouldSubscribe = settings.liveMetricMenuBarEnabled
    if (shouldSubscribe && unsubscribeMetrics === null) {
      unsubscribeMetrics = subscribeLiveMetrics(metrics => endpoint.emit('live.metrics', metrics))
    } else if (!shouldSubscribe && unsubscribeMetrics !== null) {
      unsubscribeMetrics()
      unsubscribeMetrics = null
    }
  }

  try {
    // 配置向宿主要，而不是随进程一起传进来。`utilityProcess.fork()` 没有
    // `worker_threads` 那种结构化的 `workerData`，可选的旁路（环境变量、握手消息）
    // 都要在协议之外另开一种形状；走一次 RPC 就还是同一条路，类型与错误处理都白拿。
    const runtimeConfig = await callHost('runtime.config', undefined)

    // 这两样只有宿主拿得到（Electron 的 `safeStorage` 与 `session.resolveProxy`），
    // 服务进程既拿不到也不该拿到，所以它们是回调而不是实现。
    const secretStore: SecretStore = {
      set: (reference, value) => callHost('secrets.set', { reference, value }),
      get: reference => callHost('secrets.get', { reference }),
      delete: reference => callHost('secrets.delete', { reference }),
    }
    const systemProxyResolver: SystemProxyResolver = targetUrl => callHost('system.resolveProxy', { targetUrl })

    // 起停的返回值**必须**丢掉：那里面挂着 Node 的 server/handle 对象（有函数字段），
    // 直接过 `postMessage` 会 DataCloneError。协议里这两个方法的 result 本来就是 void，
    // 所以这里不是「裁掉细节」，而是「只回约定过的东西」。
    endpoint.handle('proxy.status', () => getProxyServerStatus())
    endpoint.handle('proxy.start', async () => {
      await startProxyServer()
    })
    endpoint.handle('proxy.stop', async () => {
      await stopProxyServer()
    })
    endpoint.handle('settings.get', () => getSettings())

    // 宿主 console 的落点（见协议里的 `logs.write`）。它和 `installLogCapture()` 用同一条
    // 落库路径，所以主进程的启动横幅与服务的日志在列表里长得一模一样。
    endpoint.handle('logs.write', params => {
      const line = params as HostLogLine
      writeRuntimeLog(line.level, line.message, line.timestamp)
    })

    // 设置变更只推一次、由宿主分发：托盘、菜单、自动启动都在主进程，它们读不到这个
    // 进程里的模块级监听表。宿主也不必轮询——`getSettings()` 每次都把 `updatedTime`
    // 写成当前时间，靠比对根本发现不了变化（见 `settings-store.ts`）。
    // 同一条订阅顺手带上实时指标的开关，省得再挂一个监听表。
    unsubscribeSettings = onSettingsChanged(settings => {
      endpoint.emit('settings.changed', settings)
      syncLiveMetricsSubscription(settings)
    })

    endpoint.handle('runtime.stop', async () => {
      await stopServer()
      // 服务停了，这条通道也就没有下一条消息了：监听表和挂起表都跟着走，
      // 免得进程拒绝退出时靠 `kill` 来兜底。
      unsubscribeSettings?.()
      releaseMetrics()
      endpoint.dispose(new Error('Service runtime stopped'))
    })

    const endpoints = await startServer({
      runtimeConfig,
      secretStore,
      systemProxyResolver,
      // 退出流程由宿主掌控（见 `service-host.ts`），核心不该再自己去关别人。
      shutdown: null,
    })
    // 实时指标趁服务就绪时挂上：此刻数据库与台账都已经可用。
    const ready: ServiceEvents['service.ready'] = { endpoints, settings: await getSettings() }
    syncLiveMetricsSubscription(ready.settings)
    endpoint.emit('service.ready', ready)
  } catch (error) {
    // 启动失败不吞：宿主会用「重启预算」来决定重试还是把错误弹给用户。
    const failure: ServiceEvents['service.failed'] = describeError(error)
    endpoint.emit('service.failed', failure)
    unsubscribeSettings?.()
    releaseMetrics()
    endpoint.dispose(new Error('Service runtime failed to start'))
  }
}
