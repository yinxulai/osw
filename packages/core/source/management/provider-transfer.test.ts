import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '@common/secret-store'
import type { TelemetryEventInput } from '@common/telemetry'
import { PROVIDER_BUNDLE_FORMAT, PROVIDER_BUNDLE_VERSION } from '@common/provider-bundle'
import type { ProviderBundle, ProviderBundleProvider } from '@common/provider-bundle'
import { closeDatabases, initDatabases } from '../database'
import { normalizeError } from '../errors'
import { listSchedulingPolicies } from '@server/database/logical-model-store'
import { createProviderModelRoute, listProviderModels } from '@server/database/model-store'
import {
  createProvider,
  deleteProvider,
  listProviderEndpoints,
  listProviderSettings,
  listProviders,
  replaceProviderEndpointStates,
  upsertProviderSetting,
} from '@server/database/provider-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { exportProviderBundle } from './provider-transfer/export-provider-bundle'
import { importProviderBundle } from './provider-transfer/import-provider-bundle'
import { providerRoutes } from './routes/catalog/providers'
import { mockResponse } from './test-support'

const API_KEY_REFERENCE = 'key_source_environment'

/**
 * 导入的埋点口径：**只算真的新建出来的记录**。同名供应商（及其同名模型）走的是覆盖分支，
 * 那是一次更新，不是「建出来了」——把它算成新建会让这张表里混进没发生的事。
 */
const { reported } = vi.hoisted(() => ({ reported: [] as TelemetryEventInput[] }))

vi.mock('@server/telemetry', () => ({
  reportTelemetryEvent: (event: TelemetryEventInput) => {
    reported.push(event)
  },
}))

let temporaryDirectory: string
let secretStore: SecretStore

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-provider-transfer-'))
  await initDatabases(temporaryDirectory)
  reported.length = 0
  secretStore = {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  }
  configureSecretStore(secretStore)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function responseData<T>(response: ServerResponse): T {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return (JSON.parse(String(body)) as { data: T }).data
}

/**
 * 断言一个 promise 以指定的 `AppError` 失败。
 *
 * 路由处理器不吞异常（错误归一化在外层 `handleApiRequest`），所以这里直接读异常本身，
 * 比只看一句 message 更能保证错误码与提示语都没跑偏。
 */
async function expectAppError(run: () => Promise<unknown>, code: string, messagePart: string): Promise<void> {
  const error = await run().then(() => undefined, (value: unknown) => value)
  const normalized = normalizeError(error)
  expect(normalized.code).toBe(code)
  expect(normalized.message).toContain(messagePart)
}

function sortEndpoints<T extends { protocol: string }>(endpoints: T[]): T[] {
  return [...endpoints].sort((left, right) => left.protocol.localeCompare(right.protocol))
}

/** 导出顺序依赖 `createdTime` 毫秒值，同毫秒创建的记录顺序不稳定，断言前先按业务键排序。 */
function sortProvider(provider: ProviderBundleProvider): ProviderBundleProvider {
  return {
    ...provider,
    endpoints: sortEndpoints(provider.endpoints),
    settings: [...provider.settings].sort((left, right) => left.key.localeCompare(right.key)),
    models: [...provider.models]
      .sort((left, right) => left.modelName.localeCompare(right.modelName))
      .map(model => ({ ...model, endpoints: sortEndpoints(model.endpoints) })),
  }
}

function bundleWith(providers: ProviderBundleProvider[]): ProviderBundle {
  return { format: PROVIDER_BUNDLE_FORMAT, version: PROVIDER_BUNDLE_VERSION, exportedAt: Date.now(), providers }
}

function minimalProvider(name: string): ProviderBundleProvider {
  return { name, description: '', enabled: true, timeoutMilliseconds: 30_000, endpoints: [], settings: [], models: [] }
}

/** 一个「打开转换的协议」必须真的可转换，否则 store 不会写入转换器，导出时又被读回 false。 */
async function seedProvider(): Promise<string> {
  const provider = await createProvider({
    name: 'OpenAI 中转',
    description: '主用供应商',
    apiKeyReference: API_KEY_REFERENCE,
    timeoutMilliseconds: 45_000,
    enabled: true,
  })
  await replaceProviderEndpointStates(provider.id, [
    { protocol: 'openai-completions', url: 'https://api.example.com/v1', enabled: true },
    { protocol: 'openai-responses', url: 'https://api.example.com/responses', enabled: true },
    { protocol: 'anthropic-messages', url: 'https://api.example.com/anthropic', enabled: false },
  ])
  await upsertProviderSetting({ providerId: provider.id, key: 'region', value: 'us-east', valueType: 'string' })
  await createProviderModelRoute({
    providerId: provider.id,
    modelName: 'gpt-5',
    priority: 0,
    enabled: true,
    endpoints: [
      { protocol: 'openai-completions', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: true },
      { protocol: 'openai-responses', endpointUrl: 'https://api.example.com/responses/fast', customAuthHeader: null, protocolConversionEnabled: false },
    ],
  })
  await createProviderModelRoute({
    providerId: provider.id,
    modelName: 'gpt-5-mini',
    priority: 1,
    enabled: false,
    endpoints: [],
  })
  return provider.id
}

