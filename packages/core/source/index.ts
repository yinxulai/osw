import { ServerRuntime } from './runtime/server-runtime'
import type { RuntimeConfig } from '@common/runtime-config'
import type { SecretStore } from '@common/secret-store'
import type { ServerEndpoints } from './runtime/server-runtime'
import type { ShutdownHandshake } from './management/core/shutdown-handshake'
import type { SystemProxyResolver } from './infrastructure/network/outbound-connector'

export type { ServerEndpoints, ShutdownHandshake }

/**
 * 启动服务的全部输入。
 *
 * 刻意收得很窄：数据目录、端口、是否托管前端都在 `runtimeConfig` 里由宿主算好，
 * 这里只留「宿主实现的东西」（密钥存储、系统代理解析）和「只有命令行需要的握手」。
 * 桌面形态与命令行形态走的是同一条路径，差别只在这几个字段（见 `apps/docs/specs/packaging.md` §5）。
 */
export interface StartServerOptions {
  runtimeConfig: RuntimeConfig
  secretStore: SecretStore
  systemProxyResolver?: SystemProxyResolver
  /** 见 `./management/core/shutdown-handshake.ts`。桌面形态不传。 */
  shutdown?: ShutdownHandshake | null
}

let runtime: ServerRuntime | null = null

export async function startServer(options: StartServerOptions): Promise<ServerEndpoints> {
  // `ServerRuntime` 的构造参数就是启动参数，不再另建一层同形映射。
  if (!runtime) runtime = new ServerRuntime(options)
  return runtime.start()
}

export async function stopServer(): Promise<void> {
  if (!runtime) return
  try {
    await runtime.stop()
  } finally {
    runtime = null
  }
}
