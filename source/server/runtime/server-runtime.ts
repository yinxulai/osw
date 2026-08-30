import type { Server } from 'node:http'
import type { KeychainApi } from '@common/keychain'
import type { RuntimeProfile } from '@common/runtime-profile'
import { closeDatabase, initDatabase } from '../database'
import { configureSettingsDefaults, getSettings } from '@server/database/settings-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { configureCoreNetworkConnector, resetCoreNetworkConnector } from '../infrastructure/network/core-network'
import { configureOutboundConnector, createOutboundConnector, destroyOutboundConnector, type SystemProxyResolver } from '../infrastructure/network/outbound-connector'
import { installLogCapture } from '../management/infrastructure/log-buffer'
import { startManagementServer, stopManagementServer } from '../management/server'
import { resetManualModels } from '../proxy/routing/manual-routing'
import { startProxyServer, stopProxyServer } from '../proxy/runtime/server'

export interface ServerRuntimeOptions {
  dataDir: string
  secretStore: KeychainApi
  runtimeProfile: RuntimeProfile
  managementHost?: string
  systemProxyResolver?: SystemProxyResolver
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
    console.info(`[runtime] start requested environment=${this.options.runtimeProfile.environment} proxyPort=${this.options.runtimeProfile.proxyPort} managementPort=${this.options.runtimeProfile.managementPort}`)
    try {
      resetManualModels()
      configureSecretStore(this.options.secretStore)
      configureSettingsDefaults({ listenPort: this.options.runtimeProfile.proxyPort })
      installLogCapture()
      await initDatabase(this.options.dataDir)
      const outboundConnector = createOutboundConnector(getSettings, this.options.systemProxyResolver)
      await outboundConnector.initialize()
      configureOutboundConnector(outboundConnector, this.options.systemProxyResolver)
      configureCoreNetworkConnector(outboundConnector)
      const settings = await getSettings()
      console.debug(`[runtime] proxy endpoint resolved host=${settings.listenHost} port=${settings.listenPort}`)
      console.info(`[runtime] starting management server host=${this.options.managementHost ?? '127.0.0.1'} port=${this.options.runtimeProfile.managementPort}`)
      this.managementServer = await startManagementServer({
        host: this.options.managementHost,
        port: this.options.runtimeProfile.managementPort,
        environment: this.options.runtimeProfile.environment,
      })
      console.info(`[runtime] management server started listening=${this.managementServer.listening}`)
      console.info(`[runtime] starting proxy server host=${settings.listenHost} port=${settings.listenPort}`)
      await startProxyServer({ host: settings.listenHost, port: settings.listenPort })
      this.state = 'running'
      console.info(`[runtime] start completed state=${this.state}`)
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
    console.info(`[runtime] stop requested state=${this.state}`)
    try {
      await this.stopResources()
    } finally {
      this.state = 'stopped'
      console.info(`[runtime] stop completed state=${this.state}`)
    }
  }

  private async stopResources(): Promise<void> {
    console.info('[runtime] stopping resources')
    const names = ['proxy', 'management'] as const
    const results = await Promise.allSettled([stopProxyServer(), stopManagementServer()])
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') console.debug(`[runtime] resource stopped name=${names[index]}`)
      else console.error(`[runtime] resource stop failed name=${names[index]}`, result.reason)
    })
    destroyOutboundConnector()
    resetCoreNetworkConnector()
    await closeDatabase()
    this.managementServer = null

    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
    console.info('[runtime] resources stopped')
  }
}
