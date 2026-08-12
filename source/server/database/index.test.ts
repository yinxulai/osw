import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from './index'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await closeDatabase()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-db-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('database lifecycle', () => {
  it('clears the database reference on close and supports reinitialization', async () => {
    const first = await initDatabase(createTemporaryDirectory())
    await expect(first.$queryRaw`SELECT 1`).resolves.toBeDefined()

    await closeDatabase()

    expect(() => getDb()).toThrow('Database not initialized')

    const second = await initDatabase(createTemporaryDirectory())
    await expect(second.$queryRaw`SELECT 1`).resolves.toBeDefined()
    expect(second).not.toBe(first)
  })

  it('can be closed repeatedly', async () => {
    await initDatabase(createTemporaryDirectory())

    await closeDatabase()

    await expect(closeDatabase()).resolves.toBeUndefined()
  })

  it('migrates legacy protocols without deleting unsupported history', async () => {
    const directory = createTemporaryDirectory()
    const client = await initDatabase(directory)
    const time = BigInt(Date.now())

    await client.provider.create({
      data: { id: 'provider', name: 'Legacy', apiKeyReference: 'key', createdTime: time, updatedTime: time },
    })
    await client.logicalModel.create({
      data: { id: 'model', name: 'Legacy', createdTime: time, updatedTime: time },
    })
    for (const protocol of ['openai', 'anthropic', 'gemini']) {
      await client.modelBinding.create({
        data: {
          id: `binding-${protocol}`,
          logicalModelId: 'model',
          providerId: 'provider',
          protocol,
          upstreamUrl: 'https://example.com',
          upstreamModelId: 'legacy-model',
          priority: 1,
          createdTime: time,
          updatedTime: time,
        },
      })
      await client.requestLog.create({
        data: {
          id: `request-${protocol}`,
          logicalModelId: 'model',
          protocol,
          status: 'success',
          totalDurationMilliseconds: 1,
          createdTime: time,
        },
      })
    }

    await closeDatabase()
    const migrated = await initDatabase(directory)
    const bindings = await migrated.modelBinding.findMany({ orderBy: { id: 'asc' } })
    const logs = await migrated.requestLog.findMany({ orderBy: { id: 'asc' } })

    expect(bindings.map(binding => ({ protocol: binding.protocol, enabled: binding.enabled }))).toEqual([
      { protocol: 'anthropic-messages', enabled: true },
      { protocol: 'gemini', enabled: false },
      { protocol: 'openai-completions', enabled: true },
    ])
    expect(logs.map(log => log.protocol)).toEqual([
      'anthropic-messages',
      'gemini',
      'openai-completions',
    ])
  })
})
