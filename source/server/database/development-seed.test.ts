import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeychainApi } from '@common/keychain'
import { closeDatabase, initDatabase } from './index'
import { seedDevelopmentData } from './development-seed'
import { createProvider, listLogicalModels, listProviders, listRequestLogs, listUpstreamModels } from './store'

let temporaryDirectory: string
let secretStore: KeychainApi

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-seed-'))
  await initDatabase(temporaryDirectory)
  secretStore = {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  }
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('development seed', () => {
  it('populates an empty development database with representative data', async () => {
    expect(await seedDevelopmentData(secretStore)).toBe(true)

    expect(await listProviders()).toHaveLength(4)
    expect(await listLogicalModels()).toHaveLength(3)
    expect(await listUpstreamModels()).toHaveLength(7)
    expect(await listRequestLogs()).toHaveLength(18)
    expect(secretStore.set).toHaveBeenCalledTimes(4)
  })

  it('does not modify a database that already has configuration', async () => {
    await createProvider({
      name: 'Existing provider',
      apiKeyReference: 'key_existing',
      timeoutMilliseconds: 30_000,
      enabled: true,
      upstreamUrls: '{}',
    })

    expect(await seedDevelopmentData(secretStore)).toBe(false)
    expect((await listProviders()).map(provider => provider.name)).toEqual(['Existing provider'])
    expect(secretStore.set).not.toHaveBeenCalled()
  })

  it('fills missing fixtures without overwriting existing configuration', async () => {
    await createProvider({
      name: 'Existing provider',
      apiKeyReference: 'key_existing',
      timeoutMilliseconds: 30_000,
      enabled: true,
      upstreamUrls: '{}',
    })

    expect(await seedDevelopmentData(secretStore, { allowExisting: true })).toBe(true)
    expect((await listProviders()).map(provider => provider.name)).toContain('Existing provider')
    expect(await listProviders()).toHaveLength(5)
    expect(secretStore.set).toHaveBeenCalledTimes(4)

    expect(await seedDevelopmentData(secretStore, { allowExisting: true })).toBe(false)
    expect(await listProviders()).toHaveLength(5)
    expect(await listLogicalModels()).toHaveLength(3)
    expect(await listUpstreamModels()).toHaveLength(7)
    expect(await listRequestLogs()).toHaveLength(18)
    expect(secretStore.set).toHaveBeenCalledTimes(4)
  })
})
