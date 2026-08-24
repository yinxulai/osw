import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './database'
import { updateSettings } from './database/settings-store'
import { startServer, stopServer } from './index'
import { getProxyServerStatus, startProxyServer, stopProxyServer } from './proxy/server'
import type { KeychainApi } from '@common/keychain'
import type { RuntimeProfile } from '@common/runtime-profile'

const secrets = new Map<string, string>()
const secretStore: KeychainApi = {
  set: async (reference, value) => { secrets.set(reference, value) },
  get: async reference => secrets.get(reference) ?? null,
  delete: async reference => { secrets.delete(reference) },
}

let temporaryDirectory: string

beforeEach(() => {
  secrets.clear()
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-server-'))
})

afterEach(async () => {
  await stopServer()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('server lifecycle', () => {
  it('reports the port actually bound by the proxy server', async () => {
    const proxyPort = await getAvailablePort()
    await initDatabase(temporaryDirectory)
    await updateSettings({ listenHost: '127.0.0.1', listenPort: 9300 })

    try {
      await startProxyServer({ port: proxyPort })

      expect(await getProxyServerStatus()).toMatchObject({
        running: true,
        port: proxyPort,
      })
    } finally {
      await stopProxyServer()
      await closeDatabase()
    }
  })

  it('keeps management available while the proxy is stopped and restarted', async () => {
    const [managementPort, proxyPort] = await Promise.all([getAvailablePort(), getAvailablePort()])
    await initDatabase(temporaryDirectory)
    await updateSettings({ listenHost: '127.0.0.1', listenPort: 9300 })
    await closeDatabase()
    await startServer({
      dataDir: temporaryDirectory,
      secretStore,
      runtimeProfile: createTestRuntimeProfile(proxyPort, managementPort),
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
      data: [{ id: 'default', object: 'model', created: 0, owned_by: 'one-switch' }],
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
  })

  it('isolates manual queue selection by logical model through the management API', async () => {
    const [managementPort, proxyPort] = await Promise.all([getAvailablePort(), getAvailablePort()])
    await initDatabase(temporaryDirectory)
    await updateSettings({ listenHost: '127.0.0.1', listenPort: proxyPort })
    await closeDatabase()
    const runtimeOptions = {
      dataDir: temporaryDirectory,
      secretStore,
      runtimeProfile: createTestRuntimeProfile(proxyPort, managementPort),
    }
    await startServer(runtimeOptions)
    const queueUrl = `http://127.0.0.1:${managementPort}/api/queue`

    expect(await post(`${queueUrl}/switch`, { logicalModelId: 'default', modelId: 'model_auto' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'default', modelId: 'model_auto' },
    })
    expect(await post(`${queueUrl}/switch`, { logicalModelId: 'secondary', modelId: 'model_secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', modelId: 'model_secondary' },
    })
    expect(await post(`${queueUrl}/status`, { logicalModelId: 'default' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'default', manualModelId: 'model_auto' },
    })
    expect(await post(`${queueUrl}/status`, { logicalModelId: 'secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', manualModelId: 'model_secondary' },
    })

    await post(`http://127.0.0.1:${managementPort}/api/proxy/restart`)
    expect(await post(`${queueUrl}/status`, { logicalModelId: 'secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', manualModelId: 'model_secondary' },
    })

    await post(`${queueUrl}/switch`, { logicalModelId: 'default', modelId: null })
    expect(await post(`${queueUrl}/status`, { logicalModelId: 'secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', manualModelId: 'model_secondary' },
    })

    await stopServer()
    await startServer(runtimeOptions)
    expect(await post(`${queueUrl}/status`, { logicalModelId: 'default' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'default', manualModelId: null },
    })
    expect(await post(`${queueUrl}/status`, { logicalModelId: 'secondary' })).toMatchObject({
      success: true,
      data: { logicalModelId: 'secondary', manualModelId: null },
    })
  })

})

function createTestRuntimeProfile(proxyPort: number, managementPort: number): RuntimeProfile {
  return {
    environment: 'development',
    userDataDirectoryName: 'One Switch Test',
    proxyPort,
    managementPort,
    managementApiUrl: `http://127.0.0.1:${managementPort}/api`,
  }
}

async function post(url: string, body: unknown = {}): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
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
