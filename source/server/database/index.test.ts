import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

  it('seeds a default logical model on a fresh database', async () => {
    const client = (await initDatabase(createTemporaryDirectory())).$client

    const rows = client.prepare('SELECT id, name, enabled FROM logical_models').all()
    expect(rows).toEqual([{ id: 'default', name: '默认模型', enabled: 1 }])
  })

  it('does not seed a default logical model when one already exists', async () => {
    const directory = createTemporaryDirectory()
    const client = (await initDatabase(directory)).$client
    const time = Date.now()

    client.prepare('DELETE FROM logical_models').run()
    client
      .prepare('INSERT INTO logical_models (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)')
      .run('custom', 'Custom', time, time)

    await closeDatabase()
    const reopened = (await initDatabase(directory)).$client

    const rows = reopened.prepare('SELECT id FROM logical_models').all()
    expect(rows).toEqual([{ id: 'custom' }])
  })

  it('creates the upstream_models table with endpoints column', async () => {
    const directory = createTemporaryDirectory()
    const client = (await initDatabase(directory)).$client
    const time = Date.now()

    client
      .prepare(
        'INSERT INTO providers (id, name, apiKeyReference, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?)',
      )
      .run('provider', 'Provider', 'key', time, time)
    client
      .prepare('INSERT INTO logical_models (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)')
      .run('model', 'Model', time, time)
    client
      .prepare(
        'INSERT INTO upstream_models (id, providerId, upstreamModelId, endpoints, priority, enabled, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'model_upstream',
        'provider',
        'upstream-model',
        JSON.stringify([
          {
            protocol: 'openai-completions',
            upstreamUrl: 'https://api.example.com/v1/chat/completions',
            customAuthHeader: null,
          },
        ]),
        1,
        1,
        time,
        time,
      )

    const rows = client
      .prepare(
        'SELECT upstreamModelId, endpoints, enabled FROM upstream_models WHERE id = ?',
      )
      .all('model_upstream')

    expect(rows).toHaveLength(1)
    expect(rows[0].upstreamModelId).toBe('upstream-model')
    expect(rows[0].enabled).toBe(1)
    expect(JSON.parse(String(rows[0].endpoints))).toEqual([
      {
        protocol: 'openai-completions',
        upstreamUrl: 'https://api.example.com/v1/chat/completions',
        customAuthHeader: null,
      },
    ])
  })

  it('adds raw usage to an existing database without losing request logs', async () => {
    const directory = createTemporaryDirectory()
    const databasePath = path.join(directory, 'one-switch.db')
    const legacyClient = new DatabaseSync(databasePath)
    legacyClient.exec(`
      CREATE TABLE request_logs (
        id TEXT PRIMARY KEY NOT NULL,
        logicalModelId TEXT NOT NULL,
        protocol TEXT NOT NULL,
        status TEXT NOT NULL,
        totalDurationMilliseconds INTEGER NOT NULL,
        totalTokens INTEGER,
        inputTokens INTEGER,
        outputTokens INTEGER,
        ttftMilliseconds INTEGER,
        cacheHit INTEGER,
        createdTime BIGINT NOT NULL
      );
      INSERT INTO request_logs (
        id, logicalModelId, protocol, status, totalDurationMilliseconds, createdTime
      ) VALUES ('legacy-request', 'model', 'openai-responses', 'success', 25, 1);
    `)
    legacyClient.close()

    const client = (await initDatabase(directory)).$client
    const columns = client.prepare('PRAGMA table_info(request_logs)').all()
    const row = client.prepare('SELECT id, rawUsage FROM request_logs WHERE id = ?').get('legacy-request')

    expect(columns.map(column => (column as { name: string }).name)).toEqual(
      expect.arrayContaining(['rawUsage', 'cachedInputTokens', 'cacheCreationInputTokens', 'promptCacheHit']),
    )
    expect(row).toEqual({ id: 'legacy-request', rawUsage: null })
  })

  it('creates the complete release baseline without migration artifacts', async () => {
    const client = (await initDatabase(createTemporaryDirectory())).$client
    const tables = client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
    const requestLogColumns = client.prepare('PRAGMA table_info(request_logs)').all()
    const settingsColumns = client.prepare('PRAGMA table_info(settings)').all()
    const attemptForeignKeys = client.prepare('PRAGMA foreign_key_list(request_attempts)').all()
    const attemptIndexes = client.prepare('PRAGMA index_list(request_attempts)').all()

    expect(tables).toEqual([
      { name: 'logical_models' },
      { name: 'provider_health' },
      { name: 'providers' },
      { name: 'request_attempts' },
      { name: 'request_logs' },
      { name: 'settings' },
      { name: 'upstream_models' },
    ])
    expect(requestLogColumns.map(column => (column as { name: string }).name)).toEqual(
      expect.arrayContaining([
        'inputTokens',
        'outputTokens',
        'cachedInputTokens',
        'cacheCreationInputTokens',
        'promptCacheHit',
        'rawUsage',
        'ttftMilliseconds',
        'cacheHit',
      ]),
    )
    expect(settingsColumns.map(column => (column as { name: string }).name)).toContain(
      'autoLaunch',
    )
    expect(attemptForeignKeys.map(key => (key as { table: string }).table)).toEqual([
      'providers',
      'request_logs',
    ])
    expect(attemptIndexes.map(index => (index as { name: string }).name)).toContain(
      'idx_attempts_request_order',
    )
    expect(() => client.prepare('INSERT INTO settings (id, updatedTime) VALUES (?, ?)').run(
      'another-settings-row',
      Date.now(),
    )).toThrow()
  })
})
