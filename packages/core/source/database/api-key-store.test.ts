import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import {
  apiKeyNameInUse,
  createApiKey,
  deleteApiKey,
  getApiKey,
  getApiKeyByReference,
  listApiKeys,
  updateApiKey,
} from './api-key-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-api-key-store-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('api key store', () => {
  it('creates a key with an ak_ id and defaults to enabled without an expiry', async () => {
    const key = await createApiKey({ name: 'CI runner', keyReference: 'ref_ci' })

    expect(key.id.startsWith('ak_')).toBe(true)
    expect(key).toMatchObject({ name: 'CI runner', keyReference: 'ref_ci', enabled: true, expiresTime: null, deletedTime: null })
  })

  it('reads a key back by id and by its secret reference', async () => {
    const created = await createApiKey({ name: 'laptop', keyReference: 'ref_laptop' })

    expect(await getApiKey(created.id)).toMatchObject({ id: created.id, name: 'laptop' })
    expect(await getApiKeyByReference('ref_laptop')).toMatchObject({ id: created.id })
  })

  it('lists only the live keys in creation order', async () => {
    const first = await createApiKey({ name: 'first', keyReference: 'ref_1' })
    await createApiKey({ name: 'second', keyReference: 'ref_2' })

    expect((await listApiKeys()).map(key => key.id)).toEqual([first.id, expect.any(String)])
  })

  it('rejects a duplicate name against a live key', async () => {
    await createApiKey({ name: 'shared name', keyReference: 'ref_a' })

    await expect(createApiKey({ name: 'shared name', keyReference: 'ref_b' })).rejects.toThrow(/already exists/i)
  })

  it('frees the name once a key is soft-deleted', async () => {
    const key = await createApiKey({ name: 'reusable', keyReference: 'ref_x' })
    await deleteApiKey(key.id)

    expect(await apiKeyNameInUse('reusable')).toBe(false)
    // 同名重建必须成功——「不许重名」的主语是活着的那一行。
    const recreated = await createApiKey({ name: 'reusable', keyReference: 'ref_y' })
    expect(recreated.id).not.toBe(key.id)
  })

  it('soft-deletes by disabling and stamping deletedTime while keeping the row for history', async () => {
    const key = await createApiKey({ name: 'to remove', keyReference: 'ref_del' })
    await deleteApiKey(key.id)

    // 历史请求日志还引用着这个 id，所以行不能消失，只是从列表里隐去。
    expect(await listApiKeys()).toHaveLength(0)
    expect(await getApiKey(key.id)).toMatchObject({ id: key.id, enabled: false, deletedTime: expect.any(Number) })
  })

  it('ignores its own name when checking availability during an update', async () => {
    const key = await createApiKey({ name: 'rename me', keyReference: 'ref_r' })

    const renamed = await updateApiKey(key.id, { name: 'renamed' })
    expect(renamed.name).toBe('renamed')
    // 改成别的名字再改回自己被删掉前用的名字也不冲突。
    expect(await updateApiKey(key.id, { name: 'rename me' })).toMatchObject({ name: 'rename me' })
  })

  it('refuses to rename a key onto another live key name', async () => {
    await createApiKey({ name: 'taken', keyReference: 'ref_taken' })
    const other = await createApiKey({ name: 'free', keyReference: 'ref_free' })

    await expect(updateApiKey(other.id, { name: 'taken' })).rejects.toThrow(/already exists/i)
  })

  it('throws a not-found error when updating a missing key', async () => {
    await expect(updateApiKey('ak_missing', { enabled: false })).rejects.toThrow(/not found/i)
  })

  it('round-trips enable state and expiry through updates', async () => {
    const key = await createApiKey({ name: 'expiring', keyReference: 'ref_e' })
    const expiresTime = Date.now() + 3_600_000

    const updated = await updateApiKey(key.id, { enabled: false, expiresTime })
    expect(updated).toMatchObject({ enabled: false, expiresTime })
    expect(await getApiKey(key.id)).toMatchObject({ enabled: false, expiresTime })
  })
})
