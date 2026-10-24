import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '@common/secret-store'
import { closeDatabases, initDatabases } from '@server/database'
import { createApiKey, deleteApiKey, updateApiKey } from '@server/database/api-key-store'
import { invalidateConfigReadCache } from '@server/database/config-read-cache'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { extractPresentedApiKey, resetApiKeyIdentityCache, resolveApiKeyIdentity } from './api-key-auth'

let temporaryDirectory: string
let secrets: Map<string, string>
let secretStore: SecretStore

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-api-key-auth-'))
  await initDatabases(temporaryDirectory)
  secrets = new Map()
  secretStore = {
    set: vi.fn(async (reference: string, value: string) => { secrets.set(reference, value) }),
    get: vi.fn(async (reference: string) => secrets.get(reference) ?? null),
    delete: vi.fn(async (reference: string) => { secrets.delete(reference) }),
  }
  configureSecretStore(secretStore)
  resetApiKeyIdentityCache()
})

afterEach(async () => {
  await closeDatabases()
  resetApiKeyIdentityCache()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

/** 建一把带明文的 Key：配置库那一行走 store，明文留在内存版的密钥存储里。 */
type SeedKeyOptions = { enabled?: boolean; expiresTime?: number | null }

async function seedKey(name: string, secret: string, options: SeedKeyOptions = {}) {
  const reference = `ref_${name}`
  secrets.set(reference, secret)
  return createApiKey({ name, keyReference: reference, enabled: options.enabled ?? true, expiresTime: options.expiresTime ?? null })
}

describe('extractPresentedApiKey', () => {
  it('reads a bare token from any of the client auth headers', () => {
    expect(extractPresentedApiKey({ 'x-api-key': 'osw-abc' })).toBe('osw-abc')
    expect(extractPresentedApiKey({ 'x-goog-api-key': 'osw-google' })).toBe('osw-google')
  })

  it('strips the Bearer prefix from the authorization header', () => {
    expect(extractPresentedApiKey({ authorization: 'Bearer osw-token' })).toBe('osw-token')
    expect(extractPresentedApiKey({ authorization: 'bearer osw-lower' })).toBe('osw-lower')
  })

  it('returns null when no auth header is present', () => {
    expect(extractPresentedApiKey({ 'content-type': 'application/json' })).toBeNull()
  })
})

describe('resolveApiKeyIdentity', () => {
  it('permits everything anonymously while enforcement is off', async () => {
    // 校验关着时，即便带着一把有效 Key 也仍算匿名——身份只在校验开启后才有意义。
    await seedKey('present', 'osw-present')

    expect(await resolveApiKeyIdentity({ 'x-api-key': 'osw-present' }, false)).toEqual({ apiKeyId: null, authorized: true })
    expect(await resolveApiKeyIdentity({}, false)).toEqual({ apiKeyId: null, authorized: true })
  })

  it('binds a matching key to its record id while enforcement is on', async () => {
    const key = await seedKey('bound', 'osw-bound')

    expect(await resolveApiKeyIdentity({ 'x-api-key': 'osw-bound' }, true)).toEqual({ apiKeyId: key.id, authorized: true })
  })

  it('rejects a missing or unknown key while enforcement is on', async () => {
    await seedKey('known', 'osw-known')

    expect(await resolveApiKeyIdentity({}, true)).toEqual({ apiKeyId: null, authorized: false })
    expect(await resolveApiKeyIdentity({ 'x-api-key': 'osw-stranger' }, true)).toEqual({ apiKeyId: null, authorized: false })
  })

  it('rejects a disabled key', async () => {
    const key = await seedKey('off', 'osw-off')
    await updateApiKey(key.id, { enabled: false })

    expect(await resolveApiKeyIdentity({ 'x-api-key': 'osw-off' }, true)).toEqual({ apiKeyId: null, authorized: false })
  })

  it('rejects an expired key', async () => {
    await seedKey('stale', 'osw-stale', { expiresTime: Date.now() - 1000 })

    expect(await resolveApiKeyIdentity({ 'x-api-key': 'osw-stale' }, true)).toEqual({ apiKeyId: null, authorized: false })
  })

  it('rejects a deleted key', async () => {
    const key = await seedKey('gone', 'osw-gone')
    await deleteApiKey(key.id)

    expect(await resolveApiKeyIdentity({ 'x-api-key': 'osw-gone' }, true)).toEqual({ apiKeyId: null, authorized: false })
  })

  it('picks up a newly created key after the config cache generation advances', async () => {
    expect(await resolveApiKeyIdentity({ 'x-api-key': 'osw-late' }, true)).toEqual({ apiKeyId: null, authorized: false })

    const key = await seedKey('late', 'osw-late')
    // 建库的写路径会自己推进配置代（见 `database/index.ts` 的 `wrapConfigHandleWithInvalidation`），
    // 反查表随之作废；这里显式再推一次只是为了让用例不依赖那条实现细节。
    invalidateConfigReadCache()

    expect(await resolveApiKeyIdentity({ 'x-api-key': 'osw-late' }, true)).toEqual({ apiKeyId: key.id, authorized: true })
  })

  it('一把 Key 的明文读不出来时只跳过它，其余 Key 照常放行', async () => {
    const broken = await seedKey('broken', 'osw-broken')
    const working = await seedKey('working', 'osw-working')
    // 系统钥匙串被锁、被占住时的真实形态：`get` 直接抛。
    secretStore.get = vi.fn(async (reference: string) => {
      if (reference === broken.keyReference) throw new Error('keychain is locked')
      return secrets.get(reference) ?? null
    })

    await expect(resolveApiKeyIdentity({ 'x-api-key': 'osw-working' }, true)).resolves.toEqual({ apiKeyId: working.id, authorized: true })
    // 读不出来的那把此刻验不过（它的客户端会收到 401），而不是把整台代理都变成 401。
    await expect(resolveApiKeyIdentity({ 'x-api-key': 'osw-broken' }, true)).resolves.toEqual({ apiKeyId: null, authorized: false })
  })
})
