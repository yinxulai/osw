/**
 * 运行时配置契约。
 *
 * `RuntimeProfile` 是**预设**（development / production 两档默认值），`RuntimeConfig`
 * 是宿主算完之后交给 core 的**完整配置**。core 只接受后者：它不需要知道默认端口是
 * 怎么来的，也不需要知道数据目录在哪个平台该长什么样——那些都是宿主适配的事
 * （见 `apps/docs/specs/packaging.md` §5.5）。
 *
 * 这个文件刻意不 import 任何 Node 内置模块：默认数据目录要用 `node:os` / `node:path`，
 * 那是宿主侧的活（App 用 `app.setPath('userData', ...)`，CLI 用
 * `apps/cli/source/host.ts`），不是契约的一部分。
 *
 * 这里也**没有**数据文件名：两个库各自带 schema 版本常量，文件名由
 * `@common/database-file` 从版本号推导（见那个文件的说明）。宿主少算一次文件名，
 * 就少一个两种形态可能算出不同结果的地方。
 */

import { getRuntimeProfile, type RuntimeEnvironment } from './runtime-profile'

/**
 * 宿主形态：把 core 跑起来的是桌面端还是命令行。
 *
 * core 自己分不出来：两种形态跑的是同一个 `ServerRuntime`，`serveWeb` 之类的是部署选择
 * 而不是宿主身份。这个事实只有宿主知道，所以由宿主带进来——与 `appVersion` 同一条道理。
 */
export const HOST_RUNTIMES = ['desktop', 'cli'] as const
export type HostRuntime = (typeof HOST_RUNTIMES)[number]

export interface RuntimeConfig {
  environment: RuntimeEnvironment
  /**
   * 宿主解析出来的应用版本。
   *
   * **core 不自己找版本号**：它跑在 `utilityProcess` 里，既没有 Electron 的 `app.getVersion()`
   * 也没有打包时注入的 `__APP_VERSION__`，任何「自己算一遍」的写法都只能得到另一份可能与
   * 主进程不一致的答案。版本号是构建产物的事实，只有一个来源（根 `package.json`，
   * 由 `packages/toolkit/scripts/version.mjs` 写进各清单），宿主已经拿得到，就由宿主带进来。
   *
   * 它不只是给统计用的：任何「这个运行实例是什么版本」的判断（诊断、上报、日志）都读它。
   */
  appVersion: string
  /** 宿主形态。统计的 `runtime` 字段、按形态区分的行为都读它。 */
  runtime: HostRuntime
  /** 数据目录（两个数据库、运行时文件、本地密钥文件都落在这里）。 */
  dataDir: string
  /** 代理监听地址的**默认值**；实际上由设置里的 `listenHost` 决定。 */
  proxyHost: string
  /** 代理监听端口的**默认值**；实际上由设置里的 `listenPort` 决定。 */
  proxyPort: number
  /** 管理服务的监听地址。它不是一个可持久化设置，所以这里给的就是实际值。 */
  managementHost: string
  /** 管理服务的监听端口。同上，给的就是实际值。 */
  managementPort: number
  /** 是否由管理服务托管控制台静态产物。 */
  serveWeb: boolean
  /** 控制台静态产物根目录；`serveWeb` 为真时必须给出。 */
  webRoot: string | null
}

export interface CreateRuntimeConfigInput {
  environment: RuntimeEnvironment
  /** 应用版本，必填：见 {@link RuntimeConfig.appVersion}。 */
  appVersion: string
  /** 宿主形态，必填：见 {@link RuntimeConfig.runtime}。 */
  runtime: HostRuntime
  dataDir: string
  serveWeb?: boolean
  webRoot?: string | null
  proxyHost?: string
  proxyPort?: number
  managementHost?: string
  managementPort?: number
}

/**
 * 把宿主的输入合并到预设上。
 *
 * 显式给了就用显式的，没给就落预设——这样「用户没传参数」与「用户传了和预设相同的值」
 * 走同一条路，不需要两套分支。
 */
export function createRuntimeConfig(input: CreateRuntimeConfigInput): RuntimeConfig {
  const profile = getRuntimeProfile(input.environment)
  return {
    environment: input.environment,
    appVersion: input.appVersion,
    runtime: input.runtime,
    dataDir: input.dataDir,
    proxyHost: input.proxyHost ?? '127.0.0.1',
    proxyPort: input.proxyPort ?? profile.proxyPort,
    managementHost: input.managementHost ?? '127.0.0.1',
    managementPort: input.managementPort ?? profile.managementPort,
    serveWeb: input.serveWeb ?? false,
    webRoot: input.webRoot ?? null,
  }
}
