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
  const rules = [
    ['rule_builtin_user_agent', '统一客户端标识', '为上游请求设置稳定的客户端标识。', 'request', JSON.stringify({ clientProtocols: [], upstreamProtocols: [] }), JSON.stringify([{ type: 'header-set', name: 'User-Agent', value: 'One-Switch/0.3' }])],
    ['rule_builtin_reasoning_cleanup', '兼容 reasoning 参数', '删除不兼容供应商的 reasoning/thinking 请求字段。', 'request', JSON.stringify({ clientProtocols: ['openai-completions'] }), JSON.stringify([{ type: 'json-delete', path: '$.reasoning_effort' }, { type: 'json-delete', path: '$.thinking' }])],
    ['rule_builtin_responses_metadata', '补充请求元数据', '为 Responses 请求补充来源元数据。', 'request', JSON.stringify({ clientProtocols: ['openai-responses'] }), JSON.stringify([{ type: 'json-set', path: '$.metadata.source', value: 'one-switch' }])],
    ['rule_builtin_response_metadata_cleanup', '清理响应扩展字段', '移除响应中的供应商私有元数据。', 'response', JSON.stringify({ clientProtocols: ['anthropic-messages'] }), JSON.stringify([{ type: 'json-delete', path: '$.provider_metadata' }])],
  ]
  const insertRule = db.prepare(`INSERT OR IGNORE INTO modification_rules (id, name, description, enabled, stage, schemaVersion, source, match, actions, createdTime, updatedTime) VALUES (?, ?, ?, 1, ?, 1, 'builtin', ?, ?, ?, ?)`)
  for (const rule of rules) insertRule.run(rule[0], rule[1], rule[2], rule[3], rule[4], rule[5], time, time)
}
