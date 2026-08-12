import fs from 'node:fs'
import path from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './client/client'

let database: PrismaClient | null = null

export async function initDatabase(dataDir: string): Promise<PrismaClient> {
  if (database) return database

  fs.mkdirSync(dataDir, { recursive: true })
  const adapter = new PrismaBetterSqlite3({ url: path.join(dataDir, 'one-switch.db') })
  database = new PrismaClient({ adapter })

  try {
    await database.$connect()
    await database.$queryRawUnsafe('PRAGMA journal_mode = WAL')
    await database.$queryRawUnsafe('PRAGMA foreign_keys = ON')
    await migrateLegacyIntegerTimestamps(database)
    await ensureSchema(database)
    await migrateLegacyProtocols(database)
    return database
  } catch (error) {
    await database.$disconnect()
    database = null
    throw error
  }
}

export function getDb(): PrismaClient {
  if (!database) throw new Error('Database not initialized')
  return database
}

export async function closeDatabase(): Promise<void> {
  if (!database) return
  const activeDatabase = database
  database = null
  await activeDatabase.$disconnect()
}

async function ensureSchema(client: PrismaClient): Promise<void> {
  for (const statement of INITIAL_SCHEMA) {
    await client.$executeRawUnsafe(statement)
  }
}

async function migrateLegacyProtocols(client: PrismaClient): Promise<void> {
  await client.$transaction([
    client.modelBinding.updateMany({
      where: { protocol: 'openai' },
      data: { protocol: 'openai-completions' },
    }),
    client.modelBinding.updateMany({
      where: { protocol: 'anthropic' },
      data: { protocol: 'anthropic-messages' },
    }),
    client.modelBinding.updateMany({
      where: { protocol: 'gemini' },
      data: { enabled: false },
    }),
    client.requestLog.updateMany({
      where: { protocol: 'openai' },
      data: { protocol: 'openai-completions' },
    }),
    client.requestLog.updateMany({
      where: { protocol: 'anthropic' },
      data: { protocol: 'anthropic-messages' },
    }),
  ])
}

interface TableColumnInfo {
  name: string
  type: string
}

