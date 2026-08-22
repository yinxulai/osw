import { ServerRuntime } from './runtime/server-runtime'
import type { Server } from 'node:http'
import type { KeychainApi } from '@common/keychain'
import type { RuntimeProfile } from '@common/runtime-profile'

export interface StartServerOptions {
  dataDir: string
  secretStore: KeychainApi
  runtimeProfile: RuntimeProfile
  managementHost?: string
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
