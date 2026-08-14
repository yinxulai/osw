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
    expect(first.$client.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })

    await closeDatabase()

    expect(() => getDb()).toThrow('Database not initialized')

    const second = await initDatabase(createTemporaryDirectory())
    expect(second.$client.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
    expect(getDb()).toBe(second)
  })

  it('can be closed repeatedly', async () => {
    await initDatabase(createTemporaryDirectory())

    await closeDatabase()

    await expect(closeDatabase()).resolves.toBeUndefined()
  })

  it('migrates legacy protocols without deleting unsupported history', async () => {
    const directory = createTemporaryDirectory()
    const client = (await initDatabase(directory)).$client
    const time = Date.now()

    client
      .prepare(
        'INSERT INTO providers (id, name, apiKeyReference, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?)',
      )
      .run('provider', 'Legacy', 'key', time, time)
    client
      .prepare('INSERT INTO logical_models (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)')
      .run('model', 'Legacy', time, time)
    for (const protocol of ['openai', 'anthropic', 'gemini']) {
      client
        .prepare(
          'INSERT INTO model_bindings (id, logicalModelId, providerId, protocol, upstreamUrl, upstreamModelId, priority, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          `binding-${protocol}`,
          'model',
          'provider',
          protocol,
          'https://example.com',
          'legacy-model',
          1,
          time,
          time,
        )
      client
        .prepare(
          'INSERT INTO request_logs (id, logicalModelId, protocol, status, totalDurationMilliseconds, createdTime) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(`request-${protocol}`, 'model', protocol, 'success', 1, time)
    }

    await closeDatabase()
    const migrated = (await initDatabase(directory)).$client
    const bindings = migrated
      .prepare('SELECT protocol, enabled FROM model_bindings ORDER BY id ASC')
      .all()
    const logs = migrated.prepare('SELECT protocol FROM request_logs ORDER BY id ASC').all()

    expect(bindings).toEqual([
      { protocol: 'anthropic-messages', enabled: 1 },
      { protocol: 'gemini', enabled: 0 },
      { protocol: 'openai-completions', enabled: 1 },
    ])
    expect(logs.map(log => log.protocol)).toEqual([
      'anthropic-messages',
      'gemini',
      'openai-completions',
    ])
  })
})
