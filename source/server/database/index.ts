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
  if (database) {
    console.debug('[database] initialization skipped reason=already-initialized')
    return database
  }

  const startedAt = Date.now()
  console.info(`[database] initialization started file=${DATABASE_FILE_NAME}`)
  fs.mkdirSync(dataDir, { recursive: true })
  const client = new DatabaseSync(path.join(dataDir, DATABASE_FILE_NAME), {
    enableForeignKeyConstraints: true,
  })

  try {
    client.exec('PRAGMA journal_mode = WAL')
    const db = drizzle({ client })
    migrate(db, { migrationsFolder: getMigrationsFolder() })
    ensureDefaultLogicalModel(client)
    database = db
    console.info(`[database] initialization completed duration=${Date.now() - startedAt}ms`)
    return database
  } catch (error) {
    client.close()
    database = null
    console.error(`[database] initialization failed duration=${Date.now() - startedAt}ms`, error)
    throw error
  }
}

export function getDb(): Database {
  if (!database) throw new Error('Database not initialized')
  return database
}

export async function closeDatabase(): Promise<void> {
  if (!database) {
    console.debug('[database] close skipped reason=not-initialized')
    return
  }
  const activeDatabase = database
  database = null
  try {
    activeDatabase.$client.close()
    console.info('[database] closed')
  } catch (error) {
    console.error('[database] close failed', error)
    throw error
  }
}

function getMigrationsFolder(): string {
  const workspaceMigrationsFolder = path.join(process.cwd(), 'drizzle')
  if (fs.existsSync(workspaceMigrationsFolder)) return workspaceMigrationsFolder
  return path.join(moduleDirectory, '..', '..', 'drizzle')
}

function ensureDefaultLogicalModel(db: DatabaseSync): void {
  const time = BigInt(Date.now())
  db.prepare(`INSERT OR IGNORE INTO logical_models
    (id, name, description, enabled, createdTime, updatedTime)
    VALUES ('default', 'default', 'Default fallback routing model', 1, ?, ?)`)
    .run(time, time)
}