function expectedSeededProvider(): ProviderBundleProvider {
  return {
    name: 'OpenAI 中转',
    description: '主用供应商',
    enabled: true,
    timeoutMilliseconds: 45_000,
    apiKey: 'sk-secret',
    endpoints: [
      { protocol: 'anthropic-messages', url: 'https://api.example.com/anthropic', enabled: false },
      { protocol: 'openai-completions', url: 'https://api.example.com/v1', enabled: true },
      { protocol: 'openai-responses', url: 'https://api.example.com/responses', enabled: true },
    ],
    settings: [{ key: 'region', value: 'us-east', valueType: 'string' }],
    models: [
      {
        modelName: 'gpt-5',
        enabled: true,
        endpoints: [
          { protocol: 'openai-completions', url: null, enabled: true, protocolConversionEnabled: true },
          { protocol: 'openai-responses', url: 'https://api.example.com/responses/fast', enabled: true, protocolConversionEnabled: false },
        ],
      },
      { modelName: 'gpt-5-mini', enabled: false, endpoints: [] },
    ],
  }
}

describe('provider bundle export', () => {
  it('exports the whole provider state and leaves out store-managed settings', async () => {
    const providerId = await seedProvider()
    vi.mocked(secretStore.get).mockResolvedValue('sk-secret')
    const response = mockResponse()

    await providerRoutes.invoke('/api/provider/export', response, { providerIds: [providerId], includeApiKeys: true })
    const { bundle } = responseData<{ bundle: ProviderBundle; content: string }>(response)

    expect(bundle.format).toBe(PROVIDER_BUNDLE_FORMAT)
    expect(bundle.version).toBe(PROVIDER_BUNDLE_VERSION)
    expect(bundle.exportedAt).toBeGreaterThan(0)
    expect(bundle.providers.map(sortProvider)).toEqual([sortProvider(expectedSeededProvider())])
    expect(secretStore.get).toHaveBeenCalledWith(API_KEY_REFERENCE)
  })

  it('omits the plaintext API key unless the caller asks for it', async () => {
    await seedProvider()
    vi.mocked(secretStore.get).mockResolvedValue('sk-secret')

    const { bundle } = await exportProviderBundle({})

    expect(bundle.providers[0]).not.toHaveProperty('apiKey')
    expect(secretStore.get).not.toHaveBeenCalled()
  })

  it('serializes the bundle as indented JSON for the downloaded file', async () => {
    const providerId = await seedProvider()

    const { bundle, content } = await exportProviderBundle({ providerIds: [providerId] })

    expect(content).toContain('\n  "format"')
    expect(JSON.parse(content)).toEqual(bundle)
  })

  it('fails instead of silently exporting a subset when a provider id is unknown', async () => {
    await seedProvider()

    await expectAppError(() => exportProviderBundle({ providerIds: ['prov_missing'] }), 'RESOURCE_NOT_FOUND', 'Provider not found: prov_missing')
  })
})

