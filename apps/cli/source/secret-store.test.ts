import crypto from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncryptedFileSecretStore, MASTER_KEY_ENVIRONMENT_VARIABLE, MASTER_KEY_FILE_NAME, SECRETS_FILE_NAME } from './secret-store'

let dataDirectory: string
const originalMasterKey = process.env[MASTER_KEY_ENVIRONMENT_VARIABLE]

function masterKeyPath(): string {
  return path.join(dataDirectory, MASTER_KEY_FILE_NAME)
}

function secretsPath(): string {
  return path.join(dataDirectory, SECRETS_FILE_NAME)
}

function readKeyFile(): Buffer {
  return Buffer.from(fs.readFileSync(masterKeyPath(), 'utf8').trim(), 'base64')
}

beforeEach(() => {
  dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-cli-secrets-'))
  delete process.env[MASTER_KEY_ENVIRONMENT_VARIABLE]
})

afterEach(() => {
  fs.rmSync(dataDirectory, { recursive: true, force: true })
  if (originalMasterKey === undefined) delete process.env[MASTER_KEY_ENVIRONMENT_VARIABLE]
  else process.env[MASTER_KEY_ENVIRONMENT_VARIABLE] = originalMasterKey
})

describe('EncryptedFileSecretStore', () => {
  it('round-trips a value', async () => {
    const store = new EncryptedFileSecretStore(dataDirectory)
    await store.set('key_openai', 'sk-secret-value')

    expect(await store.get('key_openai')).toBe('sk-secret-value')
  })

  it('returns null for an unknown reference', async () => {
    const store = new EncryptedFileSecretStore(dataDirectory)

    expect(await store.get('key_missing')).toBeNull()
  })

  it('never writes the plaintext to disk', async () => {
    const store = new EncryptedFileSecretStore(dataDirectory)
    await store.set('key_openai', 'sk-secret-value')

    const raw = fs.readFileSync(secretsPath(), 'utf8')
    expect(raw).not.toContain('sk-secret-value')
    expect(JSON.parse(raw)).toMatchObject({ key_openai: expect.stringMatching(/^v1:/) })
  })

  it('restricts the secrets file permissions', async () => {
    const store = new EncryptedFileSecretStore(dataDirectory)
    await store.set('key_openai', 'sk-secret-value')

    // Windows 上 POSIX 权限位不可靠，只在其它平台断言。
    if (process.platform !== 'win32') {
      expect(fs.statSync(secretsPath()).mode & 0o777).toBe(0o600)
      expect(fs.statSync(masterKeyPath()).mode & 0o777).toBe(0o600)
    }
  })

  it('keeps both keys when two writes overlap', async () => {
    const store = new EncryptedFileSecretStore(dataDirectory)
    await Promise.all([store.set('key_a', 'a'), store.set('key_b', 'b')])

    expect(await store.get('key_a')).toBe('a')
    expect(await store.get('key_b')).toBe('b')
    // 同实例 get 用的是内存里的主密钥。重新打开才证明第一次写下的 key 文件能解开这两条。
    const reopened = new EncryptedFileSecretStore(dataDirectory)
    expect(await reopened.get('key_a')).toBe('a')
    expect(await reopened.get('key_b')).toBe('b')
    expect(fs.readdirSync(dataDirectory).filter(name => name.endsWith('.tmp'))).toHaveLength(0)
  })

  it('does not let a rejected write poison the queue or leave a temp file', async () => {
    const store = new EncryptedFileSecretStore(dataDirectory)
    await store.set('key_a', 'a')

    const originalRename = fsPromises.rename
    const rename = vi.spyOn(fsPromises, 'rename').mockImplementation((from, to) => {
      if (String(from).includes(`${SECRETS_FILE_NAME}.`) && String(from).endsWith('.tmp')) {
        rename.mockImplementation(originalRename)
        return Promise.reject(Object.assign(new Error('rename failed'), { code: 'EBUSY' }))
      }
      return originalRename(from, to)
    })

    try {
      const failed = store.set('key_b', 'b')
      const followed = store.set('key_c', 'c')
      await expect(failed).rejects.toThrow(/rename failed/)
      await followed
      expect(await store.get('key_a')).toBe('a')
      expect(await store.get('key_b')).toBeNull()
      expect(await store.get('key_c')).toBe('c')
      expect(fs.readdirSync(dataDirectory).filter(name => name.endsWith('.tmp'))).toEqual([])
    } finally {
      rename.mockRestore()
    }
  })

  it('overwrites and deletes entries', async () => {
    const store = new EncryptedFileSecretStore(dataDirectory)

    await store.set('key_a', 'first')
    await store.set('key_a', 'second')
    expect(await store.get('key_a')).toBe('second')

    await store.delete('key_a')
    expect(await store.get('key_a')).toBeNull()
    // 删除不存在的条目不报错：调用方不该为了「可能已经删过」写 try/catch。
    await expect(store.delete('key_a')).resolves.toBeUndefined()
  })

  it('generates a 32-byte master key on first use', async () => {
    expect(fs.existsSync(masterKeyPath())).toBe(false)

    await new EncryptedFileSecretStore(dataDirectory).set('key_a', 'value')

    expect(readKeyFile()).toHaveLength(32)
    expect(fs.readdirSync(dataDirectory).filter(name => name.endsWith('.tmp'))).toHaveLength(0)
  })

  it('reuses the same master key across instances', async () => {
    await new EncryptedFileSecretStore(dataDirectory).set('key_a', 'value')
    const keyBefore = readKeyFile()

    // 第二个实例能解出第一个实例写下的密文，才说明主密钥是被复用而不是重新生成的。
    expect(await new EncryptedFileSecretStore(dataDirectory).get('key_a')).toBe('value')
    expect(readKeyFile()).toEqual(keyBefore)
  })

  it('refuses to regenerate the master key when it cannot be read', async () => {
    await new EncryptedFileSecretStore(dataDirectory).set('key_a', 'value')
    // 长度不对等价于「读不出来」：重建会把已经存进供应商的密钥全部作废。
    fs.writeFileSync(masterKeyPath(), 'not-a-valid-key')

    await expect(new EncryptedFileSecretStore(dataDirectory).set('key_b', 'value')).rejects.toThrow(/must be a base64 encoded 32-byte key/)
    expect(fs.readFileSync(masterKeyPath(), 'utf8')).toBe('not-a-valid-key')
  })

  it('fails loudly when the ciphertext was tampered with', async () => {
    const store = new EncryptedFileSecretStore(dataDirectory)
    await store.set('key_a', 'value')

    const secrets = JSON.parse(fs.readFileSync(secretsPath(), 'utf8')) as Record<string, string>
    const fields = secrets.key_a?.split(':') ?? []
    const ciphertext = Buffer.from(fields[3] ?? '', 'base64')
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff
    secrets.key_a = `${fields[0]}:${fields[1]}:${fields[2]}:${ciphertext.toString('base64')}`
    fs.writeFileSync(secretsPath(), JSON.stringify(secrets))

    // GCM 认证失败要抛出，而不是装作「没有这个密钥」——后者会让调用方以为用户没配过。
    await expect(store.get('key_a')).rejects.toThrow()
  })

  it('rejects a stored value that is not in the v1 format', async () => {
    fs.writeFileSync(secretsPath(), JSON.stringify({ key_a: 'plain-text' }))

    await expect(new EncryptedFileSecretStore(dataDirectory).get('key_a')).rejects.toThrow(/expected v1 format/)
  })

  it('lets the environment override the on-disk master key', async () => {
    const key = crypto.randomBytes(32)
    process.env[MASTER_KEY_ENVIRONMENT_VARIABLE] = key.toString('base64')

    const store = new EncryptedFileSecretStore(dataDirectory)
    await store.set('key_a', 'value')

    expect(fs.existsSync(masterKeyPath())).toBe(false)
    expect(await store.get('key_a')).toBe('value')
  })

  it('rejects an environment key that is not 32 bytes', async () => {
    process.env[MASTER_KEY_ENVIRONMENT_VARIABLE] = crypto.randomBytes(16).toString('base64')

    await expect(new EncryptedFileSecretStore(dataDirectory).set('key_a', 'value')).rejects.toThrow(
      new RegExp(`\\$${MASTER_KEY_ENVIRONMENT_VARIABLE} must be a base64 encoded 32-byte key`),
    )
  })
})

describe('secret store file names', () => {
  it('does not collide with the desktop form inside a shared data directory', async () => {
    // 桌面形态写的是数据目录下的 `secrets.json`（`apps/app/source/index.ts`）。
    // 两种形态的密文算法互不相识，同名就会互相把对方的条目读成损坏数据。
    expect(SECRETS_FILE_NAME).not.toBe('secrets.json')
    expect(MASTER_KEY_FILE_NAME).not.toBe('secrets.json')

    await new EncryptedFileSecretStore(dataDirectory).set('key_a', 'value')

    // 冒烟式地钉住「写下去的确实不是桌面形态那个文件名」。
    expect(fs.existsSync(path.join(dataDirectory, 'secrets.json'))).toBe(false)
  })
})
