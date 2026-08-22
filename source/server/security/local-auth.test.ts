import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { getSettings } from '../database/settings-store'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'
import { authorizeLocalRequest, deleteLocalAccessToken, generateLocalAccessToken, getLocalAuthStatus, rotateLocalAccessToken } from '../management/auth/service'

let temporaryDirectory: string
let secrets: Map<string, string>

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-auth-'))
  secrets = new Map()
  configureSecretStore({
    set: async (reference, value) => { secrets.set(reference, value) },
    get: async reference => secrets.get(reference) ?? null,
    delete: async reference => { secrets.delete(reference) },
  })
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('local access token', () => {
  it('allows requests while disabled and stores generated tokens only in the secret store', async () => {
    expect(await getLocalAuthStatus()).toEqual({ enabled: false })
    expect(await authorizeLocalRequest({})).toBe(true)

    const token = await generateLocalAccessToken()
    const settings = await getSettings()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(settings.accessTokenReference).toMatch(/^local_access_/)
    expect(secrets.get(settings.accessTokenReference!)).toBe(token)
    expect(JSON.stringify(settings)).not.toContain(token)
    expect(await getLocalAuthStatus()).toEqual({ enabled: true })
  })

  it('requires an exact Bearer token and invalidates the old token after rotation', async () => {
    const originalToken = await generateLocalAccessToken()
    expect(await authorizeLocalRequest({ authorization: originalToken })).toBe(false)
    expect(await authorizeLocalRequest({ authorization: 'Basic value' })).toBe(false)
    expect(await authorizeLocalRequest({ authorization: 'Bearer wrong' })).toBe(false)
    expect(await authorizeLocalRequest({ authorization: `Bearer ${originalToken}` })).toBe(true)

    const rotatedToken = await rotateLocalAccessToken()
    expect(rotatedToken).not.toBe(originalToken)
    expect(await authorizeLocalRequest({ authorization: `Bearer ${originalToken}` })).toBe(false)
    expect(await authorizeLocalRequest({ authorization: `Bearer ${rotatedToken}` })).toBe(true)
  })

  it('deletes the secret and disables authentication', async () => {
    await generateLocalAccessToken()
    await deleteLocalAccessToken()
    expect(secrets.size).toBe(0)
    expect((await getSettings()).accessTokenReference).toBeNull()
    expect(await authorizeLocalRequest({})).toBe(true)
  })
})
