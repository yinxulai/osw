import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { appendMainLog, installMainLogCapture, mainLogFilePath, noteQuitReason } from './main-log'

/**
 * 主进程落盘日志。
 *
 * 这里只验证一件事：**输出确实同步落到了文件**，而且带着级别与进程号。这正是闪退排查
 * 依赖的性质——服务进程不在时，磁盘上这一份是唯一的证据。
 */
describe('main process file log', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-main-log-'))

  beforeAll(() => {
    installMainLogCapture(directory)
  })

  function readLog(): string {
    const file = mainLogFilePath()
    if (file === null) throw new Error('main log was not installed')
    return fs.readFileSync(file, 'utf8')
  }

  it('writes console output and direct appends to the file with level and pid', () => {
    console.warn('a warning from a test')

    expect(mainLogFilePath()).toBe(path.join(directory, 'logs', 'main.log'))
    const content = readLog()
    expect(content).toContain('a warning from a test')
    expect(content).toMatch(new RegExp(`\\[pid ${process.pid}\\] \\[warn\\] a warning from a test`))
  })

  it('records quit requests so a later exit can be attributed', () => {
    noteQuitReason('unit-test-quit')
    expect(readLog()).toContain('[lifecycle] quit requested reason=unit-test-quit')
  })

  it('redacts sensitive keys before serializing objects', () => {
    appendMainLog('info', 'probe')
    const file = mainLogFilePath() as string
    const before = fs.statSync(file).size
    const marker = `redaction-${Date.now()}`
    console.log({ marker, apiKey: 'sk-should-not-appear', nested: { cookie: 'session=abc' } })

    const appended = fs.readFileSync(file, 'utf8').slice(before)
    expect(appended).toContain(marker)
    expect(appended).toContain('[redacted]')
    expect(appended).not.toContain('sk-should-not-appear')
    expect(appended).not.toContain('session=abc')
  })
})
