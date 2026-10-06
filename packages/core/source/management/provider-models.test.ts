import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_ID } from '@common/schemas'
import type { TelemetryEventInput } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
import { createProvider } from '@server/database/provider-store'
import { createLogicalModel, getDefaultLogicalModelRecordId } from '@server/database/logical-model-store'
import { providerModelRoutes } from './routes/catalog/provider-models'
import { mockResponse } from './test-support'

/**
 * 新建模型会把端点接进来，这是「这项协议能力被接上了」的一次。粒度按**端点协议**分，
 * 不按模型分：一个模型可以同时绑好几个协议的端点。
 */
const { reported } = vi.hoisted(() => ({ reported: [] as TelemetryEventInput[] }))

vi.mock('@server/telemetry', () => ({
  reportTelemetryEvent: (event: TelemetryEventInput) => {
    reported.push(event)
  },
}))

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-provider-models-'))
  await initDatabases(temporaryDirectory)
  reported.length = 0
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('provider model routes', () => {
  it('creates a model and updates its scheduling policy', async () => {
    const provider = await createProvider({ name: 'Provider Model Provider', apiKeyReference: 'key_provider_model', timeoutMilliseconds: 15_000, enabled: true })
    const logicalModel = await createLogicalModel({ modelId: 'routing-model', description: 'route tests' })

    const createRes = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/create', createRes, {
      providerId: provider.id,
      modelName: 'super-fast-model',
      logicalModelId: logicalModel.id,
      priority: 7,
      endpoints: [{ protocol: 'openai-responses', endpointUrl: 'https://example.com/v1/responses', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const created = responseData(createRes).data as { id: string }
    expect(created.id).toMatch(/^model_/)
    expect(reported).toEqual([{ name: 'model_created', protocol: 'openai-responses' }])

    const listPoliciesRes = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/list', listPoliciesRes, { logicalModelId: logicalModel.id })
    expect(responseData(listPoliciesRes).data).toEqual(expect.arrayContaining([expect.objectContaining({ providerModelId: created.id, logicalModelId: logicalModel.id, priority: 7 })]))

    const updateRes = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/update', updateRes, {
      logicalModelId: logicalModel.id,
      providerModelId: created.id,
      priority: 11,
      weight: 80,
      enabled: true,
    })
    expect(responseData(updateRes).data).toMatchObject({ logicalModelId: logicalModel.id, providerModelId: created.id, priority: 11, weight: 80 })

    const deleteRes = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/delete', deleteRes, { logicalModelId: logicalModel.id, providerModelId: created.id })
    expect(responseData(deleteRes).data).toMatchObject({ logicalModelId: logicalModel.id, providerModelId: created.id })
  })

  it('reports one model_created per endpoint protocol', async () => {
    const provider = await createProvider({ name: 'Multi Protocol Provider', apiKeyReference: 'key_multi_protocol', timeoutMilliseconds: 15_000, enabled: true })
    const logicalModel = await createLogicalModel({ modelId: 'multi-protocol-model', description: '' })

    await providerModelRoutes.invoke('/api/provider-model/create', mockResponse(), {
      providerId: provider.id,
      modelName: 'multi-protocol',
      logicalModelId: logicalModel.id,
      endpoints: [
        { protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions' },
        { protocol: 'anthropic-messages', endpointUrl: 'https://example.com/v1/messages' },
      ],
    })

    // 两个协议是两件事，不能只报第一个。
    expect(reported).toEqual([
      { name: 'model_created', protocol: 'openai-completions' },
      { name: 'model_created', protocol: 'anthropic-messages' },
    ])
  })

  it('does not report model_created when an existing model is edited', async () => {
    const provider = await createProvider({ name: 'Edited Provider', apiKeyReference: 'key_edited_provider', timeoutMilliseconds: 15_000, enabled: true })
    const model = await createModelWithEndpoint(provider.id, 'edited-model')
    reported.length = 0

    await providerModelRoutes.invoke('/api/provider-model/update', mockResponse(), { id: model.id, modelName: 'renamed-model' })

    expect(reported).toEqual([])
  })

  /*
   * 下面三条守着同一个缺陷的两种长相。
   *
   * 界面曾经在新增模型时硬编码 `logicalModelId: 'default'` —— 那是**模型名**，不是数据记录 id。
   * 路由先提交模型、再写调度绑定，绑定撞 `scheduling_policies` 的外键：接口报错，模型却已经
   * 建出来了（孤儿）。现在路由在**任何写入之前**就把落点翻成记录 id 并确认它存在，
   * 坏落点就一个字节都不落库。
   */
  it('binds a model to the built-in default logical model when no logicalModelId is given', async () => {
    const provider = await createProvider({ name: 'Default Target Provider', apiKeyReference: 'key_default_target', timeoutMilliseconds: 15_000, enabled: true })
    const defaultRecordId = await getDefaultLogicalModelRecordId()

    const createRes = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/create', createRes, {
      providerId: provider.id,
      modelName: 'unanchored-model',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions' }],
    })
    const created = responseData(createRes).data as { id: string }

    // 内建默认逻辑模型的记录 id 是本机生成的（`lm_*`），不是那个常量模型名。
    expect(defaultRecordId).toMatch(/^lm_/)
    expect(defaultRecordId).not.toBe(BUILT_IN_DEFAULT_LOGICAL_MODEL_ID)

    const policies = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/list', policies, { logicalModelId: defaultRecordId })
    expect(responseData(policies).data).toEqual([
      expect.objectContaining({ providerModelId: created.id, logicalModelId: defaultRecordId }),
    ])
  })

  it('rejects a model name masquerading as a logical model record id and leaves no orphan', async () => {
    const provider = await createProvider({ name: 'Rejected Target Provider', apiKeyReference: 'key_rejected_target', timeoutMilliseconds: 15_000, enabled: true })

    // `'default'` 是内建默认逻辑模型的**模型名**。它以前被当成外键写进去，于是先建后炸、留下孤儿。
    await expect(providerModelRoutes.invoke('/api/provider-model/create', mockResponse(), {
      providerId: provider.id,
      modelName: 'orphan-candidate',
      logicalModelId: BUILT_IN_DEFAULT_LOGICAL_MODEL_ID,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions' }],
    })).rejects.toThrow(/Logical model default not found/)

    // 关键：接口报错时**没有**任何模型被建出来。用户看到的错跟数据状态是一致的。
    const list = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list', list, {})
    expect(responseData(list).data).toEqual([])
  })

  it('rejects an unknown logical model record id and leaves no orphan', async () => {
    const provider = await createProvider({ name: 'Unknown Target Provider', apiKeyReference: 'key_unknown_target', timeoutMilliseconds: 15_000, enabled: true })

    await expect(providerModelRoutes.invoke('/api/provider-model/create', mockResponse(), {
      providerId: provider.id,
      modelName: 'orphan-candidate-2',
      logicalModelId: 'lm_missing',
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions' }],
    })).rejects.toThrow(/Logical model lm_missing not found/)

    const list = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list', list, {})
    expect(responseData(list).data).toEqual([])
  })
})

