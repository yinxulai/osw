import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './database'
import { updateSettings } from './database/store'
import { startServer, stopServer } from './index'
import type { KeychainApi } from '@common/keychain'
import type { RuntimeProfile } from '@common/runtime-profile'

const secretStore: KeychainApi = {
  set: async () => undefined,
  get: async () => null,
  delete: async () => undefined,
}

let temporaryDirectory: string

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-server-'))
})

afterEach(async () => {
  await stopServer()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('server lifecycle', () => {
  it('keeps management available while the proxy is stopped and restarted', async () => {
    const [managementPort, proxyPort] = await Promise.all([getAvailablePort(), getAvailablePort()])
    await initDatabase(temporaryDirectory)
    await updateSettings({ listenHost: '127.0.0.1', listenPort: proxyPort })
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
    expect((await fetch(proxyUrl)).status).toBe(200)

    expect(await post(`${managementUrl}/stop`)).toMatchObject({
      success: true,
      data: { running: false, port: proxyPort },
    })
    expect(await post(`${managementUrl}/status`)).toMatchObject({
      success: true,
      data: { running: false, port: proxyPort },
    })
    await expect(fetch(proxyUrl)).rejects.toThrow()

    expect(await post(`${managementUrl}/restart`)).toMatchObject({
      success: true,
      data: { running: true, port: proxyPort },
    })
    expect((await fetch(proxyUrl)).status).toBe(200)
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

async function post(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
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
