import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MANAGEMENT_TOKEN_FILE_NAME,
  managementTokenFilePath,
  readManagementToken,
  removeManagementToken,
  writeManagementToken,
} from './token-file'

/**
 * 凭证的交付通道。
 *
 * 这里不测「凭证对不对」（那是 `./gateway/access.test.ts` 的事），只测这份文件本身：
 * 权限、原子性、读不到时的口径。它是一条**跨进程**的通道，所以任何一点含糊都会以
 * 「`osw stop` 时好时坏」的形式出现。
 */

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-token-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('managementTokenFilePath', () => {
  it('puts one fixed name in the data directory', () => {
    // 名字固定：读的一方（`osw stop` / `osw status` / 截图进程）不该去猜。
    expect(managementTokenFilePath(dataDir)).toBe(path.join(dataDir, MANAGEMENT_TOKEN_FILE_NAME))
    expect(MANAGEMENT_TOKEN_FILE_NAME).toBe('management.token')
  })
})

describe('writeManagementToken', () => {
  it('writes the credential where the reader expects it', async () => {
    await writeManagementToken(dataDir, 'the-token')

    expect(fs.readFileSync(managementTokenFilePath(dataDir), 'utf8')).toBe('the-token')
  })

  it('leaves no temporary file behind', async () => {
    // 先写 `.tmp` 再 rename 是为了原子性；漏下那个 `.tmp` 就等于把凭证在目录里多放了
    // 一份，而且是不带 `0600` 承诺的那一份。
    await writeManagementToken(dataDir, 'the-token')

    expect(fs.readdirSync(dataDir)).toEqual([MANAGEMENT_TOKEN_FILE_NAME])
  })

  it('is readable by its owner only', async () => {
    // 这条是它对「同一台机器上的其他用户」有效的全部理由。目录里躺着的是一把能读写
    // 全部配置（含明文密钥导出）的钥匙。
    await writeManagementToken(dataDir, 'the-token')

    expect(fs.statSync(managementTokenFilePath(dataDir)).mode & 0o777).toBe(0o600)
  })

  it('creates the data directory when it does not exist yet', async () => {
    // 第一次启动时数据目录可能还没建（`start` 会建，但进程内调用不一定）。
    const nested = path.join(dataDir, 'a', 'b')

    await writeManagementToken(nested, 'the-token')

    expect(await readManagementToken(nested)).toBe('the-token')
  })

  it('replaces a previous credential atomically', async () => {
    // 上一次启动留下的文件还在（崩溃没删）。这里必须是「整份换掉」，不能是
    // 「打开、清空、写入」——中间那一刻读到的是一份空凭证。
    await writeManagementToken(dataDir, 'old-token')
    await writeManagementToken(dataDir, 'new-token')

    expect(await readManagementToken(dataDir)).toBe('new-token')
  })

  it('keeps the permissions when overwriting a file it did not create', async () => {
    // `mode` 只在创建时生效，所以这里显式确认一遍：一个本来就宽的旧文件不会被
    // 悄悄沿用权限。
    const filePath = managementTokenFilePath(dataDir)
    fs.writeFileSync(filePath, 'manual', { mode: 0o644 })

    await writeManagementToken(dataDir, 'the-token')

    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
  })
})

describe('readManagementToken', () => {
  it('reports a missing file as "no credential", not as an error', async () => {
    // 没起来、或者已经干净退出，都是正常状态。
    await expect(readManagementToken(dataDir)).resolves.toBeNull()
  })

  it('trims a hand-written credential', async () => {
    // 这个文件是人也能 `cat` 的，手工 `echo` 造一份会带换行；带换行的凭证只会换来
    // 一个「凭证不对」，与真实原因完全对不上。
    fs.writeFileSync(managementTokenFilePath(dataDir), ' the-token\n')

    expect(await readManagementToken(dataDir)).toBe('the-token')
  })

  it('treats an empty file as "no credential"', async () => {
    // 空字符串不是凭证，但把它当成凭证交出去会得到一个 401：「说好了带凭证，怎么就
    // 不认」。null 让调用方走「没有」这条分支。
    fs.writeFileSync(managementTokenFilePath(dataDir), '   \n')

    expect(await readManagementToken(dataDir)).toBeNull()
  })

  it('rethrows a permission error instead of hiding it as "no credential"', async () => {
    // 静默当成「没有」，环境问题就会被报成「服务没在跑」，用户会去怀疑一个好人。
    const filePath = managementTokenFilePath(dataDir)
    fs.writeFileSync(filePath, 'the-token')
    fs.chmodSync(filePath, 0o000)

    try {
      await expect(readManagementToken(dataDir)).rejects.toThrow()
    } finally {
      fs.chmodSync(filePath, 0o600)
    }
  })
})

describe('removeManagementToken', () => {
  it('is a no-op when there is nothing to remove', async () => {
    // 退出流程不该因为「本来就没有」而失败。
    await expect(removeManagementToken(dataDir)).resolves.toBeUndefined()
  })

  it('removes the file', async () => {
    await writeManagementToken(dataDir, 'the-token')

    await removeManagementToken(dataDir)

    expect(fs.existsSync(managementTokenFilePath(dataDir))).toBe(false)
    expect(await readManagementToken(dataDir)).toBeNull()
  })

  it('is safe to call twice', async () => {
    await writeManagementToken(dataDir, 'the-token')
    await removeManagementToken(dataDir)

    await expect(removeManagementToken(dataDir)).resolves.toBeUndefined()
  })
})
