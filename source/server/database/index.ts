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
  migrateLegacySettings(db)
  migrateLegacyProviders(db)
  for (const statement of INITIAL_SCHEMA) {
    db.exec(statement)
  }
  ensureColumn(db, 'request_logs', 'rawUsage', 'TEXT')
  ensureColumn(db, 'request_logs', 'cachedInputTokens', 'INTEGER')
  ensureColumn(db, 'request_logs', 'cacheCreationInputTokens', 'INTEGER')
  ensureColumn(db, 'request_logs', 'promptCacheHit', 'INTEGER')
  ensureColumn(db, 'request_logs', 'upstreamProtocol', 'TEXT')
  ensureColumn(db, 'request_attempts', 'upstreamRequestId', 'TEXT')
  ensureColumn(db, 'request_attempts', 'errorResponse', 'TEXT')
  dropColumn(db, 'upstream_models', 'logicalModelId')
  ensureColumn(db, 'upstream_models', 'endpoints', "TEXT NOT NULL DEFAULT '[]'")
  ensureDefaultLogicalModel(db)
}

/** 全新安装时保证至少存在一个默认逻辑模型，避免空表导致前端无法保存上游模型 */
function ensureDefaultLogicalModel(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO logical_models (id, name, description, enabled, createdTime, updatedTime)
     SELECT 'default', '默认模型', '系统自动创建的默认逻辑模型', 1, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM logical_models)`,
  ).run(BigInt(Date.now()), BigInt(Date.now()))
}

/** 旧宽表 settings 迁移到 key-value 结构；仅当检测到旧表时执行一次 */
function migrateLegacySettings(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(settings)').all() as Array<{ name: string }>
  if (!columns.length || !columns.some(column => column.name === 'listenHost')) return
  const legacy = db
    .prepare(
      `SELECT listenHost, listenPort, accessTokenReference, logRetentionCount,
              cooldownBaseSeconds, cooldownMaxSeconds, consecutiveFailureThreshold,
              idleTimeoutMilliseconds, autoLaunch, updatedTime
       FROM settings WHERE id = 'singleton'`,
    )
    .get() as Record<string, unknown> | undefined
  db.exec('DROP TABLE settings')
  db.exec(
    `CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  )
  if (!legacy) return
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(legacy)) {
    insert.run(key, JSON.stringify(value))
  }
}

/** 旧宽表 providers 迁移到 id+data 结构；仅当检测到旧表时执行一次 */
function migrateLegacyProviders(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(providers)').all() as Array<{ name: string }>
  if (!columns.length || !columns.some(column => column.name === 'name')) return
  const legacy = db
    .prepare(
      `SELECT id, name, apiKeyReference, timeoutMilliseconds, enabled, upstreamUrls,
              createdTime, updatedTime, deletedTime
       FROM providers`,
    )
    .all() as Array<Record<string, unknown>>
  db.exec('DROP TABLE providers')
  db.exec(
    `CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      createdTime BIGINT NOT NULL,
      updatedTime BIGINT NOT NULL,
      deletedTime BIGINT
    )`,
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_providers_deleted_time ON providers(deletedTime)',
  )
  const insert = db.prepare(
    'INSERT INTO providers (id, data, createdTime, updatedTime, deletedTime) VALUES (?, ?, ?, ?, ?)',
  )
  for (const row of legacy) {
    const { id, createdTime, updatedTime, deletedTime, ...rest } = row
    insert.run(
      id as string,
      JSON.stringify({
        ...rest,
        enabled: Boolean(rest.enabled),
      }),
      createdTime as number,
      updatedTime as number,
      (deletedTime ?? null) as number | null,
    )
  }
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(candidate => candidate.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

/** 删除旧列；旧 SQLite 不支持 DROP COLUMN 时保留列但不读写，不影响行为 */
function dropColumn(db: DatabaseSync, table: string, column: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(candidate => candidate.name === column)) return
  try {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
  } catch {
    // 忽略：列保留但不读写
  }
}

const INITIAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
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
    providerId TEXT NOT NULL,
    upstreamModelId TEXT NOT NULL,
    endpoints TEXT NOT NULL DEFAULT '[]',
    priority INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    createdTime BIGINT NOT NULL,
    updatedTime BIGINT NOT NULL,
    deletedTime BIGINT,
    FOREIGN KEY (providerId) REFERENCES providers(id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_upstream_models_priority ON upstream_models(priority)',
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
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS request_logs (
    id TEXT PRIMARY KEY,
    logicalModelId TEXT NOT NULL,
    protocol TEXT NOT NULL,
    status TEXT NOT NULL,
    totalDurationMilliseconds INTEGER NOT NULL,
    totalTokens INTEGER,
    inputTokens INTEGER,
    outputTokens INTEGER,
    cachedInputTokens INTEGER,
    cacheCreationInputTokens INTEGER,
    promptCacheHit INTEGER,
    rawUsage TEXT,
    ttftMilliseconds INTEGER,
    cacheHit INTEGER,
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
    upstreamRequestId TEXT,
    errorResponse TEXT,
    errorCode TEXT,
    errorMessage TEXT,
    durationMilliseconds INTEGER NOT NULL,
    createdTime BIGINT NOT NULL,
    FOREIGN KEY (requestId) REFERENCES request_logs(id),
    FOREIGN KEY (providerId) REFERENCES providers(id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_attempts_request_id ON request_attempts(requestId)',
  'CREATE INDEX IF NOT EXISTS idx_attempts_request_order ON request_attempts(requestId, attemptIndex)',
  'CREATE INDEX IF NOT EXISTS idx_attempts_provider ON request_attempts(providerId)',
  'CREATE INDEX IF NOT EXISTS idx_attempts_created_time ON request_attempts(createdTime)',
]
