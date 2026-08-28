import type { Server } from 'node:http'
import { getSettings } from '@server/database/settings-store'
import { ProxyRuntime } from './proxy-runtime'

export interface ProxyServerStatus {
  running: boolean
  host: string
  port: number
}

export interface ProxyServerOptions {
  host?: string
  port?: number
}

let proxyRuntime: ProxyRuntime | null = null

export async function startProxyServer(options: ProxyServerOptions = {}): Promise<Server> {
  const runtime = getOrCreateRuntime(options)
  await runtime.start(resolveEndpoint(runtime, options))
  return getServer(runtime)
}

export async function stopProxyServer(): Promise<void> {
  if (!proxyRuntime) return
  await proxyRuntime.stop()
}

export async function restartProxyServer(options: ProxyServerOptions = {}): Promise<Server> {
  const runtime = getOrCreateRuntime(options)
  await runtime.restart(resolveEndpoint(runtime, options))
  return getServer(runtime)
}

export async function getProxyServerStatus(): Promise<ProxyServerStatus> {
  if (!proxyRuntime) {
    const settings = await getSettings()
    return { running: false, host: settings.listenHost, port: settings.listenPort }
  }
  return proxyRuntime.getStatus()
}

function getOrCreateRuntime(options: ProxyServerOptions): ProxyRuntime {
  if (proxyRuntime) return proxyRuntime
  if (options.host === undefined && options.port === undefined) {
    throw new Error('Proxy runtime endpoint must be provided before the first start')
  }
  proxyRuntime = new ProxyRuntime({ host: options.host ?? '127.0.0.1', port: options.port! })
  return proxyRuntime
}

function resolveEndpoint(runtime: ProxyRuntime, options: ProxyServerOptions): { host: string; port: number } {
  const current = runtime.getStatus()
  return {
    host: options.host ?? current.host,
    port: options.port ?? current.port,
  }
}

function getServer(runtime: ProxyRuntime): Server {
  const server = runtime.getServer()
  if (!server) throw new Error('Proxy runtime is not running')
  return server
}
