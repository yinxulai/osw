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
import { createCaller, createRpcEndpoint, describeError, type RpcPort } from './rpc'
import type { HostCalls, HostLogLine, ServiceEvents } from './protocol'
import type { SecretStore } from '@common/secret-store'
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
    unsubscribeSettings = onSettingsChanged(settings => endpoint.emit('settings.changed', settings))

    endpoint.handle('runtime.stop', async () => {
      await stopServer()
      // 服务停了，这条通道也就没有下一条消息了：监听表和挂起表都跟着走，
      // 免得进程拒绝退出时靠 `kill` 来兜底。
      unsubscribeSettings?.()
      endpoint.dispose(new Error('Service runtime stopped'))
    })

    const endpoints = await startServer({
      runtimeConfig,
      secretStore,
      systemProxyResolver,
      // 退出流程由宿主掌控（见 `service-host.ts`），核心不该再自己去关别人。
      shutdown: null,
    })
    const ready: ServiceEvents['service.ready'] = { endpoints, settings: await getSettings() }
    endpoint.emit('service.ready', ready)
  } catch (error) {
    // 启动失败不吞：宿主会用「重启预算」来决定重试还是把错误弹给用户。
    const failure: ServiceEvents['service.failed'] = describeError(error)
    endpoint.emit('service.failed', failure)
    unsubscribeSettings?.()
    endpoint.dispose(new Error('Service runtime failed to start'))
  }
}
