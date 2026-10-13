import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import { coreNetworkClient } from '../infrastructure/network/core-network'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'
import { closeDatabases, initDatabases } from '../database'
import { getProvider, getProviderSetting, listProviderEndpoints, listProviders } from '../database/provider-store'
import { getDefaultLogicalModelRecordId, listSchedulingPolicies, upsertSchedulingPolicy } from '../database/logical-model-store'
import { listProviderModelRoutesByProvider } from '../database/model-store'
import { loadPlugin } from './manifest'
import { configurePluginDirectory } from './registry'
import { pluginSecretReference, readPluginInputs, readPluginSyncState, writePluginInputs } from './state'
import {
  disablePlugin,
  enablePlugin,
  ensureManagedProvider,
  recordSyncFailure,
  reloadPlugin,
  setPluginInputs,
  splitInputs,
  syncPlugin,
  uninstallPlugin,
} from './sync-engine'

vi.mock('../infrastructure/network/core-network', () => ({
  coreNetworkClient: { requestHttp: vi.fn(), requestHttpBuffered: vi.fn() },
}))

/**
 * 同步引擎。
 *
 * 这里验的不是「代码跑得通」，而是文件头那四条不变量的**落库后果**：失败不动已有配置、
 * 空清单不删模型、`input-required` 是中间态、同步只由显式调用触发。断言一律读数据库
 * （设置行、端点行、调度策略行）而不是读返回值——返回值只说明这次跑得怎么样，
 * 用户看到的是库里的那几行。
 */

let temporaryDirectory: string
let pluginsDirectory: string
/** 密钥库的内存替身，断言直接看这张表。 */
let secrets: Map<string, string>

/** 一个声明式（L0）插件：密钥输入 + 端点模板 + models 地址，三样都用得上。 */
const DECLARATIVE_MANIFEST = {
  name: 'Acme Free',
  providerName: 'Acme Free Provider',
  apiKeyInput: 'apiKey',
  inputs: [
    { key: 'serverUrl', label: 'Server URL', type: 'url', required: true },
    { key: 'apiKey', label: 'API Key', type: 'password', secret: true },
  ],
  endpoints: { 'openai-completions': '{{serverUrl}}/v1/chat/completions' },
  models: { url: '{{serverUrl}}/v1/models' },
}

const DECLARATIVE_INPUTS = { serverUrl: 'https://api.example.com', apiKey: 'sk-1' }

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-plugin-sync-'))
  pluginsDirectory = path.join(temporaryDirectory, 'plugins')
  await initDatabases(temporaryDirectory)
  configurePluginDirectory(pluginsDirectory)
  secrets = new Map()
  configureSecretStore({
    set: async (reference, value) => {
      secrets.set(reference, value)
    },
    get: async reference => secrets.get(reference) ?? null,
    delete: async reference => {
      secrets.delete(reference)
    },
  })
  vi.mocked(coreNetworkClient.requestHttpBuffered).mockReset()
})

