import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const encryption = vi.hoisted(() => ({ available: true }))

// 测试跑在 Electron 的 Node 模式里，系统钥匙串不可用。加密本身不是这条用例要证明的事，
// 用可逆的替身把读写落在真实的文件实现上。
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryption.available,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return text.slice('enc:'.length)
    },
  },
}))

import { ElectronSecretStore } from './secret-store'

let directory: string
let filePath: string

beforeEach(() => {
  encryption.available = true
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-app-secrets-'))
  filePath = path.join(directory, 'secrets.json')
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('ElectronSecretStore', () => {
  it('keeps both keys when two writes overlap', async () => {
    const store = new ElectronSecretStore(filePath)
    await Promise.all([store.set('key_a', 'a'), store.set('key_b', 'b')])

    expect(await store.get('key_a')).toBe('a')
    expect(await store.get('key_b')).toBe('b')
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.tmp'))).toHaveLength(0)
  })

  it('does not let a rejected write poison the queue or leave a temp file', async () => {
    const store = new ElectronSecretStore(filePath)
    await store.set('key_a', 'a')

    const originalRename = fsPromises.rename
    const rename = vi.spyOn(fsPromises, 'rename').mockImplementation((from, to) => {
      if (String(from).startsWith(`${filePath}.`) && String(from).endsWith('.tmp')) {
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
      expect(fs.readdirSync(directory).filter(name => name.endsWith('.tmp'))).toEqual([])
    } finally {
      rename.mockRestore()
    }
  })

  it('rejects when system encryption is unavailable', async () => {
    encryption.available = false
    const store = new ElectronSecretStore(filePath)

    await expect(store.set('key_a', 'a')).rejects.toThrow(/System encryption is unavailable/)
    await expect(Promise.all([store.set('key_a', 'a'), store.set('key_b', 'b')])).rejects.toThrow(/System encryption is unavailable/)
    encryption.available = true
    await store.set('key_a', 'a')
    expect(await store.get('key_a')).toBe('a')
  })
})