async function migrateLegacyIntegerTimestamps(client: PrismaClient): Promise<void> {
  const columns = await client.$queryRawUnsafe<TableColumnInfo[]>("PRAGMA table_info('providers')")
  const createdTime = columns.find(column => column.name === 'createdTime')
  if (!createdTime || createdTime.type.toUpperCase() === 'BIGINT') return

  await client.$queryRawUnsafe('PRAGMA foreign_keys = OFF')
  try {
    await client.$executeRawUnsafe('BEGIN IMMEDIATE')
    for (const statement of LEGACY_TIMESTAMP_MIGRATION) {
      await client.$executeRawUnsafe(statement)
    }
    await client.$executeRawUnsafe('COMMIT')
  } catch (error) {
    await client.$executeRawUnsafe('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.$queryRawUnsafe('PRAGMA foreign_keys = ON')
  }
}

const INITIAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    apiKeyReference TEXT NOT NULL,
    timeoutMilliseconds INTEGER NOT NULL DEFAULT 30000,
    enabled INTEGER NOT NULL DEFAULT 1,
    createdTime BIGINT NOT NULL,
    updatedTime BIGINT NOT NULL,
    deletedTime BIGINT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_providers_deleted_time ON providers(deletedTime)',
  `CREATE TABLE IF NOT EXISTS logical_models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    createdTime BIGINT NOT NULL,
    updatedTime BIGINT NOT NULL,
    deletedTime BIGINT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_logical_models_name ON logical_models(name)',
  'CREATE INDEX IF NOT EXISTS idx_logical_models_deleted_time ON logical_models(deletedTime)',
  `CREATE TABLE IF NOT EXISTS model_bindings (
    id TEXT PRIMARY KEY,
    logicalModelId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    protocol TEXT NOT NULL,
    upstreamUrl TEXT NOT NULL,
    upstreamModelId TEXT NOT NULL,
    priority INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    customAuthHeader TEXT,
    createdTime BIGINT NOT NULL,
    updatedTime BIGINT NOT NULL,
    deletedTime BIGINT,
    FOREIGN KEY (logicalModelId) REFERENCES logical_models(id),
    FOREIGN KEY (providerId) REFERENCES providers(id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_bindings_logical_model_priority ON model_bindings(logicalModelId, priority)',
  'CREATE INDEX IF NOT EXISTS idx_bindings_provider ON model_bindings(providerId)',
  'CREATE INDEX IF NOT EXISTS idx_bindings_protocol ON model_bindings(protocol)',
  'CREATE INDEX IF NOT EXISTS idx_bindings_deleted_time ON model_bindings(deletedTime)',
  `CREATE TABLE IF NOT EXISTS provider_health (
    providerId TEXT PRIMARY KEY,
    consecutiveFailures INTEGER NOT NULL DEFAULT 0,
    cooldownUntilTime BIGINT,
    lastSuccessTime BIGINT,
    lastFailureTime BIGINT,
    updatedTime BIGINT NOT NULL,
    FOREIGN KEY (providerId) REFERENCES providers(id)
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY CHECK (id = 'singleton'),
    listenHost TEXT NOT NULL DEFAULT '127.0.0.1',
    listenPort INTEGER NOT NULL DEFAULT 9300,
    accessTokenReference TEXT,
    logRetentionCount INTEGER NOT NULL DEFAULT 1000,
    cooldownBaseSeconds INTEGER NOT NULL DEFAULT 30,
    cooldownMaxSeconds INTEGER NOT NULL DEFAULT 300,
    consecutiveFailureThreshold INTEGER NOT NULL DEFAULT 3,
    idleTimeoutMilliseconds INTEGER NOT NULL DEFAULT 30000,
    updatedTime BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS request_logs (
    id TEXT PRIMARY KEY,
    logicalModelId TEXT NOT NULL,
    protocol TEXT NOT NULL,
    status TEXT NOT NULL,
    totalDurationMilliseconds INTEGER NOT NULL,
    totalTokens INTEGER,
    createdTime BIGINT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_request_logs_created_time ON request_logs(createdTime)',
  'CREATE INDEX IF NOT EXISTS idx_request_logs_status ON request_logs(status)',
  `CREATE TABLE IF NOT EXISTS request_attempts (
    id TEXT PRIMARY KEY,
    requestId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    bindingId TEXT NOT NULL,
    upstreamModelId TEXT NOT NULL,
    attemptIndex INTEGER NOT NULL,
    status TEXT NOT NULL,
    errorCode TEXT,
    errorMessage TEXT,
    durationMilliseconds INTEGER NOT NULL,
    createdTime BIGINT NOT NULL,
    FOREIGN KEY (requestId) REFERENCES request_logs(id),
    FOREIGN KEY (providerId) REFERENCES providers(id),
    FOREIGN KEY (bindingId) REFERENCES model_bindings(id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_attempts_request_id ON request_attempts(requestId)',
  'CREATE INDEX IF NOT EXISTS idx_attempts_provider ON request_attempts(providerId)',
  'CREATE INDEX IF NOT EXISTS idx_attempts_created_time ON request_attempts(createdTime)',
]

const LEGACY_TIMESTAMP_MIGRATION = [
  'DROP INDEX IF EXISTS idx_attempts_created_time',
  'DROP INDEX IF EXISTS idx_attempts_provider',
  'DROP INDEX IF EXISTS idx_attempts_request_id',
  'DROP INDEX IF EXISTS idx_request_logs_status',
  'DROP INDEX IF EXISTS idx_request_logs_created_time',
  'DROP INDEX IF EXISTS idx_bindings_deleted_time',
  'DROP INDEX IF EXISTS idx_bindings_protocol',
  'DROP INDEX IF EXISTS idx_bindings_provider',
  'DROP INDEX IF EXISTS idx_bindings_logical_model_priority',
  'DROP INDEX IF EXISTS idx_logical_models_deleted_time',
  'DROP INDEX IF EXISTS idx_logical_models_name',
  'DROP INDEX IF EXISTS idx_providers_deleted_time',
  'ALTER TABLE request_attempts RENAME TO request_attempts_legacy',
  'ALTER TABLE request_logs RENAME TO request_logs_legacy',
  'ALTER TABLE provider_health RENAME TO provider_health_legacy',
  'ALTER TABLE model_bindings RENAME TO model_bindings_legacy',
  'ALTER TABLE logical_models RENAME TO logical_models_legacy',
  'ALTER TABLE providers RENAME TO providers_legacy',
  'ALTER TABLE settings RENAME TO settings_legacy',
  INITIAL_SCHEMA[0],
  INITIAL_SCHEMA[2],
  INITIAL_SCHEMA[5],
  INITIAL_SCHEMA[10],
  INITIAL_SCHEMA[11],
  INITIAL_SCHEMA[12],
  INITIAL_SCHEMA[15],
  `INSERT INTO providers SELECT id, name, apiKeyReference, timeoutMilliseconds, enabled,
    createdTime, updatedTime, deletedTime FROM providers_legacy`,
  `INSERT INTO logical_models SELECT id, name, description, enabled,
    createdTime, updatedTime, deletedTime FROM logical_models_legacy`,
  `INSERT INTO model_bindings SELECT id, logicalModelId, providerId, protocol, upstreamUrl,
    upstreamModelId, priority, enabled, customAuthHeader, createdTime, updatedTime, deletedTime
    FROM model_bindings_legacy`,
  `INSERT INTO provider_health SELECT providerId, consecutiveFailures, cooldownUntilTime,
    lastSuccessTime, lastFailureTime, updatedTime FROM provider_health_legacy`,
  `INSERT INTO settings SELECT id, listenHost, listenPort, accessTokenReference, logRetentionCount,
    cooldownBaseSeconds, cooldownMaxSeconds, consecutiveFailureThreshold, idleTimeoutMilliseconds,
    updatedTime FROM settings_legacy`,
  `INSERT INTO request_logs SELECT id, logicalModelId, protocol, status,
    totalDurationMilliseconds, totalTokens, createdTime FROM request_logs_legacy`,
  `INSERT INTO request_attempts SELECT id, requestId, providerId, bindingId, upstreamModelId,
    attemptIndex, status, errorCode, errorMessage, durationMilliseconds, createdTime
    FROM request_attempts_legacy`,
  'DROP TABLE request_attempts_legacy',
  'DROP TABLE request_logs_legacy',
  'DROP TABLE provider_health_legacy',
  'DROP TABLE model_bindings_legacy',
  'DROP TABLE logical_models_legacy',
  'DROP TABLE providers_legacy',
  'DROP TABLE settings_legacy',
]
