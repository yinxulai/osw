import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import { clearRuntimeLogs, createRuntimeLog, listAllRuntimeLogs, listRuntimeLogs, listRuntimeLogsPaged, pruneRuntimeLogsBefore } from './runtime-log-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-runtime-log-'))
  await initDatabases(temporaryDirectory)
  clearRuntimeLogs()
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('runtime log store', () => {
  it('creates and lists runtime logs with after/limit filters', () => {
    const first = createRuntimeLog('info', 'proxy', 'first message', 100)
    const second = createRuntimeLog('debug', 'proxy', 'second message', 200)
    const third = createRuntimeLog('warn', 'proxy', 'third message', 300)

    expect(listRuntimeLogs({ limit: 2 }).map(log => log.id)).toEqual([third.id, second.id])
    expect(listRuntimeLogs({ after: first.id, limit: 10 }).map(log => log.id)).toEqual([third.id, second.id])
  })

  it('persists the scope and filters paged lists by it', () => {
    createRuntimeLog('info', 'proxy', 'proxy message', 100)
    createRuntimeLog('info', 'management', 'management message', 200)
    createRuntimeLog('info', 'database', 'database message', 300)

    expect(listRuntimeLogsPaged(10, 0, { scope: 'management' }).logs.map(log => log.message)).toEqual(['management message'])
    expect(listRuntimeLogsPaged(10, 0, { scope: 'management' }).total).toBe(1)
    expect(listRuntimeLogsPaged(10, 0, {}).total).toBe(3)
  })

  it('clears and prunes runtime logs by retention days', () => {
    const now = Date.now()
    const oldTimestamp = now - 5 * 24 * 60 * 60 * 1000
    createRuntimeLog('info', 'proxy', 'old', oldTimestamp)
    const latest = createRuntimeLog('error', 'proxy', 'latest', now)

    expect(pruneRuntimeLogsBefore(3)).toBe(1)
    expect(listAllRuntimeLogs()).toEqual([expect.objectContaining({ id: latest.id, message: 'latest' })])

    clearRuntimeLogs()
    expect(listRuntimeLogs({ limit: 10 })).toEqual([])
  })
})
