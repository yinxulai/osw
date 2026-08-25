import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import { configureSettingsDefaults, getSettings, onSettingsChanged, updateSettings } from './settings-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-settings-store-'))
  await initDatabase(temporaryDirectory)
  configureSettingsDefaults({ listenPort: 9300 })
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('settings store', () => {
  it('stores real settings values and notifies listeners', async () => {
    const listener = vi.fn()
    const unsubscribe = onSettingsChanged(listener)

    const updated = await updateSettings({
      listenPort: 9400,
      logRetentionDays: 14,
      captureRequestContent: false,
      consecutiveFailureThreshold: 5,
      idleTimeoutMilliseconds: 45_000,
    })

    expect(updated).toMatchObject({
      listenPort: 9400,
      logRetentionDays: 14,
      captureRequestContent: false,
      consecutiveFailureThreshold: 5,
      idleTimeoutMilliseconds: 45_000,
    })

    expect(await getSettings()).toMatchObject({
      listenPort: 9400,
      logRetentionDays: 14,
      captureRequestContent: false,
    })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ listenPort: 9400 }))

    unsubscribe()
  })

  it('falls back to configured defaults when a key is absent', async () => {
    configureSettingsDefaults({ listenPort: 9500 })

    const settings = await getSettings()
    expect(settings.listenPort).toBe(9500)
  })
})
