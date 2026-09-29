import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServiceRuntime } from './service-runtime'
import { createCaller, createRpcEndpoint, type RpcEndpoint } from './rpc'
import type { HostCalls, ServiceCalls, ServiceEvents } from './protocol'
import { lockFilePath } from '../runtime/instance-lock'
import { updateSettings } from '../database/settings-store'
import { createRuntimeConfig, type RuntimeConfig } from '@common/runtime-config'

// 这条测试把服务进程的「协议侧」整条跑通：一个真端口、一个真服务、真数据库、真监听。
// 唯独不拉进程——进程的失败模式（crash、exit code）归 `service-host.test.ts` 管。
//
// 用 `MessageChannel` 而不是手搓的假端口，是因为协议里唯一容易出错的地方就是消息的
// 异步性；同步的假端口会把「先 resolve 再挂 pending」这类顺序问题全部掩盖掉。

let temporaryDirectory: string
let dataDirectory: string
let channel: MessageChannel | null = null

interface Harness {
  calls: ReturnType<typeof createCaller<ServiceCalls>>
  /** 服务侧推给宿主的单向事件，按到达顺序记着。 */
  events: { ready: ServiceEvents['service.ready'][]; failed: unknown[]; settings: unknown[] }
  hostEndpoint: RpcEndpoint
  stop(): Promise<void>
}

interface HarnessOptions {
  /** 默认 true。设成 false 就是「宿主漏注册了 `runtime.config`」。 */
  serveRuntimeConfig?: boolean
}

async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const proxyPort = await getAvailablePort()
  const managementPort = await getAvailablePort()
  const runtimeConfig = createRuntimeConfig({
    environment: 'development',
    appVersion: '0.0.0-test',
    runtime: 'desktop',
    dataDir: dataDirectory,
    proxyPort,
    managementPort,
  })

  const pair = new MessageChannel()
  channel = pair
  const hostEndpoint = createRpcEndpoint(pair.port1)
  const calls = createCaller<ServiceCalls>(hostEndpoint)
  const events: Harness['events'] = { ready: [], failed: [], settings: [] }

  // 服务进程启动的第一步就是向宿主要这份配置；把处理器摘掉等于宿主漏注册，
  // 那种情况下「起不来」必须是显式失败而不是永远等下去。
  if (options.serveRuntimeConfig !== false) {
    hostEndpoint.handle('runtime.config', (): RuntimeConfig => runtimeConfig)
  }

  // 反向依赖：服务向宿主要密钥和系统代理（Electron 那边也只有宿主拿得到）。
  const secrets = new Map<string, string>()
  hostEndpoint.handle('secrets.set', params => {
    const { reference, value } = params as HostCalls['secrets.set']['params']
    secrets.set(reference, value)
  })
  hostEndpoint.handle('secrets.get', params => {
    const { reference } = params as HostCalls['secrets.get']['params']
    return secrets.get(reference) ?? null
  })
  hostEndpoint.handle('secrets.delete', params => {
    const { reference } = params as HostCalls['secrets.delete']['params']
    secrets.delete(reference)
  })
  hostEndpoint.handle('system.resolveProxy', () => 'DIRECT')

  const ready = new Promise<void>(resolve => {
    hostEndpoint.on('service.ready', payload => {
      events.ready.push(payload as ServiceEvents['service.ready'])
      resolve()
    })
  })
  hostEndpoint.on('service.failed', payload => {
    events.failed.push(payload)
  })
  hostEndpoint.on('settings.changed', payload => {
    events.settings.push(payload)
  })

  void startServiceRuntime({ port: pair.port2 })
  if (options.serveRuntimeConfig !== false) await ready

  return {
    calls,
    events,
    hostEndpoint,
    async stop() {
      await calls('runtime.stop', undefined).catch(() => undefined)
    },
  }
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-service-runtime-'))
  dataDirectory = path.join(temporaryDirectory, 'data')
})

afterEach(() => {
  channel?.port1.close()
  channel?.port2.close()
  channel = null
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('service runtime over rpc', () => {
  it('starts from the config the host serves', async () => {
    const harness = await startHarness()
    try {
      expect(harness.events.ready).toHaveLength(1)
      // 端口可能配的是 0（让系统挑），只有服务自己知道最终绑到了哪；
      // 拿到非 0 的端口就说明「配置过线 → 真的起了监听」这条链是通的。
      expect(harness.events.ready[0].endpoints.proxyPort).toBeGreaterThan(0)
      expect(harness.events.ready[0].endpoints.managementPort).toBeGreaterThan(0)
      expect(harness.events.ready[0].settings.listenPort).toBe(harness.events.ready[0].endpoints.proxyPort)
    } finally {
      await harness.stop()
    }
  })

  it('fails loudly when the host does not serve the runtime config', async () => {
    const harness = await startHarness({ serveRuntimeConfig: false })

    await waitFor(() => harness.events.failed.length > 0)
    expect(harness.events.failed[0]).toMatchObject({ message: 'Unknown remote method: runtime.config' })
    expect(harness.events.ready).toHaveLength(0)
  })

  it('announces ready with endpoints and settings', async () => {
    const harness = await startHarness()
    try {
      expect(harness.events.ready).toHaveLength(1)
      expect(harness.events.ready[0].endpoints.proxyPort).toBeGreaterThan(0)
      expect(harness.events.ready[0].settings.listenPort).toBe(harness.events.ready[0].endpoints.proxyPort)
    } finally {
      await harness.stop()
    }
  })

  it('answers the proxy and settings calls the host UI needs', async () => {
    const harness = await startHarness()
    try {
      expect(await harness.calls('proxy.status', undefined)).toMatchObject({ running: true })
      await harness.calls('proxy.stop', undefined)
      expect(await harness.calls('proxy.status', undefined)).toMatchObject({ running: false })
      await harness.calls('proxy.start', undefined)
      expect(await harness.calls('proxy.status', undefined)).toMatchObject({ running: true })
      expect(await harness.calls('settings.get', undefined)).toHaveProperty('language')
    } finally {
      await harness.stop()
    }
  })

  it('pushes settings changes instead of making the host poll', async () => {
    const harness = await startHarness()
    try {
      await harness.calls('settings.get', undefined)
      await updateSettings({ language: 'en' })

      await waitFor(() => harness.events.settings.length > 0)
      expect(harness.events.settings.at(-1)).toMatchObject({ language: 'en' })
    } finally {
      await harness.stop()
    }
  })

  it('releases the instance lock when asked to stop', async () => {
    const harness = await startHarness()
    expect(fs.existsSync(lockFilePath(dataDirectory))).toBe(true)

    await harness.stop()

    await waitFor(() => !fs.existsSync(lockFilePath(dataDirectory)))
    expect(fs.existsSync(lockFilePath(dataDirectory))).toBe(false)
  })
})

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate a local port'))
        return
      }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitFor(predicate: () => boolean, timeoutMilliseconds = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the expected state')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
