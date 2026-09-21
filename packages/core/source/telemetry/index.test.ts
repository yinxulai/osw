import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '@common/runtime-config'
import type { TelemetryBatch } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
import { updateSettings } from '../database/settings-store'
import { previewTelemetry, reportTelemetryEvent, reportTelemetryStartFailure, startTelemetry } from './index'
import { TELEMETRY_ID_FILE_NAME } from './install-id'

/**
 * 入口这一层的判断题都在「该不该上报」上：开发档、开关、宿主平台、标识可用性。
 * 报文长什么样属于 `sender.test.ts`，队列行为属于 `queue.test.ts`。
 *
 * 端点指向本地桩服务，整个文件不碰网络。
 */

interface StubEndpoint {
  url: string
  batches: TelemetryBatch[]
  close: () => Promise<void>
}

async function startEndpoint(): Promise<StubEndpoint> {
  const batches: TelemetryBatch[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += String(chunk)
    })
    req.on('end', () => {
      batches.push(JSON.parse(body) as TelemetryBatch)
      res.statusCode = 200
      res.end('{}')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('stub endpoint did not start')
  return {
    url: `http://127.0.0.1:${address.port}/v1/track`,
    batches,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

function createConfig(dataDir: string, environment: RuntimeConfig['environment']): RuntimeConfig {
  return {
    environment,
    appVersion: '1.1.0-beta.14',
    runtime: 'desktop',
    dataDir,
    proxyHost: '127.0.0.1',
    proxyPort: 19_300,
    managementHost: '127.0.0.1',
    managementPort: 19_301,
    serveWeb: false,
    webRoot: null,
  }
}

function idFilePath(dataDir: string): string {
  return path.join(dataDir, TELEMETRY_ID_FILE_NAME)
}

/** 等到启动流程真的落定：标识文件出现在磁盘上是它走完的标志。 */
async function waitForIdFile(dataDir: string): Promise<void> {
  await vi.waitFor(() => expect(fs.existsSync(idFilePath(dataDir))).toBe(true))
}

/** 断言之「什么都没发生」时，只能给它几个宏任务的时间。 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
}

let dataDir: string
let endpoint: StubEndpoint
let stop: (() => void) | null
let config: RuntimeConfig

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-telemetry-'))
  await initDatabases(dataDir)
  endpoint = await startEndpoint()
  // 设置里默认就是开的（见 `SettingsSchema`），所以先显式关掉：每条用例只在自己关心的时候打开。
  await updateSettings({ telemetryEndpoint: endpoint.url, telemetryEnabled: false })
  stop = null
  config = createConfig(dataDir, 'production')
})

afterEach(async () => {
  stop?.()
  stop = null
  await closeDatabases()
  await endpoint.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('startTelemetry', () => {
  it('does nothing outside production, whatever the setting says', async () => {
    // 开发期产生的启动次数会污染真实数据，所以这一条与开关无关。
    await updateSettings({ telemetryEnabled: true })
    stop = startTelemetry(createConfig(dataDir, 'development'))

    await settle()

    expect(fs.existsSync(idFilePath(dataDir))).toBe(false)
    expect(endpoint.batches).toEqual([])
  })

  it('does not even create an install id while the switch is off', async () => {
    // 「装了应用就先留一份痕迹」是明确要避免的：标识文件只在真要上报时才出现。
    stop = startTelemetry(config)

    await settle()

    expect(fs.existsSync(idFilePath(dataDir))).toBe(false)
    expect(previewTelemetry()).toMatchObject({ enabled: false, running: false, source: 'sample', events: [] })
  })

  it('queues app_started with the envelope once the switch is on', async () => {
    await updateSettings({ telemetryEnabled: true })
    stop = startTelemetry(config)
    await waitForIdFile(dataDir)

    await vi.waitFor(() => expect(previewTelemetry().running).toBe(true))
    const preview = previewTelemetry()

    expect(preview).toMatchObject({ enabled: true, running: true, endpoint: endpoint.url, source: 'queue' })
    expect(preview.events).toHaveLength(1)
    expect(preview.events[0]).toMatchObject({
      name: 'app_started',
      version: '1.1.0-beta.14',
      runtime: 'desktop',
      os: process.platform,
      arch: process.arch,
    })
    // 预览里的标识与磁盘上的那一份必须同一个：否则「展示的就是要发的」不成立。
    expect(preview.installId).toBe(fs.readFileSync(idFilePath(dataDir), 'utf8').trim())
  })

  it('reports telemetry_toggled and flushes it when the user turns the switch on', async () => {
    // 关→开也要发一条：否则服务端只看到「关了」，看不到「开了又关」的来回。
    stop = startTelemetry(config)
    await settle()

    await updateSettings({ telemetryEnabled: true })

    await vi.waitFor(() => expect(endpoint.batches).toHaveLength(1))
    expect(endpoint.batches[0]?.events.map(event => event.name)).toEqual(['telemetry_toggled'])
    expect(endpoint.batches[0]?.events[0]).toMatchObject({ enabled: true })
  })

  it('flushes the last batch when the user turns the switch off', async () => {
    await updateSettings({ telemetryEnabled: true })
    stop = startTelemetry(config)
    await waitForIdFile(dataDir)

    await updateSettings({ telemetryEnabled: false })

    await vi.waitFor(() => expect(endpoint.batches).toHaveLength(1))
    // 关闭时把队列里还压着的一起发出去：那条 `app_started` 等的就是这个最后的机会。
    expect(endpoint.batches[0]?.events.map(event => event.name)).toEqual(['app_started', 'telemetry_toggled'])
    expect(endpoint.batches[0]?.events.at(-1)).toMatchObject({ enabled: false })
    expect(previewTelemetry().enabled).toBe(false)
  })

  it('stops reporting and drops the queue on shutdown', async () => {
    await updateSettings({ telemetryEnabled: true })
    stop = startTelemetry(config)
    await waitForIdFile(dataDir)

    stop()
    stop = null
    reportTelemetryEvent({ name: 'logs_exported', withContent: false })

    expect(previewTelemetry()).toMatchObject({ running: false, source: 'sample', events: [] })
    expect(endpoint.batches).toEqual([])
  })
})

describe('reportTelemetryEvent', () => {
  it('is a no-op before start', () => {
    expect(() => reportTelemetryEvent({ name: 'app_started' })).not.toThrow()
  })

  it('adds the event to the running queue', async () => {
    await updateSettings({ telemetryEnabled: true })
    stop = startTelemetry(config)
    await vi.waitFor(() => expect(previewTelemetry().running).toBe(true))

    reportTelemetryEvent({ name: 'route_mode_changed', mode: 'rules' })

    expect(previewTelemetry().events.map(event => event.name)).toEqual(['app_started', 'route_mode_changed'])
  })
})

describe('reportTelemetryStartFailure', () => {
  it('reports the reason straight away when the switch is on', async () => {
    // 失败路径上队列还没起来，这条走的是「一次性直接发」。
    await updateSettings({ telemetryEnabled: true })

    await reportTelemetryStartFailure(config, 'port')

    expect(endpoint.batches).toHaveLength(1)
    expect(endpoint.batches[0]?.events).toHaveLength(1)
    expect(endpoint.batches[0]?.events[0]).toMatchObject({ name: 'service_start_failed', reason: 'port' })
  })

  it('stays silent while the switch is off', async () => {
    await reportTelemetryStartFailure(config, 'database')

    expect(endpoint.batches).toEqual([])
    // 拿不到「采集是被允许的」这个前提，宁可不发；也不该为此留下标识文件。
    expect(fs.existsSync(idFilePath(dataDir))).toBe(false)
  })

  it('stays silent outside production', async () => {
    await updateSettings({ telemetryEnabled: true })

    await reportTelemetryStartFailure(createConfig(dataDir, 'development'), 'instance_lock')

    expect(endpoint.batches).toEqual([])
  })
})

describe('previewTelemetry', () => {
  it('falls back to the built-in endpoint before settings are loaded', () => {
    // 设置还没读出来时也要给得出一个端点，且不能是空字符串。
    expect(previewTelemetry().endpoint).toMatch(/^https:\/\//)
  })
})
