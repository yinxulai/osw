import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryEventInput } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
import { getSettings } from '@server/database/settings-store'
import { settingsRoutes } from './routes/operations/settings'
import { mockResponse } from './test-support'

/**
 * 切换生效模式是一次产品行为，这里是它唯一的写入口。要点是**只有真的换了才发**：
 * 界面保存任何一项设置都会把整个设置对象回写一遍，照「请求里带了这个字段」计数，
 * 数出来的是「保存过几次设置」。
 */
const { reported } = vi.hoisted(() => ({ reported: [] as TelemetryEventInput[] }))

vi.mock('@server/telemetry', () => ({
  reportTelemetryEvent: (event: TelemetryEventInput) => {
    reported.push(event)
  },
}))

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-settings-route-'))
  await initDatabases(temporaryDirectory)
  reported.length = 0
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function update(updates: Record<string, unknown>): Promise<void> {
  await settingsRoutes.invoke('/api/settings/update', mockResponse(), updates)
}

describe('settings read-back', () => {
  it('returns exactly what was written, so the form and the file agree', async () => {
    await update({ telemetryEnabled: false, listenPort: 9411 })

    const response = await settingsRoutes.request('/api/settings/get', {})

    expect(response.statusCode).toBe(200)
    expect(response.json<{ success: boolean; data: { telemetryEnabled: boolean; listenPort: number } }>().data).toMatchObject({
      telemetryEnabled: false,
      listenPort: 9411,
    })
  })

  it('rejects a custom proxy url that is not a url', async () => {
    // 空地址与非法协议都在 `validateOutboundProxyModeAndUrl` 里挡：写进库之后，
    // 下一次出站请求才会以「连不上」的形式暴露，那时离用户的操作已经很远了。
    await expect(settingsRoutes.request('/api/settings/update', { outboundProxyMode: 'custom', outboundProxyUrl: 'ftp://proxy.local' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('clears the stored url when the mode goes back to direct', async () => {
    await update({ outboundProxyMode: 'custom', outboundProxyUrl: 'http://127.0.0.1:7890' })

    await update({ outboundProxyMode: 'direct', outboundProxyUrl: '' })

    const settings = await getSettings()
    expect(settings.outboundProxyMode).toBe('direct')
    expect(settings.outboundProxyUrl).toBe('')
  })
})

describe('route_mode_changed reporting', () => {
  it('reports the new mode when it really changes', async () => {
    // 默认是 `workflow`，切到 `rules` 才算换过。
    await update({ routeMode: 'rules' })

    expect(reported).toEqual([{ name: 'route_mode_changed', mode: 'rules' }])
  })

  it('stays silent when the same mode is written back', async () => {
    await update({ routeMode: 'workflow' })

    expect(reported).toEqual([])
  })

  it('stays silent when another setting is saved', async () => {
    await update({ telemetryEnabled: false })

    expect(reported).toEqual([])
  })
})
