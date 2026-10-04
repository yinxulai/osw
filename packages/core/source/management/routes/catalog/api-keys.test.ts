import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '@common/secret-store'
import { closeDatabases, initDatabases } from '@server/database'
import { listApiKeys } from '@server/database/api-key-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { apiKeyRoutes } from './api-keys'
import { mockResponse } from '../../test-support'

let temporaryDirectory: string
let secrets: Map<string, string>

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

/** 建一把 Key 并返回它的 id 与一次性明文。 */
async function createKey(name: string): Promise<{ id: string; secret: string }> {
  const res = mockResponse()
  await apiKeyRoutes.invoke('/api/api-key/create', res, { name })
  return responseData(res).data as { id: string; secret: string }
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-api-key-routes-'))
  await initDatabases(temporaryDirectory)
  secrets = new Map()
  const secretStore: SecretStore = {
    set: vi.fn(async (reference: string, value: string) => { secrets.set(reference, value) }),
    get: vi.fn(async (reference: string) => secrets.get(reference) ?? null),
    delete: vi.fn(async (reference: string) => { secrets.delete(reference) }),
  }
  configureSecretStore(secretStore)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('api key routes', () => {
  it('returns a one-time plaintext secret on create and keeps the plaintext in the secret store', async () => {
    const { id, secret } = await createKey('CI runner')

    expect(id.startsWith('ak_')).toBe(true)
    expect(secret.startsWith('osw-')).toBe(true)
    // 明文只有一份，宿主的密钥存储持有它。
    expect([...secrets.values()]).toContain(secret)
  })

  it('never echoes the plaintext through list or get', async () => {
    const { id } = await createKey('laptop')

    const listRes = mockResponse()
    await apiKeyRoutes.invoke('/api/api-key/list', listRes, {})
    const list = responseData(listRes).data as Array<Record<string, unknown>>
    expect(list[0]).not.toHaveProperty('secret')

    const getRes = mockResponse()
    await apiKeyRoutes.invoke('/api/api-key/get', getRes, { id })
    expect(responseData(getRes).data).not.toHaveProperty('secret')
    expect(responseData(getRes).data).toMatchObject({ id, name: 'laptop' })
  })

  it('rotates the plaintext in place while keeping the key id and reference', async () => {
    const { id, secret: original } = await createKey('rotate me')

    const rotateRes = mockResponse()
    await apiKeyRoutes.invoke('/api/api-key/rotate', rotateRes, { id })
    const rotated = responseData(rotateRes).data as { id: string; secret: string }

    expect(rotated.id).toBe(id)
    expect(rotated.secret).not.toBe(original)
    // 旧明文立即失效：密钥存储里被新明文覆盖，不再持有旧的那一份。
    expect([...secrets.values()]).toContain(rotated.secret)
    expect([...secrets.values()]).not.toContain(original)
  })

  it('soft-deletes the metadata and removes the plaintext from the secret store', async () => {
    const { id, secret } = await createKey('disposable')

    const deleteRes = mockResponse()
    await apiKeyRoutes.invoke('/api/api-key/delete', deleteRes, { id })

    expect(await listApiKeys()).toHaveLength(0)
    expect([...secrets.values()]).not.toContain(secret)
  })

  it('does not leave an orphan plaintext when the metadata write is rejected', async () => {
    await createKey('taken')

    const res = mockResponse()
    await expect(apiKeyRoutes.invoke('/api/api-key/create', res, { name: 'taken' })).rejects.toThrow(/already exists/i)
    // 元数据没落库，明文也不该留在密钥存储里。
    expect(secrets.size).toBe(1)
  })
})
