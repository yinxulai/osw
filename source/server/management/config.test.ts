import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createProvider } from '../database/provider-store'
import { configRoutes } from './config/routes'

function mockResponse() {
  return { statusCode: 0, setHeader: vi.fn(), end: vi.fn() } as unknown as import('node:http').ServerResponse
}

function responsePayload(response: import('node:http').ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-config-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('configuration schema', () => {
  it('exports schema version 3 without provider secrets', async () => {
    await createProvider({ name: 'Export Provider', apiKeyReference: 'key_export', timeoutMilliseconds: 30_000 })
    const response = mockResponse()

    await configRoutes['/api/config/export']({} as import('node:http').IncomingMessage, response, {})

    const payload = responsePayload(response) as { success: boolean; data: { config: { schemaVersion: number; providers: Array<{ apiKeyPlaceholder: string }> } } }
    expect(payload.success).toBe(true)
    expect(payload.data.config.schemaVersion).toBe(3)
    expect(payload.data.config.providers).toEqual([
      expect.objectContaining({ apiKeyPlaceholder: '***' }),
    ])
  })

  it('rejects the removed version field during import', async () => {
    const response = mockResponse()

    await configRoutes['/api/config/import']({} as import('node:http').IncomingMessage, response, {
      config: { version: 3 },
      mode: 'merge',
    })

    expect(response.statusCode).toBe(400)
    expect(responsePayload(response)).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})
