import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'

export type Database = ReturnType<typeof drizzle>

export const DATABASE_FILE_NAME = 'one-switch.db'

let database: Database | null = null

export async function initDatabase(dataDir: string): Promise<Database> {
  if (database) return database

  fs.mkdirSync(dataDir, { recursive: true })
  const client = new DatabaseSync(path.join(dataDir, DATABASE_FILE_NAME), {
    enableForeignKeyConstraints: true,
  })

  try {
    client.exec('PRAGMA journal_mode = WAL')
    ensureSchema(client)
    database = drizzle({ client })
    return database
  } catch (error) {
    client.close()
    database = null
    throw error
  }
}

export function getDb(): Database {
  if (!database) throw new Error('Database not initialized')
  return database
}

export async function closeDatabase(): Promise<void> {
  if (!database) return
  const activeDatabase = database
  database = null
  activeDatabase.$client.close()
}

function ensureSchema(db: DatabaseSync): void {
  rejectLegacyDatabase(db)
  for (const statement of INITIAL_SCHEMA) db.exec(statement)
  const time = BigInt(Date.now())
  db.prepare(`INSERT OR IGNORE INTO logical_models
    (id, name, description, enabled, createdTime, updatedTime)
    VALUES ('auto', 'auto', 'MVP automatic routing model', 1, ?, ?)`)
    .run(time, time)
}

function rejectLegacyDatabase(db: DatabaseSync): void {
  const legacyTables = ['upstream_models', 'model_bindings']
  const found = legacyTables.filter(table =>
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  )
  if (found.length > 0) {
    throw new Error(`Incompatible database schema: legacy tables detected (${found.join(', ')}). Reinitialize the database for v0.3.`)
  }
}

const INITIAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, valueType TEXT NOT NULL DEFAULT 'string', updatedTime INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), createdTime INTEGER NOT NULL, updatedTime INTEGER NOT NULL, deletedTime INTEGER)`,
  `CREATE TABLE IF NOT EXISTS provider_health (providerId TEXT PRIMARY KEY REFERENCES providers(id), consecutiveFailures INTEGER NOT NULL DEFAULT 0, cooldownUntilTime INTEGER, lastSuccessTime INTEGER, lastFailureTime INTEGER, updatedTime INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS provider_settings (providerId TEXT NOT NULL REFERENCES providers(id), key TEXT NOT NULL, value TEXT NOT NULL, valueType TEXT NOT NULL DEFAULT 'string', updatedTime INTEGER NOT NULL, PRIMARY KEY (providerId, key))`,
  `CREATE TABLE IF NOT EXISTS provider_endpoints (id TEXT PRIMARY KEY, providerId TEXT NOT NULL REFERENCES providers(id), protocol TEXT NOT NULL, url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), createdTime INTEGER NOT NULL, updatedTime INTEGER NOT NULL, UNIQUE(providerId, protocol))`,
  `CREATE TABLE IF NOT EXISTS provider_models (id TEXT PRIMARY KEY, providerId TEXT NOT NULL REFERENCES providers(id), modelName TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), createdTime INTEGER NOT NULL, updatedTime INTEGER NOT NULL, deletedTime INTEGER)`,
  `CREATE TABLE IF NOT EXISTS provider_model_health (providerModelId TEXT PRIMARY KEY REFERENCES provider_models(id), consecutiveFailures INTEGER NOT NULL DEFAULT 0, cooldownUntilTime INTEGER, lastSuccessTime INTEGER, lastFailureTime INTEGER, updatedTime INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS provider_model_endpoints (id TEXT PRIMARY KEY, providerModelId TEXT NOT NULL REFERENCES provider_models(id), providerEndpointId TEXT NOT NULL REFERENCES provider_endpoints(id), url TEXT, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), createdTime INTEGER NOT NULL, updatedTime INTEGER NOT NULL, UNIQUE(providerModelId, providerEndpointId))`,
  `CREATE TABLE IF NOT EXISTS protocol_converters (id TEXT PRIMARY KEY, providerModelEndpointId TEXT NOT NULL REFERENCES provider_model_endpoints(id), clientProtocol TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)), createdTime INTEGER NOT NULL, updatedTime INTEGER NOT NULL, UNIQUE(providerModelEndpointId, clientProtocol))`,
  `CREATE TABLE IF NOT EXISTS logical_models (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), createdTime INTEGER NOT NULL, updatedTime INTEGER NOT NULL, deletedTime INTEGER)`,
  `CREATE TABLE IF NOT EXISTS scheduling_policies (logicalModelId TEXT NOT NULL REFERENCES logical_models(id), providerModelId TEXT NOT NULL REFERENCES provider_models(id), strategy TEXT NOT NULL DEFAULT 'priority' CHECK (strategy = 'priority'), priority INTEGER NOT NULL DEFAULT 0, weight INTEGER NOT NULL DEFAULT 100 CHECK (weight > 0), enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), failoverEnabled INTEGER NOT NULL DEFAULT 1 CHECK (failoverEnabled IN (0,1)), createdTime INTEGER NOT NULL, updatedTime INTEGER NOT NULL, PRIMARY KEY (logicalModelId, providerModelId))`,
  `CREATE TABLE IF NOT EXISTS request_logs (id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('pending','success','failed','cancelled')), protocol TEXT NOT NULL, logicalModelId TEXT NOT NULL, metadata TEXT, createdTime INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS request_metrics (requestId TEXT NOT NULL REFERENCES request_logs(id), key TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'count', updatedTime INTEGER NOT NULL, PRIMARY KEY (requestId, key))`,
  `CREATE TABLE IF NOT EXISTS request_usages (id TEXT PRIMARY KEY, requestId TEXT NOT NULL REFERENCES request_logs(id), attemptId TEXT, type TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'count', createdTime INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS request_attempts (id TEXT PRIMARY KEY, requestId TEXT NOT NULL REFERENCES request_logs(id), providerId TEXT NOT NULL, providerModelId TEXT NOT NULL, providerName TEXT NOT NULL, providerModelName TEXT NOT NULL, providerProtocol TEXT, providerRequestId TEXT, url TEXT NOT NULL, status TEXT NOT NULL, httpStatus INTEGER, retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0,1)), attemptIndex INTEGER NOT NULL, durationMilliseconds INTEGER NOT NULL, errorCode TEXT, errorMessage TEXT, details TEXT, createdTime INTEGER NOT NULL, UNIQUE(requestId, attemptIndex))`,
  `CREATE TABLE IF NOT EXISTS request_contents (id TEXT PRIMARY KEY, requestId TEXT NOT NULL REFERENCES request_logs(id), attemptId TEXT, captureStatus TEXT NOT NULL CHECK (captureStatus IN ('captured','partial','disabled','failed')), requestMethod TEXT NOT NULL, requestPath TEXT NOT NULL, requestHeaders TEXT, requestBody TEXT, responseStatus INTEGER, responseHeaders TEXT, responseBody TEXT, conversions TEXT, createdTime INTEGER NOT NULL, updatedTime INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_settings_updated_time ON settings(updatedTime)',
  'CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled)',
  'CREATE INDEX IF NOT EXISTS idx_providers_deleted_time ON providers(deletedTime)',
  'CREATE INDEX IF NOT EXISTS idx_provider_settings_key ON provider_settings(key)',
  'CREATE INDEX IF NOT EXISTS idx_provider_endpoints_protocol ON provider_endpoints(protocol, enabled)',
  'CREATE INDEX IF NOT EXISTS idx_provider_models_enabled ON provider_models(providerId, enabled, deletedTime)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_models_provider_model_active ON provider_models(providerId, modelName) WHERE deletedTime IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_provider_model_endpoints_provider_endpoint ON provider_model_endpoints(providerEndpointId, enabled)',
  'CREATE INDEX IF NOT EXISTS idx_protocol_converters_protocol ON protocol_converters(clientProtocol, enabled)',
  'CREATE INDEX IF NOT EXISTS idx_logical_models_enabled ON logical_models(enabled)',
  'CREATE INDEX IF NOT EXISTS idx_logical_models_deleted_time ON logical_models(deletedTime)',
  'CREATE INDEX IF NOT EXISTS idx_scheduling_policies_route ON scheduling_policies(logicalModelId, enabled, priority, weight)',
  'CREATE INDEX IF NOT EXISTS idx_request_logs_created_time ON request_logs(createdTime)',
  'CREATE INDEX IF NOT EXISTS idx_request_logs_status ON request_logs(status)',
  'CREATE INDEX IF NOT EXISTS idx_request_logs_logical_model ON request_logs(logicalModelId)',
  'CREATE INDEX IF NOT EXISTS idx_request_metrics_key ON request_metrics(key)',
  'CREATE INDEX IF NOT EXISTS idx_request_usages_type_time ON request_usages(type, createdTime)',
  'CREATE INDEX IF NOT EXISTS idx_request_usages_request ON request_usages(requestId)',
  'CREATE INDEX IF NOT EXISTS idx_request_usages_attempt ON request_usages(attemptId)',
  'CREATE INDEX IF NOT EXISTS idx_request_attempts_provider_time ON request_attempts(providerId, createdTime)',
  'CREATE INDEX IF NOT EXISTS idx_request_attempts_model_time ON request_attempts(providerModelId, createdTime)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_request_contents_request_level ON request_contents(requestId) WHERE attemptId IS NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_request_contents_attempt ON request_contents(attemptId) WHERE attemptId IS NOT NULL',
]
