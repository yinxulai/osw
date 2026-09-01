/**
 * 运行日志缓冲
 * 默认将 console 日志写入数据库，支持跨进程查看；
 * 数据库不可用时回退到内存缓冲，保证日志采集不中断。
 */

import type { LogEntry } from '@common/schemas'
import { clearRuntimeLogs, createRuntimeLog, listAllRuntimeLogs, listRuntimeLogs, pruneRuntimeLogsBefore } from '@server/database/runtime-log-store'

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
  const entry: Omit<LogEntry, 'id'> = {
    level,
    timestamp: Date.now(),
    message: formatArgs(args),
  }

  entries.push({
    id: nextId++,
    ...entry,
  })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }

  if (!persistRuntimeLog(entry)) {
    pendingEntries.push(entry)
    if (pendingEntries.length > MAX_ENTRIES) pendingEntries.splice(0, pendingEntries.length - MAX_ENTRIES)
  }
}

function shouldPrune(nowTime: number): boolean {
  return nowTime - lastPruneTime >= PRUNE_INTERVAL_MS
}

function persistRuntimeLog(entry: Omit<LogEntry, 'id'>): boolean {
  try {
    drainPendingEntries()
    createRuntimeLog(entry.level, entry.message, entry.timestamp)
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
      createRuntimeLog(first.level, first.message, first.timestamp)
      pendingEntries.shift()
    } catch {
      return
    }
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
    .map(entry => `[${new Date(entry.timestamp).toISOString()}] [${entry.level.toUpperCase()}] ${entry.message}`)
    .join('\n')
}
