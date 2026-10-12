import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeError } from '../errors'
import { coreNetworkClient } from '../infrastructure/network/core-network'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'
import { closeDatabases, initDatabases } from '../database'
import { getProvider } from '../database/provider-store'
import { listProviderModelRoutesByProvider } from '../database/model-store'
import { configurePluginDirectory } from '../plugins/registry'
import { pluginSecretReference, readPluginSyncState } from '../plugins/state'
import { SECRET_PLACEHOLDER, pluginRoutes } from './routes/operations/plugins'

vi.mock('../infrastructure/network/core-network', () => ({
  coreNetworkClient: { requestHttp: vi.fn(), requestHttpBuffered: vi.fn() },
}))

/**
 * 插件管理接口。
 *
 * 这里验的是「界面拿到的东西」：`buildView` 把清单、托管 Provider、同步状态拼成一份
 * `PluginView`，而拼错的方式都很安静（少一个字段、把明文密钥回给前端、一个坏目录让整页失败），
 * 所以断言一律看路由的响应体，不看中间函数。
 */

let temporaryDirectory: string
let pluginsDirectory: string
let secrets: Map<string, string>

const MANIFEST = {
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

const INPUTS = { serverUrl: 'https://api.example.com', apiKey: 'sk-1' }

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-plugin-routes-'))
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
  vi.mocked(coreNetworkClient.requestHttpBuffered).mockResolvedValue({
    statusCode: 200,
    headers: {},
    body: JSON.stringify({ data: [{ id: 'acme-1' }] }),
  })
})