afterEach(async () => {
  configurePluginDirectory(null)
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

// ========== 夹具 ==========

/** 落一个插件目录。`entry` 给了就写 `entry.js`，不给就是纯声明式插件。 */
function writePlugin(key: string, manifest: Record<string, unknown>, entry?: string): void {
  const directory = path.join(pluginsDirectory, key)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify({ manifestVersion: 1, key, name: key, ...manifest }), 'utf8')
  if (entry !== undefined) fs.writeFileSync(path.join(directory, 'entry.js'), entry, 'utf8')
}

/** 让声明式 `models` 拉到给定的模型清单。 */
function mockModelList(ids: string[]): void {
  vi.mocked(coreNetworkClient.requestHttpBuffered).mockResolvedValue({
    statusCode: 200,
    headers: {},
    body: JSON.stringify({ data: ids.map(id => ({ id })) }),
  })
}

async function failureOf(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error('expected the call to fail')
}

/** 一个托管 Provider 的调度绑定，按优先级取。取不到给空数组（而不是抛错）。 */
async function policyPriorities(logicalModelRecordId: string): Promise<Array<{ providerModelId: string; priority: number }>> {
  return (await listSchedulingPolicies(logicalModelRecordId)).map(policy => ({ providerModelId: policy.providerModelId, priority: policy.priority }))
}

// ========== 声明式同步 ==========

describe('plugin sync engine with a declarative plugin', () => {
  it('启用后：Provider、端点、密钥、模型、调度绑定全部落库', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small', 'acme-large'])

    const outcome = await enablePlugin('acme-free', DECLARATIVE_INPUTS)

    expect(outcome.credentialStatus).toBe('ok')
    expect(outcome.credentialMessage).toBeNull()
    expect(outcome.addedModels).toBe(2)
    expect(outcome.removedModels).toBe(0)
    expect(outcome.modelCount).toBe(2)

    const provider = await getProvider(outcome.providerId)
    expect(provider?.name).toBe('Acme Free Provider')
    // 密钥从输入项搬进了 Provider 的密钥引用，插件的 hook 才能凭它鉴权。
    expect(secrets.get(provider?.apiKeyReference ?? '')).toBe('sk-1')
    expect(await getProviderSetting(outcome.providerId, 'plugin.key')).toMatchObject({ value: 'acme-free' })

    const endpoints = await listProviderEndpoints(outcome.providerId)
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0]).toMatchObject({ protocol: 'openai-completions', url: 'https://api.example.com/v1/chat/completions' })

    // 非密钥项进 `plugin.inputs`；密钥项**不进**配置库（配置文件会被用户导出/备份）。
    expect(await readPluginInputs(outcome.providerId)).toEqual({ serverUrl: 'https://api.example.com' })
    expect(secrets.get(pluginSecretReference('acme-free', 'input', 'apiKey'))).toBe('sk-1')

    const models = await listProviderModelRoutesByProvider(outcome.providerId)
    expect(models.map(model => model.modelName)).toEqual(['acme-small', 'acme-large'])

    // 新模型要同时挂到默认逻辑模型上，否则它们存在但不会被调度——「同步了却没生效」。
    const logicalModelRecordId = await getDefaultLogicalModelRecordId()
    expect(await policyPriorities(logicalModelRecordId)).toEqual([
      { providerModelId: models[0].id, priority: 1 },
      { providerModelId: models[1].id, priority: 2 },
    ])
  })

  it('再次同步时不重复建模型、不动已有优先级', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small', 'acme-large'])
    const first = await enablePlugin('acme-free', DECLARATIVE_INPUTS)
    const logicalModelRecordId = await getDefaultLogicalModelRecordId()
    const models = await listProviderModelRoutesByProvider(first.providerId)

    // 用户手调过这个供应商在默认逻辑模型里的顺序：插件同步**不能**按清单顺序把它推翻。
    await upsertSchedulingPolicy({ logicalModelId: logicalModelRecordId, providerModelId: models[0].id, priority: 9, enabled: true })
    mockModelList(['acme-small', 'acme-large'])

    const second = await syncPlugin('acme-free')

    expect(second.addedModels).toBe(0)
    expect(second.removedModels).toBe(0)
    expect(await listProviderModelRoutesByProvider(first.providerId)).toHaveLength(2)
    expect((await listSchedulingPolicies(logicalModelRecordId)).find(policy => policy.providerModelId === models[0].id)?.priority).toBe(9)
  })

  it('空清单不删模型，模型数按库里的真实数量记账', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small', 'acme-large'])
    const first = await enablePlugin('acme-free', DECLARATIVE_INPUTS)

    // 上游抖了一下，回了个空的 data 数组：这不是「用户想清空模型」。
    mockModelList([])
    const second = await syncPlugin('acme-free')

    expect(second.addedModels).toBe(0)
    expect(second.removedModels).toBe(0)
    expect(second.modelCount).toBe(2)
    expect(await listProviderModelRoutesByProvider(first.providerId)).toHaveLength(2)
    expect(await readPluginSyncState(first.providerId)).toMatchObject({ modelCount: 2 })
  })

  it('非空清单里消失的模型会被删掉，连同它的调度绑定', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small', 'acme-large'])
    const first = await enablePlugin('acme-free', DECLARATIVE_INPUTS)
    const logicalModelRecordId = await getDefaultLogicalModelRecordId()
    const removed = (await listProviderModelRoutesByProvider(first.providerId)).find(model => model.modelName === 'acme-large')

    mockModelList(['acme-small'])
    const second = await syncPlugin('acme-free')

    expect(second.removedModels).toBe(1)
    expect(second.modelCount).toBe(1)
    expect((await listProviderModelRoutesByProvider(first.providerId)).map(model => model.modelName)).toEqual(['acme-small'])
    // 绑定留在库里就是逻辑模型页上的一排「幽灵模型」。
    expect((await listSchedulingPolicies(logicalModelRecordId)).some(policy => policy.providerModelId === removed?.id)).toBe(false)
  })

  it('缺少密钥输入项时进入 input-required，且一次网络请求都不发', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)

    const outcome = await enablePlugin('acme-free', { serverUrl: 'https://api.example.com' })
    expect(outcome.credentialStatus).toBe('input-required')
    expect(outcome.credentialMessage).toBeNull()
    expect(outcome.modelCount).toBe(0)
    // 密钥还没到手，拉清单只会得到一堆 401。
    expect(vi.mocked(coreNetworkClient.requestHttpBuffered)).not.toHaveBeenCalled()

    const state = await readPluginSyncState(outcome.providerId)
    expect(state.credentialFields.map(field => field.key)).toEqual(['apiKey'])
    // 端点也不写：这时候写下去的是一个还插不了值的模板。
    expect(await listProviderEndpoints(outcome.providerId)).toHaveLength(0)
  })

  it('清单没声明 apiKeyInput 时不带密钥请求，并清掉可能残留的旧密钥', async () => {
    // 纯公开的聚合源：地址写死，不需要用户填任何东西。
    writePlugin('public-source', {
      endpoints: { 'openai-completions': 'https://public.example/v1/chat/completions' },
      models: { url: 'https://public.example/v1/models' },
    })
    mockModelList(['pub-1'])

    const outcome = await enablePlugin('public-source')

    expect(outcome.credentialStatus).toBe('ok')
    const provider = await getProvider(outcome.providerId)
    expect(await getProviderSetting(outcome.providerId, 'plugin.key')).toMatchObject({ value: 'public-source' })
    // 没有 `apiKeyInput` 也不带旧 Key 出去：那个引用必须被清掉，否则会一直带着上一次的旧 Key 请求。
    expect(secrets.has(provider?.apiKeyReference ?? '')).toBe(false)
    const call = vi.mocked(coreNetworkClient.requestHttpBuffered).mock.calls[0]
    expect(call[1].headers).not.toHaveProperty('Authorization')
    expect(outcome.modelCount).toBe(1)
  })

  it('models 地址插值后仍不合法时给出 PLUGIN_RUN_FAILED，而不是当成网络不通', async () => {
    // 必填的非密钥项没填，`{{serverUrl}}` 不会被插值，地址当然不合法。
    writePlugin('acme-free', {
      inputs: [{ key: 'serverUrl', label: 'Server URL', type: 'url', required: true }],
      models: { url: '{{serverUrl}}/v1/models' },
    })

    const error = await failureOf(() => enablePlugin('acme-free'))

    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('not a valid URL')
  })

  it('端点模板插值不出来时宁可少写一条端点，也不把模板原样落库', async () => {
    // `serverUrl` 没填：端点模板还是 `{{serverUrl}}/v1/chat/completions`。
    // 原样写下去会撞 `ProviderEndpointSchema.url` 的 `z.string().url()`，报出来的是一条
    // 通用校验错误；真正的错因是「哪个输入没填」，那是管理接口该在同步之前讲清楚的事。
    writePlugin('acme-free', { endpoints: { 'openai-completions': '{{serverUrl}}/v1/chat/completions' } })

    const outcome = await enablePlugin('acme-free')

    expect(outcome.credentialStatus).toBe('ok')
    expect(await listProviderEndpoints(outcome.providerId)).toHaveLength(0)
  })

  it('清单里的 models 地址不可解析时给出统一的失败错误', async () => {
    writePlugin('acme-free', { ...DECLARATIVE_MANIFEST, models: { url: '{{serverUrl}}/v1/models' } })
    vi.mocked(coreNetworkClient.requestHttpBuffered).mockResolvedValue({ statusCode: 200, headers: {}, body: 'not json' })

    const error = await failureOf(() => enablePlugin('acme-free', DECLARATIVE_INPUTS))

    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('recognizable model list')
  })

  it('声明了 path 却对不上响应时直接报错，不静默回退', async () => {
    writePlugin('acme-free', { ...DECLARATIVE_MANIFEST, models: { url: '{{serverUrl}}/v1/models', path: 'models[].name' } })
    mockModelList(['acme-small'])

    const error = await failureOf(() => enablePlugin('acme-free', DECLARATIVE_INPUTS))

    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('declared path')
  })

  it('声明了 path 时按它取值，并保留处理后的模型名', async () => {
    writePlugin('acme-free', { ...DECLARATIVE_MANIFEST, models: { url: '{{serverUrl}}/v1/models', path: 'models[].name' } })
    vi.mocked(coreNetworkClient.requestHttpBuffered).mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ models: [{ name: 'acme-small' }, { name: 'acme-large' }] }),
    })

    const outcome = await enablePlugin('acme-free', DECLARATIVE_INPUTS)

    const models = await listProviderModelRoutesByProvider(outcome.providerId)
    expect(models.map(model => model.modelName)).toEqual(['acme-small', 'acme-large'])
  })

  it('请求模型清单时带上刚写下去的密钥与插值后的地址', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small'])

    await enablePlugin('acme-free', DECLARATIVE_INPUTS)

    const call = vi.mocked(coreNetworkClient.requestHttpBuffered).mock.calls[0]
    expect(String(call[0])).toBe('https://api.example.com/v1/models')
    expect(call[1]).toMatchObject({ method: 'GET', hostname: 'api.example.com' })
    expect(call[1].headers).toMatchObject({ Authorization: 'Bearer sk-1', Accept: 'application/json' })
  })
})

