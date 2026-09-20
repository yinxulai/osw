import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TELEMETRY_ID_FILE_NAME, loadOrCreateTelemetryId, readTelemetryId, telemetryIdPath } from './install-id'

// 全程用临时目录：这个模块写的是磁盘上的真实文件，绝不能碰开发机上的数据目录。

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-telemetry-id-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function writeIdFile(content: string): void {
  fs.writeFileSync(telemetryIdPath(dataDir), content)
}

describe('readTelemetryId', () => {
  it('returns null when the file does not exist', async () => {
    expect(await readTelemetryId(dataDir)).toBeNull()
  })

  it('accepts a hand-written uuid and normalizes it to lower case', async () => {
    writeIdFile('0A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D\n')

    expect(await readTelemetryId(dataDir)).toBe('0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d')
  })

  it('treats unparseable content as missing', async () => {
    // 手工改坏的文件不该让上层拿到一个「看起来是标识」的东西。
    writeIdFile('not-a-uuid\n')

    expect(await readTelemetryId(dataDir)).toBeNull()
  })

  it('treats a directory in place of the file as missing instead of throwing', async () => {
    fs.mkdirSync(telemetryIdPath(dataDir))

    expect(await readTelemetryId(dataDir)).toBeNull()
  })
})

describe('loadOrCreateTelemetryId', () => {
  it('creates a uuid and persists it with a trailing newline', async () => {
    const created = await loadOrCreateTelemetryId(dataDir)

    expect(created).toMatch(UUID_PATTERN)
    expect(fs.readFileSync(telemetryIdPath(dataDir), 'utf8')).toBe(`${created}\n`)
  })

  it('returns the same id on every later call', async () => {
    // 「同一台机器 = 同一个安装」是这个标识唯一的用处，变了就等于每次启动都是新安装。
    const first = await loadOrCreateTelemetryId(dataDir)
    const second = await loadOrCreateTelemetryId(dataDir)

    expect(second).toBe(first)
  })

  it('creates missing directories on the way', async () => {
    const nested = path.join(dataDir, 'deep', 'deeper')

    expect(await loadOrCreateTelemetryId(nested)).toMatch(UUID_PATTERN)
  })

  it('refuses to mint a new identity while a corrupt file is in the way', async () => {
    // 「文件在、但读不出版本」时**不覆盖**它：重算标识等于悄悄换了个身份，而统计口径上
    // 「这台机器不再出现」比「这台机器变成了另一台」诚实得多（telemetry.md §4）。
    writeIdFile('garbage\n')

    expect(await loadOrCreateTelemetryId(dataDir)).toBeNull()
    expect(fs.readFileSync(telemetryIdPath(dataDir), 'utf8')).toBe('garbage\n')
  })

  it('reports failure as null when the id cannot be persisted', async () => {
    // 目录占了文件的位置：读是 EISDIR，写 `wx` 是 EEXIST，两条路都走不通。
    // 这里**必须**是 null 而不是「内存里的临时标识」——那会把活跃安装数变成启动次数。
    fs.mkdirSync(telemetryIdPath(dataDir))

    expect(await loadOrCreateTelemetryId(dataDir)).toBeNull()
  })

  it('keeps the file name outside the configuration database', () => {
    // 它是数据目录里的独立文件，不该跟着用户配置被导出或备份（telemetry.md §4）。
    expect(TELEMETRY_ID_FILE_NAME).toBe('telemetry-id')
    expect(path.basename(telemetryIdPath('C:/some/data/dir'))).toBe(TELEMETRY_ID_FILE_NAME)
  })
})
