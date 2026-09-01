import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import { clearRuntimeLogs, createRuntimeLog, listAllRuntimeLogs, listRuntimeLogs, pruneRuntimeLogsBefore } from './runtime-log-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-runtime-log-'))
  await initDatabase(temporaryDirectory)
  clearRuntimeLogs()
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('runtime log store', () => {
  it('creates and lists runtime logs with after/limit filters', () => {
    const first = createRuntimeLog('info', 'first message', 100)
    const second = createRuntimeLog('debug', 'second message', 200)
    const third = createRuntimeLog('warn', 'third message', 300)

    expect(listRuntimeLogs({ limit: 2 }).map(log => log.id)).toEqual([third.id, second.id])
    expect(listRuntimeLogs({ after: first.id, limit: 10 }).map(log => log.id)).toEqual([third.id, second.id])
  })

  it('clears and prunes runtime logs by retention days', () => {
    const now = Date.now()
    const oldTimestamp = now - 5 * 24 * 60 * 60 * 1000
    createRuntimeLog('info', 'old', oldTimestamp)
    const latest = createRuntimeLog('error', 'latest', now)

    expect(pruneRuntimeLogsBefore(3)).toBe(1)
    expect(listAllRuntimeLogs()).toEqual([expect.objectContaining({ id: latest.id, message: 'latest' })])

    clearRuntimeLogs()
    expect(listRuntimeLogs({ limit: 10 })).toEqual([])
  })
})