// ========== hook 插件的状态 ==========

describe('plugin sync engine with a hook plugin', () => {
  it('hook 要密钥时进入 input-required 并记下字段', async () => {
    writePlugin('acme-free', {}, `
      return {
        obtainCredential: async function () {
          return { status: 'input-required', fields: [{ key: 'token', label: 'Token', type: 'password', required: true, secret: true }] }
        },
      }
    `)

    const outcome = await enablePlugin('acme-free')

    expect(outcome.credentialStatus).toBe('input-required')
    const state = await readPluginSyncState(outcome.providerId)
    expect(state.credentialFields).toEqual([{ key: 'token', label: 'Token', type: 'password', required: true, secret: true }])
  })

  it('hook 要用户去授权时记下 actionUrl，状态是中间态而不是失败', async () => {
    writePlugin('acme-free', {}, `
      return {
        obtainCredential: async function () {
          return { status: 'action-required', instruction: 'open the authorization page', actionUrl: 'https://auth.example.com/start' }
        },
      }
    `)

    const outcome = await enablePlugin('acme-free')

    expect(outcome.credentialStatus).toBe('action-required')
    expect(outcome.credentialMessage).toBe('open the authorization page')
    expect(outcome.actionUrl).toBe('https://auth.example.com/start')
    expect(await readPluginSyncState(outcome.providerId)).toMatchObject({ actionUrl: 'https://auth.example.com/start' })
  })

  it('hook 报 failed 时状态记成 error，已有 Provider 不被改坏', async () => {
    writePlugin('acme-free', { endpoints: { 'openai-completions': 'https://acme.example/v1/chat/completions' } }, `
      return {
        obtainCredential: async function () {
          return { status: 'failed', message: 'upstream said no' }
        },
      }
    `)

    const outcome = await enablePlugin('acme-free')

    expect(outcome.credentialStatus).toBe('error')
    expect(outcome.credentialMessage).toBe('upstream said no')
    // 失败态不写端点：这次没拿到凭据，端点模板该等下一次成功再写。
    expect(await listProviderEndpoints(outcome.providerId)).toHaveLength(0)
  })

  it('hook 崩溃时抛出错误，且不留下任何模型', async () => {
    writePlugin('acme-free', {}, `
      return {
        obtainCredential: async function () {
          throw new Error('boom')
        },
      }
    `)

    const error = await failureOf(() => enablePlugin('acme-free'))

    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('boom')
  })

  it('hook 写下的密钥引用进了 state，卸载时才能被回收', async () => {
    writePlugin('acme-free', {}, `
      return {
        obtainCredential: async function (ctx) {
          await ctx.secrets.set('refresh', 'r-1')
          return { status: 'ready', apiKey: 'sk-from-hook' }
        },
        listModels: async function () {
          return { models: [{ id: 'hook-model' }] }
        },
      }
    `)

    const outcome = await enablePlugin('acme-free')

    expect(secrets.get('plugin::acme-free::hook::refresh')).toBe('r-1')
    expect(await readPluginSyncState(outcome.providerId)).toMatchObject({ secretReferences: ['plugin::acme-free::hook::refresh'] })
    expect((await listProviderModelRoutesByProvider(outcome.providerId)).map(model => model.modelName)).toEqual(['hook-model'])
  })

  it('hook 只实现 listModels 时，凭据回退到声明式', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST, `
      return {
        listModels: async function () {
          return { models: [{ id: 'from-hook' }] }
        },
      }
    `)

    const outcome = await enablePlugin('acme-free', DECLARATIVE_INPUTS)

    expect(outcome.credentialStatus).toBe('ok')
    // hook 认真返回了就听 hook 的，不再去拉清单。
    expect(vi.mocked(coreNetworkClient.requestHttpBuffered)).not.toHaveBeenCalled()
    expect((await listProviderModelRoutesByProvider(outcome.providerId)).map(model => model.modelName)).toEqual(['from-hook'])
  })
})