/** 不传 `logicalModelId` 时就落到内建默认逻辑模型：记录 id 由路由层自己解析。 */
async function createModelWithEndpoint(providerId: string, modelName: string, logicalModelId?: string): Promise<{ id: string }> {
  const response = mockResponse()
  await providerModelRoutes.invoke('/api/provider-model/create', response, {
    providerId,
    modelName,
    logicalModelId,
    endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions' }],
  })
  return responseData(response).data as { id: string }
}

describe('provider model CRUD routes', () => {
  it('lists models, including the soft-deleted ones when asked', async () => {
    const provider = await createProvider({ name: 'Crud Provider', apiKeyReference: 'key_crud', enabled: true })
    const model = await createModelWithEndpoint(provider.id, 'crud-model')

    const alive = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list', alive, {})
    expect(responseData(alive).data).toEqual([expect.objectContaining({ id: model.id })])

    const remove = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/delete', remove, { id: model.id })

    const afterDelete = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list', afterDelete, {})
    expect(responseData(afterDelete).data).toEqual([])

    const withDeleted = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list', withDeleted, { includeDeleted: true })
    expect(responseData(withDeleted).data).toEqual([expect.objectContaining({ id: model.id })])
  })

  it('lists the models bound to a logical model', async () => {
    const provider = await createProvider({ name: 'Logical Provider', apiKeyReference: 'key_logical', enabled: true })
    const logicalModel = await createLogicalModel({ modelId: 'logical-list', description: '' })
    const model = await createModelWithEndpoint(provider.id, 'logical-model', logicalModel.id)

    const res = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list-by-logical-model', res, { logicalModelId: logicalModel.id })
    expect(responseData(res).data).toEqual([expect.objectContaining({ id: model.id })])
  })

  it('reads a single model and throws for an unknown id', async () => {
    const provider = await createProvider({ name: 'Read Provider', apiKeyReference: 'key_read', enabled: true })
    const model = await createModelWithEndpoint(provider.id, 'read-model')

    const found = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/get', found, { id: model.id })
    expect(responseData(found).data).toMatchObject({ id: model.id })

    await expect(providerModelRoutes.invoke('/api/provider-model/get', mockResponse(), { id: 'model_missing' }))
      .rejects.toThrow(/provider model model_missing not found/)
  })

  it('merges partial updates and rewrites the scheduling policy when both fields are given', async () => {
    const provider = await createProvider({ name: 'Update Provider', apiKeyReference: 'key_update', enabled: true })
    const logicalModel = await createLogicalModel({ modelId: 'logical-update', description: '' })
    const model = await createModelWithEndpoint(provider.id, 'update-model', logicalModel.id)

    const res = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/update', res, {
      id: model.id,
      modelName: 'renamed-model',
      enabled: true,
      logicalModelId: logicalModel.id,
      priority: 42,
    })
    expect(responseData(res).data).toMatchObject({ id: model.id, modelName: 'renamed-model', enabled: true })

    const policies = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/list', policies, { logicalModelId: logicalModel.id })
    expect(responseData(policies).data).toEqual([
      expect.objectContaining({ providerModelId: model.id, logicalModelId: logicalModel.id, priority: 42 }),
    ])
  })

  it('leaves the scheduling policy untouched when only a logical model id is supplied', async () => {
    const provider = await createProvider({ name: 'Partial Provider', apiKeyReference: 'key_partial', enabled: true })
    const logicalModel = await createLogicalModel({ modelId: 'logical-partial', description: '' })
    const model = await createModelWithEndpoint(provider.id, 'partial-model', logicalModel.id)

    const res = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/update', res, { id: model.id, logicalModelId: logicalModel.id, modelName: 'still-partial' })
    expect(responseData(res).data).toMatchObject({ id: model.id, modelName: 'still-partial' })
  })
})
