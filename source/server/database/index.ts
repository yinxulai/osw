import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'

export type Database = ReturnType<typeof drizzle>

let database: Database | null = null

export async function initDatabase(dataDir: string): Promise<Database> {
  if (database) return database

  fs.mkdirSync(dataDir, { recursive: true })
  const client = new DatabaseSync(path.join(dataDir, 'one-switch.db'), {
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
  migrateRequestAttemptsForeignKeys(db)
  for (const statement of INITIAL_SCHEMA) {
    db.exec(statement)
  }
}

/**
 * 迁移：旧的 request_attempts 表带了对 upstream_models(id) 的外键约束，
 * 但该列实际存储的是上游模型名（upstreamModelId 名称），并非主键 id，
 * 导致 FK 插入失败。这里检测到旧外键时重建表，去掉该外键。
 */
function migrateRequestAttemptsForeignKeys(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'request_attempts'`,
    )
    .all() as Array<{ sql: string | null }>
  const ddl = rows[0]?.sql ?? ''
  if (!ddl.includes('REFERENCES upstream_models')) return

  db.exec(`
    BEGIN;
    CREATE TABLE request_attempts_new (
      id TEXT PRIMARY KEY,
      requestId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      upstreamModelId TEXT NOT NULL,
      attemptIndex INTEGER NOT NULL,
      status TEXT NOT NULL,
      errorCode TEXT,
      errorMessage TEXT,
      durationMilliseconds INTEGER NOT NULL,
      createdTime BIGINT NOT NULL,
      FOREIGN KEY (requestId) REFERENCES request_logs(id),
      FOREIGN KEY (providerId) REFERENCES providers(id)
    );
    INSERT INTO request_attempts_new SELECT id, requestId, providerId, upstreamModelId, attemptIndex, status, errorCode, errorMessage, durationMilliseconds, createdTime FROM request_attempts;
    DROP TABLE request_attempts;
    ALTER TABLE request_attempts_new RENAME TO request_attempts;
    CREATE INDEX IF NOT EXISTS idx_attempts_request_id ON request_attempts(requestId);
    CREATE INDEX IF NOT EXISTS idx_attempts_provider ON request_attempts(providerId);
    CREATE INDEX IF NOT EXISTS idx_attempts_created_time ON request_attempts(createdTime);
    COMMIT;
  `)
}

const INITIAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    apiKeyReference TEXT NOT NULL,
    timeoutMilliseconds INTEGER NOT NULL DEFAULT 30000,
    enabled INTEGER NOT NULL DEFAULT 1,
    upstreamUrls TEXT NOT NULL DEFAULT '{}',
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
  `CREATE TABLE IF NOT EXISTS upstream_models (
    id TEXT PRIMARY KEY,
    logicalModelId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    upstreamModelId TEXT NOT NULL,
    endpoints TEXT NOT NULL DEFAULT '[]',
    priority INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    createdTime BIGINT NOT NULL,
    updatedTime BIGINT NOT NULL,
    deletedTime BIGINT,
    FOREIGN KEY (logicalModelId) REFERENCES logical_models(id),
    FOREIGN KEY (providerId) REFERENCES providers(id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_upstream_models_logical_priority ON upstream_models(logicalModelId, priority)',
  'CREATE INDEX IF NOT EXISTS idx_upstream_models_provider ON upstream_models(providerId)',
  'CREATE INDEX IF NOT EXISTS idx_upstream_models_deleted_time ON upstream_models(deletedTime)',
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
    upstreamModelId TEXT NOT NULL,
    attemptIndex INTEGER NOT NULL,
    status TEXT NOT NULL,
    errorCode TEXT,
    errorMessage TEXT,
    durationMilliseconds INTEGER NOT NULL,
    createdTime BIGINT NOT NULL,
    FOREIGN KEY (requestId) REFERENCES request_logs(id),
    FOREIGN KEY (providerId) REFERENCES providers(id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_attempts_request_id ON request_attempts(requestId)',
  'CREATE INDEX IF NOT EXISTS idx_attempts_provider ON request_attempts(providerId)',
  'CREATE INDEX IF NOT EXISTS idx_attempts_created_time ON request_attempts(createdTime)',
]
