import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import {
  countClientConfigVersions,
  getClientConfigVersion,
  hashClientConfigContent,
  listClientConfigVersions,
  saveClientConfigVersion,
  summarizeClientConfigVersions,
} from './client-config-version-store'

/**
 * 历史版本存储。
 *
 * 核心只有一条规则，也是用户明确要的那条：**同一份内容只存一次**。所以这里的重点是幂等与
 * 去重边界（空内容不算版本；换个文件互不干扰），而不是 SQL 本身。
 */

const CLIENT = 'claude-code'
const FILE = '~/.claude/settings.json'
const OTHER_FILE = '~/.claude/.credentials.json'

let temporaryDirectory: string

// `createdTime` 是毫秒时间戳，而同毫秒内的插入只能靠随机 id 决胜负；排序断言前先让它错开。
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 3))
}

function save(content: string, filePath = FILE, origin: 'apply' | 'manual' | 'restore' = 'apply', note?: string) {
  return saveClientConfigVersion({ clientKey: CLIENT, filePath, content, origin, note })
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-client-config-version-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('saveClientConfigVersion', () => {
  it('does not treat an empty or missing file as a version', async () => {
    expect(save('')).toBeNull()
    expect(countClientConfigVersions(CLIENT, FILE)).toBe(0)
  })

  it('stores the content, its hash and its size', () => {
    const content = '{\n  "model": "opus"\n}\n'
    const saved = save(content)!

    expect(saved.contentHash).toBe(hashClientConfigContent(content))
    expect(saved.sizeBytes).toBe(Buffer.byteLength(content, 'utf8'))
    expect(saved.clientKey).toBe(CLIENT)
    expect(saved.filePath).toBe(FILE)
    expect(saved.origin).toBe('apply')
    expect(saved.note).toBe('')
    expect(saved.createdTime).toBeGreaterThan(0)
  })

  it('keeps one version per distinct content', async () => {
    const first = save('{"a":1}')!
    await tick()
    const duplicate = save('{"a":1}')

    // 用户反复点同一个提交，历史里不该长出第二条一模一样的记录。
    expect(duplicate).toBeNull()
    expect(countClientConfigVersions(CLIENT, FILE)).toBe(1)

    await tick()
    const second = save('{"a":2}')!
    expect(second.id).not.toBe(first.id)
    expect(countClientConfigVersions(CLIENT, FILE)).toBe(2)
  })

  it('scopes versions to the file they came from', async () => {
    save('{"a":1}')
    await tick()
    save('{"b":2}', OTHER_FILE)

    expect(listClientConfigVersions(CLIENT, FILE)).toHaveLength(1)
    expect(listClientConfigVersions(CLIENT, OTHER_FILE)).toHaveLength(1)
    expect(listClientConfigVersions(CLIENT, OTHER_FILE)[0]!.filePath).toBe(OTHER_FILE)
  })

  it('records where the version came from', () => {
    const saved = save('{"a":1}', FILE, 'manual', '手改的')!

    expect(saved.origin).toBe('manual')
    expect(saved.note).toBe('手改的')
  })

  it('truncates the preview but keeps the full content retrievable', () => {
    const content = 'x'.repeat(500)
    const saved = save(content)!

    expect(saved.preview).toHaveLength(240)
    expect(getClientConfigVersion(saved.id)!.content).toBe(content)
  })
})

describe('listing versions', () => {
  it('returns the newest first', async () => {
    save('{"a":1}')
    await tick()
    save('{"a":2}')
    await tick()
    save('{"a":3}')

    const versions = listClientConfigVersions(CLIENT, FILE)

    expect(versions.map(version => version.preview)).toEqual(['{"a":3}', '{"a":2}', '{"a":1}'])
  })

  it('honours the limit', async () => {
    for (const content of ['{"a":1}', '{"a":2}', '{"a":3}']) {
      save(content)
      await tick()
    }

    expect(listClientConfigVersions(CLIENT, FILE, 2)).toHaveLength(2)
  })

  it('returns nothing for a file that has no history', () => {
    expect(listClientConfigVersions(CLIENT, FILE)).toEqual([])
    expect(countClientConfigVersions(CLIENT, FILE)).toBe(0)
  })
})

describe('getClientConfigVersion', () => {
  it('returns null for an unknown id', () => {
    expect(getClientConfigVersion('ccv_nope')).toBeNull()
  })
})

describe('summarizeClientConfigVersions', () => {
  it('reports an empty summary for a client with no history', () => {
    // 列表页的空值靠这两个字段推出来（`—` 占位），所以零历史必须是 0/null 而不是 undefined。
    expect(summarizeClientConfigVersions(CLIENT)).toEqual({ count: 0, lastTime: null })
  })

  it('counts every file of a client and keeps the newest time', async () => {
    save('{"a":1}')
    save('{"a":2}', OTHER_FILE)
    await tick()
    const newest = save('{"a":3}', OTHER_FILE)!

    expect(summarizeClientConfigVersions(CLIENT)).toEqual({ count: 3, lastTime: newest.createdTime })
  })
})
