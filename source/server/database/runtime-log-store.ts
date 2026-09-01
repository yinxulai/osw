import type { LogEntry } from '@common/schemas'
import { getDb } from './index'

interface ListRuntimeLogsOptions {
  after?: number
  limit?: number
}

const DEFAULT_LIMIT = 500

type RuntimeLogRow = {
  id: number | bigint
  level: string
  message: string
  timestamp: number | bigint
}

function mapLogRow(row: RuntimeLogRow): LogEntry {
  return {
    id: Number(row.id),
    level: row.level as LogEntry['level'],
    message: row.message,
    timestamp: Number(row.timestamp),
  }
}

export function createRuntimeLog(level: LogEntry['level'], message: string, timestamp = Date.now()): LogEntry {
  const result = getDb().$client
    .prepare('INSERT INTO runtime_logs (level, message, timestamp) VALUES (?, ?, ?)')
    .run(level, message, timestamp)

  return {
    id: Number(result.lastInsertRowid),
    level,
    message,
    timestamp,
  }
}

export function listRuntimeLogs(options?: ListRuntimeLogsOptions): LogEntry[] {
  const after = options?.after ?? 0
  const limit = options?.limit ?? DEFAULT_LIMIT

  if (after > 0) {
    const rows = getDb().$client
      .prepare('SELECT id, level, message, timestamp FROM runtime_logs WHERE id > ? ORDER BY id DESC LIMIT ?')
      .all(after, limit) as RuntimeLogRow[]
    return rows.map(mapLogRow)
  }

  const rows = getDb().$client
    .prepare('SELECT id, level, message, timestamp FROM runtime_logs ORDER BY id DESC LIMIT ?')
    .all(limit) as RuntimeLogRow[]
  return rows.map(mapLogRow)
}

export interface RuntimeLogFilter {
  level?: LogEntry['level']
  query?: string
}

export interface RuntimeLogPage {
  logs: LogEntry[]
  total: number
}

function buildRuntimeLogConditions(filter?: RuntimeLogFilter): {
  sql: string
  params: Array<string | number>
} {
  const conditions: string[] = []
  const params: Array<string | number> = []
  if (filter?.level) {
    conditions.push('level = ?')
    params.push(filter.level)
  }
  if (filter?.query) {
    conditions.push('message LIKE ?')
    params.push(`%${filter.query}%`)
  }
  return { sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

export function listRuntimeLogsPaged(limit: number, offset: number, filter?: RuntimeLogFilter): RuntimeLogPage {
  const { sql, params } = buildRuntimeLogConditions(filter)
  const rows = getDb().$client
    .prepare(`SELECT id, level, message, timestamp FROM runtime_logs ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as RuntimeLogRow[]
  const countRow = getDb().$client
    .prepare(`SELECT count(*) AS total FROM runtime_logs ${sql}`)
    .get(...params) as { total: number | bigint } | undefined
  return { logs: rows.map(mapLogRow), total: Number(countRow?.total ?? 0) }
}

export function listAllRuntimeLogs(): LogEntry[] {
  const rows = getDb().$client
    .prepare('SELECT id, level, message, timestamp FROM runtime_logs ORDER BY id ASC')
    .all() as RuntimeLogRow[]
  return rows.map(mapLogRow)
}

export function clearRuntimeLogs(): void {
  getDb().$client.prepare('DELETE FROM runtime_logs').run()
}

export function pruneRuntimeLogsBefore(retentionDays: number): number {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) return 0
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const result = getDb().$client.prepare('DELETE FROM runtime_logs WHERE timestamp < ?').run(cutoff)
  return Number(result.changes)
}
