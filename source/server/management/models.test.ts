import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { createLogicalModel } from '../database/logical-model-store'
import { modelRoutes } from './models'

function mockResponse() {
  return { statusCode: 0, headersSent: false, writableEnded: false, setHeader: vi.fn(), end: vi.fn() } as unknown as import('node:http').ServerResponse
}

function responseData(response: import('node:http').ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-models-'))
  await initDatabase(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('logical model routes', () => {
  it('creates, lists, gets, updates and deletes a logical model', async () => {
    const createRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/create', createRes, { name: 'dev-model', description: 'for tests' })
    const created = responseData(createRes).data as { id: string; name: string }
    expect(created.name).toBe('dev-model')

    const listRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/list', listRes)
    expect(responseData(listRes).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]))

    const getRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/get', getRes, { id: created.id })
    expect(responseData(getRes).data).toMatchObject({ id: created.id, name: 'dev-model' })

    const updateRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/update', updateRes, { id: created.id, description: 'updated', enabled: false })
    expect(responseData(updateRes).data).toMatchObject({ id: created.id, description: 'updated', enabled: false })

    const deleteRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/delete', deleteRes, { id: created.id })
    expect(responseData(deleteRes).data).toEqual({ id: created.id })
  })

  it('returns not found for a missing logical model id', async () => {
    const res = mockResponse()
    await modelRoutes.invoke('/api/logical-model/get', res, { id: 'missing_model' })
    expect(res.statusCode).toBe(404)
    expect(responseData(res)).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('creates a model from the underlying store with default fields', async () => {
    const model = await createLogicalModel({ name: 'store-model' })
    expect(model).toMatchObject({ name: 'store-model', enabled: true, description: '' })
  })
})
