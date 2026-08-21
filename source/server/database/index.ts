import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'

export type Database = ReturnType<typeof drizzle>

export const DATABASE_FILE_NAME = 'one-switch.db'

let database: Database | null = null
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

export async function initDatabase(dataDir: string): Promise<Database> {
  if (database) return database

  fs.mkdirSync(dataDir, { recursive: true })
  const client = new DatabaseSync(path.join(dataDir, DATABASE_FILE_NAME), {
    enableForeignKeyConstraints: true,
  })

  try {
    client.exec('PRAGMA journal_mode = WAL')
    rejectLegacyDatabase(client)
    const db = drizzle({ client })
    migrate(db, { migrationsFolder: getMigrationsFolder() })
    seedDefaultLogicalModel(client)
    database = db
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

function getMigrationsFolder(): string {
  const workspaceMigrationsFolder = path.join(process.cwd(), 'drizzle')
  if (fs.existsSync(workspaceMigrationsFolder)) return workspaceMigrationsFolder
  return path.join(moduleDirectory, '..', '..', 'drizzle')
}

function seedDefaultLogicalModel(db: DatabaseSync): void {
  const time = BigInt(Date.now())
  db.prepare(`INSERT OR IGNORE INTO logical_models
    (id, name, description, enabled, createdTime, updatedTime)
    VALUES ('default', 'default', 'Default fallback routing model', 1, ?, ?)`) 
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
