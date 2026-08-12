import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

let db: Database.Database | null = null

const SCHEMA_VERSION = 1

export function initDatabase(dataDir: string): Database.Database {
  if (db) return db

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = path.join(dataDir, 'one-switch.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  migrate(db)

  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function closeDatabase(): void {
  if (!db) return
  db.close()
  db = null
}

function migrate(db: Database.Database) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get()

  if (!row) {
    // 全新数据库，执行初始 schema
    db.exec(INITIAL_SCHEMA)
    db.prepare('INSERT INTO schema_version (version, appliedTime) VALUES (?, ?)').run(
      SCHEMA_VERSION,
      Date.now(),
    )
  } else {
    const currentVersion = db.prepare('SELECT version FROM schema_version').get() as {
      version: number
    }
    // 未来迁移逻辑放这里
    if (currentVersion.version < SCHEMA_VERSION) {
      // TODO: 增量迁移
    }
  }
}

const INITIAL_SCHEMA = `
-- schema_version
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  appliedTime INTEGER NOT NULL
);

-- providers
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  apiKeyReference TEXT NOT NULL,
  timeoutMilliseconds INTEGER NOT NULL DEFAULT 30000,
  enabled INTEGER NOT NULL DEFAULT 1,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);
CREATE INDEX idx_providers_deleted_time ON providers(deletedTime);

-- logical_models
CREATE TABLE logical_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);
CREATE INDEX idx_logical_models_name ON logical_models(name);
CREATE INDEX idx_logical_models_deleted_time ON logical_models(deletedTime);

-- model_bindings
CREATE TABLE model_bindings (
  id TEXT PRIMARY KEY,
  logicalModelId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  protocol TEXT NOT NULL,
  upstreamUrl TEXT NOT NULL,
  upstreamModelId TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  customAuthHeader TEXT,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER,
  FOREIGN KEY (logicalModelId) REFERENCES logical_models(id),
  FOREIGN KEY (providerId) REFERENCES providers(id)
);
CREATE INDEX idx_bindings_logical_model_priority ON model_bindings(logicalModelId, priority);
CREATE INDEX idx_bindings_provider ON model_bindings(providerId);
CREATE INDEX idx_bindings_protocol ON model_bindings(protocol);
CREATE INDEX idx_bindings_deleted_time ON model_bindings(deletedTime);

-- provider_health
CREATE TABLE provider_health (
  providerId TEXT PRIMARY KEY,
  consecutiveFailures INTEGER NOT NULL DEFAULT 0,
  cooldownUntilTime INTEGER,
  lastSuccessTime INTEGER,
  lastFailureTime INTEGER,
  updatedTime INTEGER NOT NULL,
  FOREIGN KEY (providerId) REFERENCES providers(id)
);

-- settings
CREATE TABLE settings (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  listenHost TEXT NOT NULL DEFAULT '127.0.0.1',
  listenPort INTEGER NOT NULL DEFAULT 9300,
  accessTokenReference TEXT,
  logRetentionCount INTEGER NOT NULL DEFAULT 1000,
  cooldownBaseSeconds INTEGER NOT NULL DEFAULT 30,
  cooldownMaxSeconds INTEGER NOT NULL DEFAULT 300,
  consecutiveFailureThreshold INTEGER NOT NULL DEFAULT 3,
  idleTimeoutMilliseconds INTEGER NOT NULL DEFAULT 30000,
  updatedTime INTEGER NOT NULL
);

-- request_logs
CREATE TABLE request_logs (
  id TEXT PRIMARY KEY,
  logicalModelId TEXT NOT NULL,
  protocol TEXT NOT NULL,
  status TEXT NOT NULL,
  totalDurationMilliseconds INTEGER NOT NULL,
  totalTokens INTEGER,
  createdTime INTEGER NOT NULL
);
CREATE INDEX idx_request_logs_created_time ON request_logs(createdTime);
CREATE INDEX idx_request_logs_status ON request_logs(status);

-- request_attempts
CREATE TABLE request_attempts (
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
  createdTime INTEGER NOT NULL,
  FOREIGN KEY (requestId) REFERENCES request_logs(id),
  FOREIGN KEY (providerId) REFERENCES providers(id),
  FOREIGN KEY (bindingId) REFERENCES model_bindings(id)
);
CREATE INDEX idx_attempts_request_id ON request_attempts(requestId);
CREATE INDEX idx_attempts_provider ON request_attempts(providerId);
CREATE INDEX idx_attempts_created_time ON request_attempts(createdTime);
`
