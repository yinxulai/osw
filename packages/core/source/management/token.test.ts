import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  generateManagementToken,
  managementTokenPath,
  readManagementToken,
  removeManagementToken,
  writeManagementToken,
} from './token'

/**
 * 凭证文件的读写。
 *
 * 这里只管「落盘这一层对不对」，不管守卫怎么用（那是 `request-guards.test.ts`）：
 * 覆盖三件容易悄悄坏掉的事——权限是 0600、覆盖写之后权限仍然是 0600、读不到时回 `null`
 * 而不是抛错（`stop` / `status` 靠这个判断「这次调用注定失败」）。
 */

let temporaryDirectory: string

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-management-token-'))
})

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function fileMode(file: string): number {
  return fs.statSync(file).mode & 0o777
}

describe('management token', () => {
  it('generates a 32-byte base64url string', () => {
    const token = generateManagementToken()

    // 43 个字符 = 32 字节去掉一个 `=` 填充；base64url 不含 `+` / `/`，所以能直接进头部。
    expect(token).toHaveLength(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(generateManagementToken()).not.toBe(token)
  })

  it('round-trips the token and keeps the file private to the owner', async () => {
    await writeManagementToken(temporaryDirectory, 'first-token')

    expect(await readManagementToken(temporaryDirectory)).toBe('first-token')
    expect(fileMode(managementTokenPath(temporaryDirectory))).toBe(0o600)
  })

  it('tightens the mode again when overwriting an existing file', async () => {
    const file = managementTokenPath(temporaryDirectory)
    // `writeFile` 的 `mode` 只作用于创建，所以先放一个宽松权限的同名文件，
    // 断言覆盖写之后权限被显式收回来——不然「重启后换了一份凭证」会顺带把文件变成可读。
    fs.writeFileSync(file, 'old-token', { mode: 0o644 })
    expect(fileMode(file)).toBe(0o644)

    await writeManagementToken(temporaryDirectory, 'new-token')

    expect(await readManagementToken(temporaryDirectory)).toBe('new-token')
    expect(fileMode(file)).toBe(0o600)
  })

  it('never leaves a temporary file behind', async () => {
    await writeManagementToken(temporaryDirectory, 'token')

    const leftovers = fs.readdirSync(temporaryDirectory).filter(name => name !== 'management.token')
    expect(leftovers).toEqual([])
  })

  it('returns null instead of throwing when the file is missing or empty', async () => {
    expect(await readManagementToken(temporaryDirectory)).toBeNull()

    // 空文件只意味着「这次调用不会成功」，不该把 `stop` / `status` 变成一次崩溃。
    fs.writeFileSync(managementTokenPath(temporaryDirectory), '   \n')
    expect(await readManagementToken(temporaryDirectory)).toBeNull()
  })

  it('removes the file and tolerates a second removal', async () => {
    await writeManagementToken(temporaryDirectory, 'token')

    await removeManagementToken(temporaryDirectory)
    expect(fs.existsSync(managementTokenPath(temporaryDirectory))).toBe(false)
    // 退出路径要幂等：服务已经删过一次、或本来就没写过，都不该让退出失败。
    await expect(removeManagementToken(temporaryDirectory)).resolves.toBeUndefined()
  })
})
