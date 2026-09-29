/**
 * 宿主（Electron 主进程）与核心服务进程之间的线协议。
 *
 * 这层存在的理由只有一个：`node:sqlite` 的 `DatabaseSync` 是同步 API，跑在谁的事件循环上
 * 就阻塞谁。Electron 主进程要处理窗口、托盘、菜单、`ipcMain`，一条 159 ms 的聚合查询
 * 就足以让整个界面卡一下（见 issue #9），所以整个核心服务被搬进独立进程，
 * 主进程这边只剩这个进程的遥控器。
 *
 * 于是「主进程还需要核心的什么」必须被显式列出来——这正是本文件的作用。它刻意
 * 只放**类型**，不放任何实现：宿主入口与服务入口都会 import 它，一旦有运行期
 * 代码就会把 `node:sqlite` 拖进主进程，白搬一次家。
 *
 * 三个方向（两个调用方向 + 一个事件方向）。启动期那次 `runtime.config` 属于 `HostCalls`，
 * 没有为它另开一种消息形状：
 *   - `ServiceCalls`：宿主 → 服务，请求/响应。都是「读一手状态」或「开关一次服务」，
 *     全是 KB 级控制消息，没有请求体/响应体过线。
 *   - `HostCalls`：服务 → 宿主，请求/响应。只有宿主拿得到的东西（Electron 的
 *     `safeStorage`、`session.resolveProxy`）与宿主才算得出来的 `RuntimeConfig`。
 *   - `ServiceEvents`：服务 → 宿主，单向。设置变更与就绪/失败通知。
 */
import type { Settings } from '@common/schemas'
import type { RuntimeConfig } from '@common/runtime-config'
import type { ServerEndpoints } from '../runtime/server-runtime'
import type { ProxyServerStatus } from '../proxy/runtime/server'
import type { SerializedError } from './rpc'

/**
 * 服务进程能应答的请求。
 *
 * `settings.get` 不是给托盘用的——宿主会缓存设置（见 `service-host.ts`），只有缓存为空
 * （比如刚启动）时才会真的过线。
 *
 * 刻意写成类型别名而不是 `interface`：`createCaller` 要求这些表能当作
 * `Record<string, { params, result }>` 用，而只有类型别名会为对像字面量推导出
 * 隐式索引签名，`interface` 不会。
 */
export type ServiceCalls = {
  'proxy.status': { params: undefined; result: ProxyServerStatus }
  'proxy.start': { params: undefined; result: void }
  'proxy.stop': { params: undefined; result: void }
  'settings.get': { params: undefined; result: Settings }
  /**
   * 优雅停止：释放实例锁、关数据库、停监听端口。
   */
  'runtime.stop': { params: undefined; result: void }
  /**
   * 宿主 console 的一条输出，落进 `runtime_logs`。
   *
   * 方向是**宿主 → 服务**，因为数据库在服务进程这边：主进程自己写不了（`node:sqlite`
   * 是同步 API，见 issue #9），所以它把格式化好的行送过来，由服务按与
   * `installLogCapture()` 相同的路径落库。
   *
   * 代价是宿主在服务起来之前打的那几行（启动横幅）得先攒着，等服务就绪再补送——
   * 时间戳随消息带上，所以补送不会把「横幅发生在启动最早」这件事抹掉。
   */
  'logs.write': { params: HostLogLine; result: void }
}

/** 宿主 console 转发过来的一行日志。`log` 与 `info` 在两侧都映射到同一级别。 */
export interface HostLogLine {
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  timestamp: number
}

/** 服务进程反过来要宿主办的事。 */
export type HostCalls = {
  'secrets.set': { params: { reference: string; value: string }; result: void }
  'secrets.get': { params: { reference: string }; result: string | null }
  'secrets.delete': { params: { reference: string }; result: void }
  /** `ElectronSecretStore` 之外的另一半：出站连接要看系统代理（Electron `session`）。 */
  'system.resolveProxy': { params: { targetUrl: string }; result: string }
  /**
   * 启动配置。服务进程在真正干活之前问宿主要一次。
   *
   * 为什么是「问」而不是「随进程一起传进来」：`utilityProcess.fork()` 没有
   * `worker_threads` 那种结构化的 `workerData` 通道，剩下的选择只有环境变量
   * （要 JSON 编解码，且整块环境在进程列表里可见）或一条握手消息（在协议之外
   * 另开一种消息形状）。走一次 RPC 就没有旁路——类型、错误处理、超时都沿用
   * 同一条路，代价是启动多一次往返（实测亚毫秒）。
   */
  'runtime.config': { params: undefined; result: RuntimeConfig }
}

/** 服务进程单向推给宿主的通知。 */
export interface ServiceEvents {
  /** 服务已经起来了，附上端口与首份设置，省掉宿主一次往返。 */
  'service.ready': RuntimeStartResult
  /** 启动失败。之后进程会被结束，宿主决定要不要重启。 */
  'service.failed': SerializedError
  /** 设置变了。宿主侧的托盘 / 菜单 / 自动启动都等这个（轮询做不到，见 `settings-store.ts`）。 */
  'settings.changed': Settings
}

export interface RuntimeStartResult {
  endpoints: ServerEndpoints
  settings: Settings
}
