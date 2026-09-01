import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from './index'
import { listProviderModelsForLogicalModel } from './model-store'

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

  it('seeds the default logical model on a fresh database', async () => {
    const client = (await initDatabase(createTemporaryDirectory())).$client

    const rows = client.prepare('SELECT id, name, enabled FROM logical_models').all()
    expect(rows).toEqual([{ id: 'default', name: 'default', enabled: 1 }])
  })

  it('restores default when a database has no logical model', async () => {
    const directory = createTemporaryDirectory()
    const client = (await initDatabase(directory)).$client
    const time = Date.now()

    client.prepare('DELETE FROM logical_models').run()
    client
      .prepare('INSERT INTO logical_models (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)')
      .run('custom', 'Custom', time, time)

    await closeDatabase()
    const reopened = (await initDatabase(directory)).$client

    const rows = reopened.prepare('SELECT id FROM logical_models ORDER BY id').all()
    expect(rows).toEqual([{ id: 'custom' }, { id: 'default' }])
  })

  it('creates the v0.3 relational baseline with an idempotent default model', async () => {
    const directory = createTemporaryDirectory()
    const client = (await initDatabase(directory)).$client
    const expectedTables = [
      'settings', 'providers', 'provider_health', 'provider_model_health',
      'provider_models', 'provider_settings', 'provider_endpoints',
      'provider_model_endpoints', 'protocol_converters', 'logical_models', 'request_rewrite_rules', 'provider_model_request_rewrite_rules',
      'scheduling_policies', 'request_logs', 'request_metrics', 'request_attributes', 'request_usages',
      'request_attempts', 'request_contents', 'request_conversions', 'runtime_logs',
    ]
    const tables = client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(row => (row as { name: string }).name)

    expect(tables).toEqual(['__drizzle_migrations', ...expectedTables].sort())
    expect(client.prepare('SELECT id, name FROM logical_models').all()).toEqual([
      { id: 'default', name: 'default' },
    ])

    await closeDatabase()
    const reopened = (await initDatabase(directory)).$client
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM logical_models').get()).toEqual({ count: 1 })
  })

  it('enforces v0.3 binding uniqueness and health foreign keys', async () => {
    const client = (await initDatabase(createTemporaryDirectory())).$client
    const time = Date.now()
    client.prepare('INSERT INTO providers (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)').run('prov_test', 'Test', time, time)
    client.prepare('INSERT INTO provider_models (id, providerId, modelName, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?)').run('pm_test', 'prov_test', 'model-a', time, time)
    client.prepare('INSERT INTO scheduling_policies (logicalModelId, providerModelId, priority, weight, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?)').run('default', 'pm_test', 0, 100, time, time)

    expect(() => client.prepare('INSERT INTO scheduling_policies (logicalModelId, providerModelId, createdTime, updatedTime) VALUES (?, ?, ?, ?)').run('default', 'pm_test', time, time)).toThrow()
    expect(() => client.prepare('INSERT INTO provider_health (providerId, updatedTime) VALUES (?, ?)').run('missing', time)).toThrow()
  })

  it('keeps disabled models in management queue while excluding them from scheduling', async () => {
    const client = (await initDatabase(createTemporaryDirectory())).$client
    const time = Date.now()
    client.prepare('INSERT INTO providers (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)').run('prov_test', 'Test', time, time)
    client.prepare('INSERT INTO provider_models (id, providerId, modelName, enabled, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?)').run('pm_disabled', 'prov_test', 'model-disabled', 0, time, time)
    client.prepare('INSERT INTO scheduling_policies (logicalModelId, providerModelId, priority, weight, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?)').run('default', 'pm_disabled', 0, 100, time, time)

    await expect(listProviderModelsForLogicalModel('default')).resolves.toEqual([])
    await expect(listProviderModelsForLogicalModel('default', false, true)).resolves.toMatchObject([
      { id: 'pm_disabled', enabled: false, priority: 0 },
    ])
  })

  it('creates the expected v0.3 indexes and request columns', async () => {
    const client = (await initDatabase(createTemporaryDirectory())).$client
    const requestLogColumns = client.prepare('PRAGMA table_info(request_logs)').all()
    const settingsColumns = client.prepare('PRAGMA table_info(settings)').all()
    const attemptColumns = client.prepare('PRAGMA table_info(request_attempts)').all()
    const indexes = client.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()

    expect(requestLogColumns.map(column => (column as { name: string }).name)).toEqual([
      'id', 'status', 'logicalModelId', 'clientProtocol', 'upstreamProtocol', 'metadata', 'createdTime',
    ])
    expect(settingsColumns.map(column => (column as { name: string }).name)).toEqual([
      'key', 'value', 'valueType', 'updatedTime',
    ])
    expect(attemptColumns.map(column => (column as { name: string }).name)).toEqual(
      expect.arrayContaining(['providerModelId', 'providerName', 'providerModelName', 'url', 'httpStatus', 'retryable']),
    )
    expect(indexes.map(index => (index as { name: string }).name)).toEqual(
      expect.arrayContaining(['idx_scheduling_policies_route', 'idx_request_attempts_request_order', 'idx_request_attributes_key_value', 'idx_runtime_logs_timestamp']),
    )
  })
})