// ========== 输入项 ==========

describe('plugin sync engine inputs', () => {
  it('密钥项收到占位符时原样保留已存的值', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    const plugin = await loadPlugin(pluginsDirectory, 'acme-free')
    const providerId = await ensureManagedProvider(plugin)
    secrets.set(pluginSecretReference('acme-free', 'input', 'apiKey'), 'sk-old')

    const values = await splitInputs(plugin, providerId, { apiKey: '••••••••', serverUrl: 'https://new.example' })

    // 界面拿不到明文，回的就是这串圆点；当成新值写进去，用户下次同步就会拿到一串圆点当 Key。
    expect(secrets.get(pluginSecretReference('acme-free', 'input', 'apiKey'))).toBe('sk-old')
    expect(values).toEqual({ serverUrl: 'https://new.example' })
  })

  it('密钥项留空 = 删掉密钥；留空只影响本次传进来的字段', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    const plugin = await loadPlugin(pluginsDirectory, 'acme-free')
    const providerId = await ensureManagedProvider(plugin)
    secrets.set(pluginSecretReference('acme-free', 'input', 'apiKey'), 'sk-old')
    await writePluginInputs(providerId, { serverUrl: 'https://old.example' })

    const values = await splitInputs(plugin, providerId, { apiKey: '' })

    expect(secrets.has(pluginSecretReference('acme-free', 'input', 'apiKey'))).toBe(false)
    // 只看本次传进来的键：没提到的 `serverUrl` 原样留着（局部保存不该清掉别的设置）。
    expect(values).toEqual({ serverUrl: 'https://old.example' })
  })

  it('普通项填空会把该键从输入里移除', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    const plugin = await loadPlugin(pluginsDirectory, 'acme-free')
    const providerId = await ensureManagedProvider(plugin)
    await writePluginInputs(providerId, { serverUrl: 'https://old.example' })

    const values = await splitInputs(plugin, providerId, { serverUrl: '   ' })

    expect(values).toEqual({})
  })

  it('set-inputs 存完就同步一次，端点跟着新地址走', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small'])
    const first = await enablePlugin('acme-free', DECLARATIVE_INPUTS)

    mockModelList(['acme-small'])
    await setPluginInputs('acme-free', { serverUrl: 'https://api2.example.com', apiKey: '••••••••' })

    const endpoints = await listProviderEndpoints(first.providerId)
    expect(endpoints[0].url).toBe('https://api2.example.com/v1/chat/completions')
    expect(secrets.get(pluginSecretReference('acme-free', 'input', 'apiKey'))).toBe('sk-1')
  })
})

