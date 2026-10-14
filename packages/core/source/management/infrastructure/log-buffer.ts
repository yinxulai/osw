/**
 * 运行日志缓冲
 * 默认将 console 日志写入数据库，支持跨进程查看；
 * 数据库不可用时回退到内存缓冲，保证日志采集不中断。
 */

import type { LogEntry } from '@common/schemas'
import type { RuntimeLogFilter } from '@server/database/runtime-log-store'
import { clearRuntimeLogs, createRuntimeLog, listAllRuntimeLogs, listRuntimeLogs, listRuntimeLogsPaged, pruneRuntimeLogsBefore } from '@server/database/runtime-log-store'
import { resolveLogScope } from './log-scope'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

const MAX_ENTRIES = 5000
const MAX_RETENTION_DAYS = 3
const PRUNE_INTERVAL_MS = 60_000
const entries: LogEntry[] = []
const pendingEntries: Array<Omit<LogEntry, 'id'>> = []
let nextId = 1
let installed = false
let lastPruneTime = 0

function formatArgs(args: unknown[]): string {
  return args
    .map(arg => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return arg.stack ?? arg.message
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

function push(level: LogLevel, args: unknown[]): void {
  writeRuntimeLog(level, formatArgs(args))
}

function shouldPrune(nowTime: number): boolean {
  return nowTime - lastPruneTime >= PRUNE_INTERVAL_MS
}

function persistRuntimeLog(entry: Omit<LogEntry, 'id'>): boolean {
  try {
    drainPendingEntries()
    createRuntimeLog(entry.level, entry.scope, entry.message, entry.timestamp)
    const currentTime = Date.now()
    if (shouldPrune(currentTime)) {
      pruneRuntimeLogsBefore(MAX_RETENTION_DAYS)
      lastPruneTime = currentTime
    }
    return true
  } catch {
    return false
  }
}

function drainPendingEntries(): void {
  while (pendingEntries.length > 0) {
    const first = pendingEntries[0]
    try {
      createRuntimeLog(first.level, first.scope, first.message, first.timestamp)
      pendingEntries.shift()
    } catch {
      return
    }
  }
}

/**
 * 直接写一条日志进缓冲与数据库，不经过 `console`。
 *
 * 给宿主（Electron 主进程）的 console 转发用：主进程碰不到数据库（`node:sqlite` 留在
 * 主进程就会卡住界面，见 issue #9），它的输出经 `logs.write` 这条 RPC 送进来，落库走的是
 * 和 `installLogCapture()` 完全一样的路径，所以两边的格式、上限、保留策略都不会漂。
 *
 * 时间戳由调用方给：主进程的日志发生在「服务还没起来」的时候，等它送过来已经过了一段，
 * 用 `Date.now()` 会把横幅的时间记得比实际晚。
 */
export function writeRuntimeLog(level: LogLevel, message: string, timestamp = Date.now()): void {
  const entry: Omit<LogEntry, 'id'> = { level, scope: resolveLogScope(message), timestamp, message }

  entries.push({ id: nextId++, ...entry })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }

  if (!persistRuntimeLog(entry)) {
    pendingEntries.push(entry)
    if (pendingEntries.length > MAX_ENTRIES) pendingEntries.splice(0, pendingEntries.length - MAX_ENTRIES)
  }
}

/**
 * 拦截 console 输出，将日志同时写入内存缓冲。
 * 幂等：重复调用不会重复拦截。
 */
export function installLogCapture(): void {
  if (installed) return
  installed = true

  const originalLog = console.log.bind(console)
  const originalInfo = console.info.bind(console)
  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)
  const originalDebug = console.debug.bind(console)

  console.log = (...args: unknown[]) => {
    push('info', args)
    originalLog(...args)
  }
  console.info = (...args: unknown[]) => {
    push('info', args)
    originalInfo(...args)
  }
  console.warn = (...args: unknown[]) => {
    push('warn', args)
    originalWarn(...args)
  }
  console.error = (...args: unknown[]) => {
    push('error', args)
    originalError(...args)
  }
  console.debug = (...args: unknown[]) => {
    push('debug', args)
    originalDebug(...args)
  }
}

interface ListLogsOptions {
  after?: number
  limit?: number
}

export function listLogs(options?: ListLogsOptions): LogEntry[] {
  try {
    drainPendingEntries()
    return listRuntimeLogs(options)
  } catch {
    const after = options?.after ?? 0
    const limit = options?.limit ?? 500
    const filtered = after > 0 ? entries.filter(entry => entry.id > after) : entries
    return filtered.slice(-limit).reverse()
  }
}

export interface PagedLogs {
  logs: LogEntry[]
  total: number
}

export function listLogsPaged(limit: number, offset: number, filter?: RuntimeLogFilter): PagedLogs {
  try {
    drainPendingEntries()
    return listRuntimeLogsPaged(limit, offset, filter)
  } catch {
    const sorted = [...entries].reverse()
    const filtered = sorted.filter(entry =>
      (filter?.level === undefined || entry.level === filter.level) &&
      (filter?.scope === undefined || entry.scope === filter.scope) &&
      (filter?.query === undefined || entry.message.toLowerCase().includes(filter.query.toLowerCase())))
    return { logs: filtered.slice(offset, offset + limit), total: filtered.length }
  }
}

export function clearLogs(): void {
  pendingEntries.length = 0
  entries.length = 0
  try {
    clearRuntimeLogs()
  } catch {
    // Database may not be initialized during isolated tests.
  }
}

export function exportLogs(): string {
  let source = entries
  try {
    drainPendingEntries()
    source = listAllRuntimeLogs()
  } catch {
    // Keep in-memory fallback for non-database contexts.
  }

  return source
    .map(entry => `[${new Date(entry.timestamp).toISOString()}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}`)
    .join('\n')
}
