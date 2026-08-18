import type { Server } from 'node:http'
import type { KeychainApi } from '@common/keychain'
import type { RuntimeProfile } from '@common/runtime-profile'
import { closeDatabase, initDatabase } from '../database'
import { getSettings, updateSettings } from '../database/store'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'
import { installLogCapture } from '../management/log-buffer'
import { startManagementServer, stopManagementServer } from '../management/server'
import { startProxyServer, stopProxyServer } from '../proxy/server'

export interface ServerRuntimeOptions {
  dataDir: string
  secretStore: KeychainApi
  runtimeProfile: RuntimeProfile
  managementHost?: string
}

export class ServerRuntime {
  private state: 'created' | 'starting' | 'running' | 'stopping' | 'stopped' = 'created'
  private managementServer: Server | null = null

  constructor(private readonly options: ServerRuntimeOptions) {}

  get status(): string {
    return this.state
  }

  async start(): Promise<Server> {
    if (this.state === 'running') {
      if (!this.managementServer) throw new Error('Management server is missing')
      return this.managementServer
    }
    if (this.state === 'starting') throw new Error('Server runtime is already starting')
    if (this.state === 'stopping') throw new Error('Server runtime is stopping')

    this.state = 'starting'
    try {
      configureSecretStore(this.options.secretStore)
      installLogCapture()
      await initDatabase(this.options.dataDir)
      const settings = await getSettings({ listenPort: this.options.runtimeProfile.proxyPort })
      if (
        this.options.runtimeProfile.environment === 'development' &&
        settings.listenPort !== this.options.runtimeProfile.proxyPort
      ) {
        await updateSettings({ listenPort: this.options.runtimeProfile.proxyPort })
      }
      this.managementServer = await startManagementServer({
        host: this.options.managementHost,
        port: this.options.runtimeProfile.managementPort,
      })
      await startProxyServer()
      this.state = 'running'
      return this.managementServer
    } catch (error) {
      await this.stopResources()
      this.state = 'stopped'
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'created') return
    if (this.state === 'starting') throw new Error('Server runtime is still starting')
    if (this.state === 'stopping') return

    this.state = 'stopping'
    try {
      await this.stopResources()
    } finally {
      this.state = 'stopped'
    }
  }

  private async stopResources(): Promise<void> {
    const results = await Promise.allSettled([stopProxyServer(), stopManagementServer()])
    await closeDatabase()
    this.managementServer = null

    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
}