afterEach(async () => {
  configurePluginDirectory(null)
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function writePlugin(key: string, manifest: Record<string, unknown> = {}, entry?: string): void {
  const directory = path.join(pluginsDirectory, key)
  fs.mkdirSync(directory, { recursive: true })
  // 默认值先落、`MANIFEST` 与调用方给的字段后覆盖。这里用 `Object.assign` 而不是展开写法：
  // 展开时 `name` 在同一个字面量里出现两次（默认值 + `MANIFEST`），TS 会报「前面那次会被覆盖」。
  const document: Record<string, unknown> = { manifestVersion: 1, key, name: key }
  Object.assign(document, MANIFEST, manifest)
  fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify(document), 'utf8')
  if (entry !== undefined) fs.writeFileSync(path.join(directory, 'entry.js'), entry, 'utf8')
}

/** 路由抛出的错误在真实服务器里会被 `normalizeError` 译成响应错误码，这里照样看那个码。 */
async function errorCodeOf(run: () => Promise<unknown>): Promise<string> {
  const error = await run().then(() => null, (caught: unknown) => caught)
  expect(error).not.toBeNull()
  return normalizeError(error).code
}

async function listPlugins() {
  const response = await pluginRoutes.request('/api/plugin/list', {})
  return response.json<{ success: boolean; data: Array<Record<string, unknown>> }>().data
}

async function enablePlugin(key: string): Promise<void> {
  await pluginRoutes.request('/api/plugin/enable', { key, inputs: INPUTS })
}

describe('plugin list route', () => {
  it('returns an empty list when nothing is installed', async () => {
    expect(await listPlugins()).toEqual([])
  })

  it('keeps a broken directory in the list instead of failing the whole page', async () => {
    // 一个坏目录不该让用户以为插件全都没了；它要能看见是"哪一个"坏的，以及坏在哪里。
    writePlugin('good')
    const brokenDirectory = path.join(pluginsDirectory, 'broken')
    fs.mkdirSync(brokenDirectory, { recursive: true })
    fs.writeFileSync(path.join(brokenDirectory, 'plugin.json'), '{ not json', 'utf8')

    const views = await listPlugins()

    expect(views.map(view => view.key).sort()).toEqual(['broken', 'good'])
    const broken = views.find(view => view.key === 'broken')
    expect(broken?.error).toBeTruthy()
    expect(broken?.enabled).toBe(false)
  })

  it('reports a directory whose name disagrees with the manifest key', async () => {
    fs.mkdirSync(path.join(pluginsDirectory, 'installed-name'), { recursive: true })
    fs.writeFileSync(
      path.join(pluginsDirectory, 'installed-name', 'plugin.json'),
      JSON.stringify({ ...MANIFEST, manifestVersion: 1, key: 'acme-free', name: 'Acme Free' }),
      'utf8',
    )

    const [view] = await listPlugins()

    expect(view.key).toBe('installed-name')
    expect(String(view.error)).toContain('acme-free')
  })

  it('marks an installed but not enabled plugin as not enabled and provider-less', async () => {
    writePlugin('acme-free')

    const [view] = await listPlugins()

    expect(view).toMatchObject({ key: 'acme-free', enabled: false, providerId: null, modelCount: 0, credentialStatus: 'none', error: null })
    expect(view.executable).toBe(false)
  })
})

describe('plugin secret redaction', () => {
  it('never returns a stored secret input in clear text', async () => {
    writePlugin('acme-free')
    await enablePlugin('acme-free')

    const [view] = await listPlugins()
    const inputValues = view.inputValues as Record<string, string>

    expect(inputValues.apiKey).toBe(SECRET_PLACEHOLDER)
    expect(JSON.stringify(view)).not.toContain('sk-1')
    expect((view.hasSecrets as string[])).toEqual(['apiKey'])
  })

  it('omits a secret input entirely while it has never been set', async () => {
    writePlugin('acme-free')

    const [view] = await listPlugins()

    expect((view.inputValues as Record<string, string>).apiKey).toBeUndefined()
    expect(view.hasSecrets).toEqual([])
    // 非密钥项照常回真值：它是用户能看见、也能改的东西。
    expect((view.inputValues as Record<string, string>).serverUrl).toBeUndefined()
  })

  it('returns the non-secret inputs unchanged once enabled', async () => {
    writePlugin('acme-free')
    await enablePlugin('acme-free')

    const [view] = await listPlugins()

    expect((view.inputValues as Record<string, string>).serverUrl).toBe(INPUTS.serverUrl)
  })

  it('accepts the placeholder back on set-inputs so the key survives a form save', async () => {
    // 界面把整份表单回写，密钥项送回来的是占位符；引擎必须认出它、保留原值。
    writePlugin('acme-free')
    await enablePlugin('acme-free')

    await pluginRoutes.request('/api/plugin/set-inputs', { key: 'acme-free', inputs: { serverUrl: 'https://api.example.com', apiKey: SECRET_PLACEHOLDER } })

    expect(secrets.get(pluginSecretReference('acme-free', 'input', 'apiKey'))).toBe('sk-1')
  })
})

describe('plugin sync state in the view', () => {
  it('surfaces the managed provider, model count and last sync time after enable', async () => {
    writePlugin('acme-free')
    await enablePlugin('acme-free')

    const [view] = await listPlugins()

    expect(view.enabled).toBe(true)
    expect(view.credentialStatus).toBe('ok')
    expect(view.providerId).toBeTruthy()
    expect(view.modelCount).toBe(1)
    expect(view.lastSyncTime).toBeTypeOf('number')
    expect(view.lastSyncError).toBeNull()
  })

  it('exposes the dynamically requested fields as form fields', async () => {
    // `input-required` 的字段不在清单里，是 hook 运行时才知道要什么的；不记下来界面就无表可填。
    writePlugin('acme-free', { inputs: [] }, `return {
      async obtainCredential() {
        return { status: 'input-required', fields: [{ key: 'otp', label: 'One-time code', required: true }] }
      },
    }`)

    const response = await pluginRoutes.request('/api/plugin/enable', { key: 'acme-free', inputs: {} })
    expect(response.statusCode).toBe(200)

    const [view] = await listPlugins()
    expect((view.inputs as Array<{ key: string }>).map(field => field.key)).toEqual(['otp'])
    expect(view.credentialStatus).toBe('input-required')
    // 中间态不是失败：界面不该把它渲染成错误。
    expect(view.lastSyncError).toBeNull()
  })

  it('reports a failed sync in lastSyncError while keeping the provider usable', async () => {
    writePlugin('acme-free')
    await enablePlugin('acme-free')
    // 上游回一句读不懂的东西。注意这里断言的是「有错误」而**不是**上游原文：
    // `requestModelList` 出于「一个地址失败就试下一个候选」的考虑吞掉了网络错误与非 2xx，
    // 最终上报的是调用方统一那句话，上游原文不会进入 `lastSyncError`。
    vi.mocked(coreNetworkClient.requestHttpBuffered).mockResolvedValue({ statusCode: 200, headers: {}, body: 'not json at all' })

    await expect(pluginRoutes.request('/api/plugin/sync', { key: 'acme-free' })).rejects.toThrow()

    const [view] = await listPlugins()
    expect(String(view.lastSyncError)).toContain('failed while running listModels')
    expect(view.enabled).toBe(true)
  })
})

describe('plugin get route', () => {
  it('returns the same view as the list entry for one plugin', async () => {
    writePlugin('acme-free')
    await enablePlugin('acme-free')

    const [fromList] = await listPlugins()
    const fromGet = (await pluginRoutes.request('/api/plugin/get', { key: 'acme-free' })).json<{ data: Record<string, unknown> }>().data

    expect(fromGet).toEqual(fromList)
  })

  it('fails for a plugin key that is not installed', async () => {
    await expect(pluginRoutes.request('/api/plugin/get', { key: 'ghost' })).rejects.toMatchObject({ code: 'PLUGIN_NOT_FOUND' })
  })
})

describe('plugin install route', () => {
  it('lists a plugin installed as a symlink to its source directory', async () => {
    const source = path.join(temporaryDirectory, 'source-acme')
    fs.mkdirSync(source, { recursive: true })
    fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({ manifestVersion: 1, key: 'acme-free', name: 'Acme Free' }), 'utf8')

    const response = await pluginRoutes.request('/api/plugin/install', { source: { type: 'directory', path: source } })

    expect(response.statusCode).toBe(200)
    expect((response.json<{ data: Record<string, unknown> }>().data).key).toBe('acme-free')
    expect((await listPlugins()).map(view => view.key)).toEqual(['acme-free'])
  })

  it('refuses a github source with the specific error code', async () => {
    await expect(pluginRoutes.request('/api/plugin/install', { source: { type: 'github', repo: 'acme/plugin' } }))
      .rejects.toMatchObject({ code: 'PLUGIN_SOURCE_UNSUPPORTED' })
  })

  it('rejects an install body without a source', async () => {
    expect(await errorCodeOf(() => pluginRoutes.request('/api/plugin/install', {}))).toBe('VALIDATION_ERROR')
  })
})

