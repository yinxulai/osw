import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '../database'
import { createLogicalModel } from '@server/database/logical-model-store'
import { modelRoutes } from './routes/catalog'
import { mockResponse } from './test-support'

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-models-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('logical model routes', () => {
  it('creates, lists, gets, updates and deletes a logical model', async () => {
    const createRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/create', createRes, { modelId: 'dev-model', description: 'for tests' })
    const created = responseData(createRes).data as { id: string; modelId: string }
    expect(created.modelId).toBe('dev-model')

    const listRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/list', listRes)
    expect(responseData(listRes).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]))

    const getRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/get', getRes, { id: created.id })
    expect(responseData(getRes).data).toMatchObject({ id: created.id, modelId: 'dev-model' })

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

  it('reorders logical models through the management route', async () => {
    await createLogicalModel({ modelId: 'route-order-a' })
    await createLogicalModel({ modelId: 'route-order-b' })

    const listRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/list', listRes)
    const before = (responseData(listRes).data as { id: string }[]).map(model => model.id)
    const reversed = [...before].reverse()

    const reorderRes = mockResponse()
    await modelRoutes.invoke('/api/logical-model/reorder', reorderRes, { ids: reversed })
    expect((responseData(reorderRes).data as { id: string }[]).map(model => model.id)).toEqual(reversed)
  })

  it('creates a model from the underlying store with default fields', async () => {
    const model = await createLogicalModel({ modelId: 'store-model' })
    expect(model).toMatchObject({ modelId: 'store-model', enabled: true, description: '' })
  })
})
