import type { Server } from 'node:http'
import type { KeychainApi } from '@common/keychain'
import type { RuntimeProfile } from '@common/runtime-profile'
import { closeDatabase, initDatabase } from '../database'
import { configureSettingsDefaults, getSettings } from '@server/database/settings-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { installLogCapture } from '../management/infrastructure/log-buffer'
import { startManagementServer, stopManagementServer } from '../management/server'
import { resetManualModels } from '../proxy/routing/manual-routing'
import { startProxyServer, stopProxyServer } from '../proxy/runtime/server'

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
    console.log(`[runtime] start begin state=${this.state} dataDir=${this.options.dataDir} profile=${JSON.stringify(this.options.runtimeProfile)}`)
    try {
      resetManualModels()
      configureSecretStore(this.options.secretStore)
      configureSettingsDefaults({ listenPort: this.options.runtimeProfile.proxyPort })
      installLogCapture()
      await initDatabase(this.options.dataDir)
      console.log('[runtime] database initialized')
      const settings = await getSettings()
      console.log(`[runtime] resolved proxy endpoint host=${settings.listenHost} port=${settings.listenPort} profileDefaultPort=${this.options.runtimeProfile.proxyPort}`)
      console.log(`[runtime] starting management server host=${this.options.managementHost ?? '127.0.0.1'} port=${this.options.runtimeProfile.managementPort}`)
      this.managementServer = await startManagementServer({
        host: this.options.managementHost,
        port: this.options.runtimeProfile.managementPort,
        environment: this.options.runtimeProfile.environment,
      })
      console.log(`[runtime] management server started listening=${this.managementServer.listening}`)
      console.log(`[runtime] starting proxy server host=${settings.listenHost} port=${settings.listenPort}`)
      await startProxyServer({ host: settings.listenHost, port: settings.listenPort })
      this.state = 'running'
      console.log(`[runtime] start completed state=${this.state}`)
      return this.managementServer
    } catch (error) {
      console.error(`[runtime] start failed state=${this.state}`, error)
      try {
        await this.stopResources()
      } catch (cleanupError) {
        console.error('[runtime] start cleanup failed', cleanupError)
      }
      this.state = 'stopped'
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'created') return
    if (this.state === 'starting') throw new Error('Server runtime is still starting')
    if (this.state === 'stopping') return

    this.state = 'stopping'
    console.log(`[runtime] stop begin state=${this.state}`)
    try {
      await this.stopResources()
    } finally {
      this.state = 'stopped'
      console.log(`[runtime] stop completed state=${this.state}`)
    }
  }

  private async stopResources(): Promise<void> {
    console.log('[runtime] stopping proxy and management resources')
    const results = await Promise.allSettled([stopProxyServer(), stopManagementServer()])
    console.log(`[runtime] resource stop results=${results.map(result => result.status).join(',')}`)
    await closeDatabase()
    this.managementServer = null

    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
}
