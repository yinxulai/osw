import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  closeDatabase()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-db-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('database lifecycle', () => {
  it('clears the database reference on close and supports reinitialization', () => {
    const first = initDatabase(createTemporaryDirectory())
    expect(first.open).toBe(true)

    closeDatabase()

    expect(first.open).toBe(false)
    expect(() => getDb()).toThrow('Database not initialized')

    const second = initDatabase(createTemporaryDirectory())
    expect(second.open).toBe(true)
    expect(second).not.toBe(first)
  })

  it('can be closed repeatedly', () => {
    initDatabase(createTemporaryDirectory())

    closeDatabase()

    expect(() => closeDatabase()).not.toThrow()
  })
})