describe('plugin lifecycle routes', () => {
  it('disable keeps the directory and the provider row, only dropping the enabled marker', async () => {
    writePlugin('acme-free')
    await enablePlugin('acme-free')
    const providerId = (await listPlugins())[0].providerId as string

    await pluginRoutes.request('/api/plugin/disable', { key: 'acme-free' })

    const [view] = await listPlugins()
    expect(view.enabled).toBe(false)
    expect(view.providerId).toBeNull()
    // 目录还在：停用不是卸载。
    expect(fs.existsSync(path.join(pluginsDirectory, 'acme-free'))).toBe(true)
    expect((await getProvider(providerId))?.deletedTime).not.toBeNull()
  })

  it('uninstall removes the plugin directory and its managed data', async () => {
    const source = path.join(temporaryDirectory, 'source-acme')
    fs.mkdirSync(source, { recursive: true })
    fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({ manifestVersion: 1, key: 'acme-free', ...MANIFEST }), 'utf8')
    await pluginRoutes.request('/api/plugin/install', { source: { type: 'directory', path: source } })
    await enablePlugin('acme-free')

    await pluginRoutes.request('/api/plugin/uninstall', { key: 'acme-free' })

    expect(await listPlugins()).toEqual([])
    expect(fs.existsSync(source)).toBe(true)
    expect(secrets.size).toBe(0)
  })

  it('reload re-reads the manifest so a renamed provider shows up in the view', async () => {
    writePlugin('acme-free')
    await enablePlugin('acme-free')

    writePlugin('acme-free', { providerName: 'Acme Renamed' })
    await pluginRoutes.request('/api/plugin/reload', { key: 'acme-free' })

    const [view] = await listPlugins()
    expect(view.providerName).toBe('Acme Renamed')
  })

  it('rejects a request without a key', async () => {
    expect(await errorCodeOf(() => pluginRoutes.request('/api/plugin/disable', {}))).toBe('VALIDATION_ERROR')
  })
})

describe('plugin sync failure accounting', () => {
  it('records the failure into plugin.state even though the request rejects', async () => {
    writePlugin('acme-free')
    await enablePlugin('acme-free')
    const providerId = (await listPlugins())[0].providerId as string
    vi.mocked(coreNetworkClient.requestHttpBuffered).mockResolvedValue({ statusCode: 500, headers: {}, body: 'upstream is down' })

    await expect(pluginRoutes.request('/api/plugin/sync', { key: 'acme-free' })).rejects.toThrow()

    const state = await readPluginSyncState(providerId)
    expect(state.lastSyncError).toBeTruthy()
    // 失败不该动掉已有的读数：模型数与上次成功时间都还在。
    expect(state.modelCount).toBe(1)
    expect(state.lastSyncTime).not.toBeNull()
  })
})

describe('plugin icon route', () => {
  it('returns null when there is no icon instead of failing', async () => {
    writePlugin('acme-free')

    const response = await pluginRoutes.request('/api/plugin/icon', { key: 'acme-free' })

    expect(response.json<{ data: { svg: string | null } }>().data).toEqual({ key: 'acme-free', svg: null })
  })

  it('returns the svg source when the plugin ships one', async () => {
    writePlugin('acme-free')
    fs.writeFileSync(path.join(pluginsDirectory, 'acme-free', 'icon.svg'), '<svg />', 'utf8')

    const response = await pluginRoutes.request('/api/plugin/icon', { key: 'acme-free' })

    expect(response.json<{ data: { svg: string | null } }>().data.svg).toBe('<svg />')
  })
})

describe('plugin model routes after enable', () => {
  it('creates a provider model route for every model the plugin reported', async () => {
    writePlugin('acme-free')
    await enablePlugin('acme-free')

    const providerId = (await listPlugins())[0].providerId as string
    const routes = await listProviderModelRoutesByProvider(providerId)

    expect(routes.map(route => route.modelName)).toEqual(['acme-1'])
  })
})
