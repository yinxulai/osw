import { ServerRuntime } from './runtime/server-runtime'
import type { Server } from 'node:http'
import type { KeychainApi } from '@common/keychain'

export interface StartServerOptions {
  dataDir: string
  secretStore: KeychainApi
  managementHost?: string
  managementPort?: number
}

let runtime: ServerRuntime | null = null

export async function startServer(options: StartServerOptions): Promise<Server> {
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

export {
  getProxyServerStatus,
  restartProxyServer,
  startProxyServer,
  stopProxyServer,
} from './proxy/server'

export { onSettingsChanged } from './database/store'
export { getSettings } from './database/store'
