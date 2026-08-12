import { closeDatabase, initDatabase } from './db'
import { configureSecretStore } from './secrets'
import { startManagementServer, stopManagementServer } from './management/server'
import { startProxyServer, stopProxyServer } from './proxy/server'
import type { Server } from 'node:http'
import type { KeychainApi } from '@common/keychain'

export interface StartServerOptions {
  dataDir: string
  secretStore: KeychainApi
  managementHost?: string
  managementPort?: number
}

let applicationStarted = false

export async function startServer(options: StartServerOptions): Promise<Server> {
  if (applicationStarted) return startManagementServer()

  configureSecretStore(options.secretStore)
  initDatabase(options.dataDir)

  try {
    const managementServer = await startManagementServer({
      host: options.managementHost,
      port: options.managementPort,
    })
    await startProxyServer()
    applicationStarted = true
    return managementServer
  } catch (error) {
    await Promise.allSettled([stopProxyServer(), stopManagementServer()])
    closeDatabase()
    throw error
  }
}

export async function stopServer(): Promise<void> {
  applicationStarted = false
  const results = await Promise.allSettled([stopProxyServer(), stopManagementServer()])
  closeDatabase()

  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
}

export {
  getProxyServerStatus,
  restartProxyServer,
  startProxyServer,
  stopProxyServer,
} from './proxy/server'
