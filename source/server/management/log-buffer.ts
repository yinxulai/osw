/**
 * 运行日志缓冲（内存版）
 * 仅保留本次进程运行期间由 console 输出的日志，用于实时查看与导出调试。
 * 不落盘、不跨进程持久化。
 */

import type { LogEntry } from '@common/schemas'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

const MAX_ENTRIES = 5000
const entries: LogEntry[] = []
let nextId = 1
let installed = false

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
  entries.push({
    id: nextId++,
    level,
    timestamp: Date.now(),
    message: formatArgs(args),
  })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
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
  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)
  const originalDebug = console.debug.bind(console)

  console.log = (...args: unknown[]) => {
    push('info', args)
    originalLog(...args)
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

export function listLogs(options?: { after?: number; limit?: number }): LogEntry[] {
  const after = options?.after ?? 0
  const limit = options?.limit ?? 500
  const filtered = after > 0 ? entries.filter(entry => entry.id > after) : entries
  return filtered.slice(-limit)
}

export function clearLogs(): void {
  entries.length = 0
}

export function exportLogs(): string {
  return entries
    .map(entry => `[${new Date(entry.timestamp).toISOString()}] [${entry.level.toUpperCase()}] ${entry.message}`)
    .join('\n')
}