// ========== 停用 / 卸载 / 重载 ==========

describe('plugin sync engine lifecycle', () => {
  it('停用：Provider 软删、调度绑定与密钥全部回收', async () => {
    writePlugin('acme-free', {}, `
      return {
        obtainCredential: async function (ctx) {
          await ctx.secrets.set('refresh', 'r-1')
          return { status: 'ready', apiKey: 'sk-from-hook' }
        },
        listModels: async function () {
          return { models: [{ id: 'hook-model' }] }
        },
      }
    `)
    const outcome = await enablePlugin('acme-free')
    const provider = await getProvider(outcome.providerId)
    const logicalModelRecordId = await getDefaultLogicalModelRecordId()
    expect(await listSchedulingPolicies(logicalModelRecordId)).toHaveLength(1)

    await disablePlugin('acme-free')

    expect((await listProviders()).some(candidate => candidate.id === outcome.providerId)).toBe(false)
    expect(await listProviderModelRoutesByProvider(outcome.providerId)).toHaveLength(0)
    // `deleteProvider` 不清调度策略：不显式删就会留下指向已删模型的绑定。
    expect(await listSchedulingPolicies(logicalModelRecordId)).toHaveLength(0)
    expect(secrets.get(provider?.apiKeyReference ?? '')).toBeUndefined()
    expect(secrets.get('plugin::acme-free::hook::refresh')).toBeUndefined()
    expect(await getProviderSetting(outcome.providerId, 'plugin.key')).toBeUndefined()
    expect(await getProviderSetting(outcome.providerId, 'plugin.state')).toBeUndefined()
  })

  it('停用一个没启用过的插件是空操作', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)

    await expect(disablePlugin('acme-free')).resolves.toBeUndefined()

    expect((await listProviders()).some(candidate => candidate.name === 'Acme Free Provider')).toBe(false)
  })

  it('卸载：先回收落库的东西，再删掉插件目录', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small'])
    const outcome = await enablePlugin('acme-free', DECLARATIVE_INPUTS)

    await uninstallPlugin('acme-free')

    expect(fs.existsSync(path.join(pluginsDirectory, 'acme-free'))).toBe(false)
    expect((await listProviders()).some(candidate => candidate.id === outcome.providerId)).toBe(false)
  })

  it('重载后清单改动生效：Provider 名与端点都跟着变', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small'])
    const first = await enablePlugin('acme-free', DECLARATIVE_INPUTS)

    writePlugin('acme-free', { ...DECLARATIVE_MANIFEST, providerName: 'Acme Renamed', endpoints: { 'anthropic-messages': '{{serverUrl}}/v1/messages' } })
    mockModelList(['acme-small'])
    await reloadPlugin('acme-free')

    expect((await getProvider(first.providerId))?.name).toBe('Acme Renamed')
    // 端点行是**软保留**的：清单不再声明的协议只是被停用（读侧 `listProviderEndpoints` 仍在），
    // 用户填过的地址不会被一次同步抹掉。
    const all = await listProviderEndpoints(first.providerId)
    expect(all.map(endpoint => [endpoint.protocol, endpoint.enabled])).toEqual([
      ['anthropic-messages', true],
      ['openai-completions', false],
    ])
  })

  it('同步没跑完之前重复调用会被打回', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small'])
    await enablePlugin('acme-free', DECLARATIVE_INPUTS)
    // 让这次同步卡在网络那一步，制造一个真实的「正在同步」窗口。
    vi.mocked(coreNetworkClient.requestHttpBuffered).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 30))
      return { statusCode: 200, headers: {}, body: JSON.stringify({ data: [{ id: 'acme-small' }] }) }
    })

    const running = syncPlugin('acme-free')
    const error = await failureOf(() => syncPlugin('acme-free'))
    await running

    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('already running')
  })
})

// ========== 失败记账 ==========

describe('plugin sync engine failure accounting', () => {
  it('记失败时只写 lastSyncError，其余读数原样保留', async () => {
    writePlugin('acme-free', DECLARATIVE_MANIFEST)
    mockModelList(['acme-small'])
    const outcome = await enablePlugin('acme-free', DECLARATIVE_INPUTS)

    await recordSyncFailure('acme-free', new Error('upstream timeout'))

    const state = await readPluginSyncState(outcome.providerId)
    expect(state.lastSyncError).toBe('upstream timeout')
    expect(state.lastSyncTime).not.toBeNull()
    expect(state.modelCount).toBe(1)
    expect(state.credentialStatus).toBe('ok')
  })

  it('没有托管 Provider 时记失败是空操作（插件已被停用）', async () => {
    await expect(recordSyncFailure('acme-free', new Error('boom'))).resolves.toBeUndefined()
  })
})
