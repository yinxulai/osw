import type { LogEntry } from '@common/schemas'
import { getDb } from './index'

interface ListRuntimeLogsOptions {
  after?: number
  limit?: number
}

const DEFAULT_LIMIT = 500

function mapLogRow(row: { id: number | bigint; level: string; message: string; timestamp: number | bigint }): LogEntry {
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
      .all(after, limit) as Array<{ id: number | bigint; level: string; message: string; timestamp: number | bigint }>
    return rows.map(mapLogRow)
  }

  const rows = getDb().$client
    .prepare('SELECT id, level, message, timestamp FROM runtime_logs ORDER BY id DESC LIMIT ?')
    .all(limit) as Array<{ id: number | bigint; level: string; message: string; timestamp: number | bigint }>
  return rows.map(mapLogRow)
}

export function listAllRuntimeLogs(): LogEntry[] {
  const rows = getDb().$client
    .prepare('SELECT id, level, message, timestamp FROM runtime_logs ORDER BY id ASC')
    .all() as Array<{ id: number | bigint; level: string; message: string; timestamp: number | bigint }>
  return rows.map(mapLogRow)
}

export function clearRuntimeLogs(): void {
  getDb().$client.prepare('DELETE FROM runtime_logs').run()
}

export function pruneRuntimeLogsBefore(retentionDays: number): number {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) return 0
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const result = getDb().$client.prepare('DELETE FROM runtime_logs WHERE timestamp < ?').run(cutoff)
  return result.changes
}
