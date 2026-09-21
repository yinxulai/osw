import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryEventInput } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
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
