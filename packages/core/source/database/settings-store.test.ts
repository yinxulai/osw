import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import { configureSettingsDefaults, getSettings, onSettingsChanged, updateSettings } from './settings-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-settings-store-'))
  await initDatabases(temporaryDirectory)
  configureSettingsDefaults({ listenHost: '127.0.0.1', listenPort: 9300, managementAuthEnabled: false })
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('settings store', () => {
  it('stores real settings values and notifies listeners', async () => {
    const listener = vi.fn()
    const unsubscribe = onSettingsChanged(listener)

    const updated = await updateSettings({
      listenPort: 9400,
      captureRequestLogs: true,
      requestLogRetentionDays: 0,
      captureRequestContent: false,
      contentRetentionDays: 3,
      consecutiveFailureThreshold: 5,
      idleTimeoutMilliseconds: 45_000,
    })

    expect(updated).toMatchObject({
      listenPort: 9400,
      captureRequestLogs: true,
      requestLogRetentionDays: 0,
      captureRequestContent: false,
      contentRetentionDays: 3,
      consecutiveFailureThreshold: 5,
      idleTimeoutMilliseconds: 45_000,
    })

    expect(await getSettings()).toMatchObject({
      listenPort: 9400,
      captureRequestLogs: true,
      requestLogRetentionDays: 0,
      captureRequestContent: false,
      contentRetentionDays: 3,
    })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ listenPort: 9400 }))

    unsubscribe()
  })

  it('falls back to configured defaults when a key is absent', async () => {
    // 三个字段都要给：默认值是「这次启动的缺省」，`managementAuthEnabled` 由监听地址决定，
    // 所以它不是一个可以省略的常量。
    configureSettingsDefaults({ listenHost: '127.0.0.1', listenPort: 9500, managementAuthEnabled: true })

    const settings = await getSettings()
    expect(settings.listenPort).toBe(9500)
    expect(settings.managementAuthEnabled).toBe(true)
  })
})