describe('provider bundle import', () => {
  it('restores a wiped provider from its own bundle', async () => {
    const providerId = await seedProvider()
    vi.mocked(secretStore.get).mockResolvedValue('sk-secret')
    const exported = await exportProviderBundle({ providerIds: [providerId], includeApiKeys: true })

    await deleteProvider(providerId)

    const response = mockResponse()
    await providerRoutes.invoke('/api/provider/import', response, { bundle: exported.bundle })

    expect(responseData<{ imported: unknown }>(response).imported).toEqual({ providers: 1, models: 2 })
    const [restored] = await listProviders(false)
    expect(restored).toMatchObject({ name: 'OpenAI 中转', description: '主用供应商', timeoutMilliseconds: 45_000, enabled: true })
    // 本机密钥库的引用属于源环境，导入必须重新生成，否则两台机器会指向同一个不存在的引用。
    expect(restored?.apiKeyReference).not.toBe(API_KEY_REFERENCE)
    expect(secretStore.set).toHaveBeenCalledWith(expect.stringMatching(/^key_/), 'sk-secret')
    expect(await listSchedulingPolicies('default')).toHaveLength(2)

    const reExported = await exportProviderBundle({ includeApiKeys: true })
    expect(reExported.bundle.providers.map(sortProvider)).toEqual(exported.bundle.providers.map(sortProvider))
  })

  it('overwrites a same-named provider instead of merging into it', async () => {
    const providerId = await seedProvider()

    await importProviderBundle({
      bundle: bundleWith([
        {
          name: 'OpenAI 中转',
          description: '覆盖后的描述',
          enabled: false,
          timeoutMilliseconds: 12_000,
          endpoints: [{ protocol: 'openai-completions', url: 'https://api.example.com/v2', enabled: true }],
          settings: [{ key: 'tier', value: 'pro', valueType: 'string' }],
          models: [
            {
              modelName: 'gpt-5',
              enabled: true,
              endpoints: [{ protocol: 'openai-completions', url: null, enabled: true, protocolConversionEnabled: false }],
            },
          ],
        },
      ]),
    })

    expect(await listProviders(false)).toHaveLength(1)
    const [provider] = await listProviders(false)
    expect(provider).toMatchObject({ name: 'OpenAI 中转', description: '覆盖后的描述', enabled: false, timeoutMilliseconds: 12_000 })
    // 包里没有密钥时沿用本地密钥，连引用都不该被换掉。
    expect(provider?.apiKeyReference).toBe(API_KEY_REFERENCE)
    expect(secretStore.set).not.toHaveBeenCalled()

    // 包里没提到的端点行保留下来但被停用：地址是用户填过的可见状态，不是缓存。
    expect((await listProviderEndpoints(providerId)).map(({ protocol, url, enabled }) => ({ protocol, url, enabled }))).toEqual([
      { protocol: 'anthropic-messages', url: 'https://api.example.com/anthropic', enabled: false },
      { protocol: 'openai-completions', url: 'https://api.example.com/v2', enabled: true },
      { protocol: 'openai-responses', url: 'https://api.example.com/responses', enabled: false },
    ])

    const settings = await listProviderSettings(providerId)
    expect(settings.map(setting => setting.key)).toEqual(['connection.timeoutMilliseconds', 'security.secretReference', 'tier'])
    expect(settings.find(setting => setting.key === 'security.secretReference')?.value).toBe(API_KEY_REFERENCE)
    expect(settings.find(setting => setting.key === 'connection.timeoutMilliseconds')?.value).toBe('12000')

    const models = await listProviderModels(false)
    expect(models.map(model => model.modelName)).toEqual(['gpt-5'])
    expect(models[0]?.endpoints.map(endpoint => endpoint.protocol)).toEqual(['openai-completions'])
  })

  it('creates a missing provider and binds its models to the default logical model', async () => {
    const bundle = bundleWith([
      {
        name: 'Anthropic 直连',
        description: '',
        enabled: true,
        timeoutMilliseconds: 30_000,
        apiKey: 'sk-anthropic',
        endpoints: [{ protocol: 'anthropic-messages', url: 'https://api.anthropic.com', enabled: true }],
        settings: [],
        models: [
          { modelName: 'claude-sonnet-4', enabled: true, endpoints: [{ protocol: 'anthropic-messages', url: null, enabled: true, protocolConversionEnabled: true }] },
        ],
      },
    ])

    expect((await importProviderBundle({ bundle })).imported).toEqual({ providers: 1, models: 1 })
    expect(secretStore.set).toHaveBeenCalledWith(expect.stringMatching(/^key_/), 'sk-anthropic')
    // 新建的供应商算一条，它的模型按端点逐条算——与手工新建同一个口径。
    expect(reported).toEqual([
      { name: 'provider_created', kind: 'custom' },
      { name: 'model_created', protocol: 'anthropic-messages' },
    ])

    const [model] = await listProviderModels(false)
    expect(await listSchedulingPolicies('default')).toEqual([
      expect.objectContaining({ logicalModelId: 'default', providerModelId: model?.id }),
    ])

    // 再导入一次是覆盖而不是追加：同名供应商复用，同名模型复用，调度位置也不被重排。
    expect((await importProviderBundle({ bundle })).imported).toEqual({ providers: 1, models: 1 })
    expect(await listProviders(false)).toHaveLength(1)
    expect((await listProviderModels(false)).map(item => item.modelName)).toEqual(['claude-sonnet-4'])
    expect(await listSchedulingPolicies('default')).toHaveLength(1)
    expect(secretStore.set).toHaveBeenCalledTimes(2)
    // 这一遍什么也没新建，所以埋点不该再长：按名覆盖不是创建。
    expect(reported).toHaveLength(2)
  })

  it('rejects payloads that are not provider bundles', async () => {
    await expectAppError(
      () => providerRoutes.invoke('/api/provider/import', mockResponse(), { foo: 1 }),
      'VALIDATION_ERROR',
      'Not a recognizable provider export file',
    )
  })

  it('rejects bundles written by another bundle version', async () => {
    await expectAppError(
      () => importProviderBundle({ bundle: { ...bundleWith([minimalProvider('OpenAI 中转')]), version: 2 } }),
      'VALIDATION_ERROR',
      'Not a recognizable provider export file',
    )
  })

  it('rejects an empty provider list', async () => {
    await expectAppError(
      () => importProviderBundle({ bundle: bundleWith([]) }),
      'VALIDATION_ERROR',
      'Not a recognizable provider export file',
    )
  })

  it('rejects duplicate provider names inside one bundle', async () => {
    await expectAppError(
      () => importProviderBundle({ bundle: bundleWith([minimalProvider('OpenAI 中转'), minimalProvider('OpenAI 中转')]) }),
      'DUPLICATE_RESOURCE',
      'Duplicate provider in the export file: OpenAI 中转',
    )
  })
})
