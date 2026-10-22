import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './database'
import { updateSettings } from './database/settings-store'
import { startServer, stopServer } from './index'
import type { StartServerOptions } from './index'
import { getProxyServerStatus, startProxyServer, stopProxyServer } from './proxy/runtime/server'
import type { SecretStore } from '@common/secret-store'
import { createRuntimeConfig, type RuntimeConfig } from '@common/runtime-config'

const secrets = new Map<string, string>()
const secretStore: SecretStore = {
  set: async (reference, value) => { secrets.set(reference, value) },
  get: async reference => secrets.get(reference) ?? null,
  delete: async reference => { secrets.delete(reference) },
}

let temporaryDirectory: string

/**
 * 本次运行的管理 API 凭证。
 *
 * 真实宿主（桌面 / 命令行）在**应用启动**时生成一次再交给 core，测试这里扮演宿主。
 * 刻意写死而不是随机：它要是跟着 `startServer` 重算，下面那条「停服再启后同一份凭证
 * 仍然能用」的断言就永远发现不了回归。
 */
const MANAGEMENT_TOKEN = 'test-management-token'

function startTestServer(options: StartServerOptions): Promise<unknown> {
  return startServer(options)
}

beforeEach(() => {
  secrets.clear()
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-server-'))
})

afterEach(async () => {
  await stopServer()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('server lifecycle', () => {
  it('reports the port actually bound by the proxy server', async () => {
    const proxyPort = await getAvailablePort()
    await initDatabases(temporaryDirectory)
    await updateSettings({ listenHost: '127.0.0.1', listenPort: 9300 })

    try {
      await startProxyServer({ port: proxyPort })

      expect(await getProxyServerStatus()).toMatchObject({
        running: true,
        port: proxyPort,
      })
    } finally {
      await stopProxyServer()
      await closeDatabases()
    }
  })

  it('keeps management available while the proxy is stopped and restarted', async () => {
    const [managementPort, proxyPort] = await Promise.all([getAvailablePort(), getAvailablePort()])
    await initDatabases(temporaryDirectory)
    await updateSettings({ listenHost: '127.0.0.1', listenPort: proxyPort })
    await closeDatabases()
    await startTestServer({
      secretStore,
      runtimeConfig: createTestRuntimeConfig(proxyPort, managementPort),
    })

    const managementUrl = `http://127.0.0.1:${managementPort}/api/proxy`
    const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/models`

    expect(await post(`${managementUrl}/status`)).toMatchObject({
      success: true,
      data: { running: true, port: proxyPort },
    })
    const modelsResponse = await fetch(proxyUrl)
    expect(modelsResponse.status).toBe(200)
    expect(await modelsResponse.json()).toEqual({
      object: 'list',
      data: [{ id: 'default', object: 'model', created: 0, owned_by: 'osw' }],
    })

    expect(await post(`${managementUrl}/stop`)).toMatchObject({
      success: true,
      data: { running: false, port: proxyPort },
    })
    expect(await post(`${managementUrl}/status`)).toMatchObject({
      success: true,
      data: { running: false, port: proxyPort },
    })
    await expect(fetch(proxyUrl)).rejects.toThrow()

    // The normal UI flow is stop -> start (not only the restart endpoint).
    expect(await post(`${managementUrl}/start`)).toMatchObject({
      success: true,
      data: { running: true, port: proxyPort },
    })
    expect((await fetch(proxyUrl)).status).toBe(200)

    expect(await post(`${managementUrl}/restart`)).toMatchObject({
      success: true,
      data: { running: true, port: proxyPort },
    })
    expect((await fetch(proxyUrl)).status).toBe(200)

    const newProxyPort = await getAvailablePort()
    await post(`http://127.0.0.1:${managementPort}/api/settings/update`, { listenPort: newProxyPort })
    expect(await post(`${managementUrl}/restart`)).toMatchObject({
      success: true,
      data: { running: true, port: newProxyPort },
    })
    expect((await fetch(`http://127.0.0.1:${newProxyPort}/v1/models`)).status).toBe(200)
  })

  it('keeps the credential the host handed over for the whole run', async () => {
    const [managementPort, proxyPort] = await Promise.all([getAvailablePort(), getAvailablePort()])
    await initDatabases(temporaryDirectory)
    await updateSettings({ listenHost: '127.0.0.1', listenPort: proxyPort })
    await closeDatabases()
    await startTestServer({
      secretStore,
      runtimeConfig: createTestRuntimeConfig(proxyPort, managementPort),
    })

    const endpoint = `http://127.0.0.1:${managementPort}/api/proxy/status`
    // 带对的凭证：通；带错的：401。这两条合起来才能证明凭证真的在起作用，
    // 只测其中一条的话，一个「什么都不校验」的实现也能过。
    expect(await post(endpoint)).toMatchObject({ success: true })
    const rejected = await fetch(endpoint, {
      method: 'POST',
      // 不带浏览器痕迹也一样是 401：凭证没有例外，`Origin` 与 `Sec-Fetch-*` 不再是判据。
      headers: { 'Content-Type': 'application/json', 'X-OSW-Token': 'not-the-token', Connection: 'close' },
      body: '{}',
    })
    expect(rejected.status).toBe(401)

    await stopServer()
  })

  it('isolates manual selection by logical model through the management API', async () => {
    const [managementPort, proxyPort] = await Promise.all([getAvailablePort(), getAvailablePort()])
    await initDatabases(temporaryDirectory)
    await updateSettings({ listenHost: '127.0.0.1', listenPort: proxyPort })
    await closeDatabases()
    const runtimeOptions = {
      secretStore,
      runtimeConfig: createTestRuntimeConfig(proxyPort, managementPort),
    }
    await startTestServer(runtimeOptions)
    const logicalModelUrl = `http://127.0.0.1:${managementPort}/api/logical-model`

    expect(await post(`${logicalModelUrl}/switch`, { logicalModelId: 'default', modelId: 'model_auto' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'default', modelId: 'model_auto' },
    })
    expect(await post(`${logicalModelUrl}/switch`, { logicalModelId: 'secondary', modelId: 'model_secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', modelId: 'model_secondary' },
    })
    expect(await post(`${logicalModelUrl}/status`, { logicalModelId: 'default' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'default', manualModelId: 'model_auto' },
    })
    expect(await post(`${logicalModelUrl}/status`, { logicalModelId: 'secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', manualModelId: 'model_secondary' },
    })

    await post(`http://127.0.0.1:${managementPort}/api/proxy/restart`)
    expect(await post(`${logicalModelUrl}/status`, { logicalModelId: 'secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', manualModelId: 'model_secondary' },
    })

    await post(`${logicalModelUrl}/switch`, { logicalModelId: 'default', modelId: null })
    expect(await post(`${logicalModelUrl}/status`, { logicalModelId: 'secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', manualModelId: 'model_secondary' },
    })

    await stopServer()
    await startTestServer(runtimeOptions)
    expect(await post(`${logicalModelUrl}/status`, { logicalModelId: 'default' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'default', manualModelId: null },
    })
    expect(await post(`${logicalModelUrl}/status`, { logicalModelId: 'secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', manualModelId: null },
    })
  })

})

function createTestRuntimeConfig(proxyPort: number, managementPort: number): RuntimeConfig {
  return createRuntimeConfig({
    environment: 'development',
    appVersion: '0.0.0-test',
    runtime: 'desktop',
    dataDir: temporaryDirectory,
    proxyPort,
    managementPort,
    managementToken: MANAGEMENT_TOKEN,
  })
}

async function post(url: string, body: unknown = {}): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 管理 API 只认本次启动的凭证，没这个头一律 401。
      'X-OSW-Token': MANAGEMENT_TOKEN,
      Connection: 'close',
    },
    body: JSON.stringify(body),
  })
  return response.json()
}

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
