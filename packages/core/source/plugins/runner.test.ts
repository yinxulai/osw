import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import { coreNetworkClient } from '../infrastructure/network/core-network'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'
import type { ScannedPlugin } from './manifest'
import { loadPlugin } from './manifest'
import { pluginRunner } from './runner'

vi.mock('../infrastructure/network/core-network', () => ({
  coreNetworkClient: { requestHttp: vi.fn(), requestHttpBuffered: vi.fn() },
}))

/**
 * 沙箱执行。
 *
 * 这里是唯一真的把插件代码跑起来的地方，因此也是唯一能验出「沙箱到底关掉了什么」的地方：
 * worker 里没有 `require`、`process`、文件系统，能出去的只有 `ctx.http`。几条错的用例
 * （返回结构不符、抛异常、不返回）都要落到 `PLUGIN_RUN_FAILED`，不能变成一句笼统的内部错误。
 */

let temporaryDirectory: string
let pluginsDirectory: string
/** 每个插件写过的密钥，按引用存（就是 `SecretStore` 的形状）。 */
let secrets: Map<string, string>
let deletedReferences: string[]

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-plugin-runner-'))
  pluginsDirectory = path.join(temporaryDirectory, 'plugins')
  secrets = new Map()
  deletedReferences = []
  configureSecretStore({
    set: async (reference, value) => {
      secrets.set(reference, value)
    },
    get: async reference => secrets.get(reference) ?? null,
    delete: async reference => {
      deletedReferences.push(reference)
      secrets.delete(reference)
    },
  })
  vi.mocked(coreNetworkClient.requestHttpBuffered).mockReset()
})

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

/** 落一个插件目录并读成 `ScannedPlugin`。`entry` 传 `null` 时不写 `entry.js`（声明式插件）。 */
async function makePlugin(key: string, entry: string | null, manifestExtra: Record<string, unknown> = {}): Promise<ScannedPlugin> {
  const directory = path.join(pluginsDirectory, key)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, 'plugin.json'),
    JSON.stringify({ manifestVersion: 1, key, name: key, ...manifestExtra }),
    'utf8',
  )
  if (entry !== null) fs.writeFileSync(path.join(directory, 'entry.js'), entry, 'utf8')
  return await loadPlugin(pluginsDirectory, key)
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

describe('plugin runner', () => {
  it('跑通一个 hook：返回值按契约校验通过，日志原样回传', async () => {
    const plugin = await makePlugin('acme-free', `
      return {
        obtainCredential: async function (ctx) {
          ctx.log('info', 'asking for a key')
          console.log('through console')
          return { status: 'ready', apiKey: 'sk-123' }
        },
      }
    `)

    const result = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })

    expect(result.ok).toBe(true)
    expect(result.missing).toBe(false)
    expect(result.value).toEqual({ status: 'ready', apiKey: 'sk-123' })
    expect(result.logs).toEqual(['[info] asking for a key', '[log] through console'])
    expect(result.secretReferences).toEqual([])
  })

  it('把 inputs 交给插件（它是用户填的非密钥项）', async () => {
    const plugin = await makePlugin('acme-free', `
      return {
        obtainCredential: async function (ctx) {
          return { status: 'ready', apiKey: ctx.inputs.accountId }
        },
      }
    `)

    const result = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: { accountId: 'acc_9' }, providerId: 'prov_1' })
    expect(result.value).toEqual({ status: 'ready', apiKey: 'acc_9' })
  })

  it('支持在请求落地前动态覆写 URL 与 API Key', async () => {
    const plugin = await makePlugin('acme-free', `
      return {
        resolveRequest: async function (ctx) {
          return {
            url: 'https://dynamic.example.com/v1/chat/completions',
            apiKey: 'sk-dynamic',
            customAuthHeader: 'x-plugin-key',
            headers: { 'x-trace-id': 'req-42' },
          }
        },
      }
    `)

    const result = await pluginRunner.runResolveRequest({
      plugin,
      hook: 'resolveRequest',
      inputs: {},
      providerId: 'prov_1',
      request: {
        logicalModelId: 'gpt-4o-mini',
        providerModelId: 'model_1',
        providerModelName: 'gpt-4o-mini',
        protocol: 'openai-completions',
        method: 'POST',
        path: '/v1/chat/completions',
        headers: { authorization: 'Bearer stale' },
        body: '{"model":"gpt-4o-mini"}',
        url: 'https://stale.example.com/v1/chat/completions',
      },
    })

    expect(result.ok).toBe(true)
    expect(result.value).toEqual({
      url: 'https://dynamic.example.com/v1/chat/completions',
      apiKey: 'sk-dynamic',
      customAuthHeader: 'x-plugin-key',
      headers: { 'x-trace-id': 'req-42' },
    })
  })

  it('插件没实现这个 hook 时回 missing（正常形态，不是失败）', async () => {
    const plugin = await makePlugin('acme-free', `
      return { listModels: async function () { return { models: [] } } }
    `)

    const result = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })
    expect(result).toMatchObject({ ok: true, missing: true, value: null })
  })

  it('声明式插件（没有 entry.js）直接回 missing，连 worker 都不起', async () => {
    const plugin = await makePlugin('acme-free', null)

    await expect(pluginRunner.runListModels({ plugin, hook: 'listModels', inputs: {}, providerId: 'prov_1' }))
      .resolves.toMatchObject({ ok: true, missing: true, durationMilliseconds: 0 })
  })

  it('返回值不符合契约时回 PLUGIN_RUN_FAILED，并指出是哪个字段', async () => {
    const plugin = await makePlugin('acme-free', `
      return { obtainCredential: async function () { return { status: 'ready' } } }
    `)

    const error = await failureOf(() => pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' }))
    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('apiKey')
  })

  it('插件抛异常时把原话带出来', async () => {
    const plugin = await makePlugin('acme-free', `
      return { obtainCredential: async function () { throw new Error('upstream said no') } }
    `)

    const error = await failureOf(() => pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' }))
    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('upstream said no')
  })

  it('入口代码自己就抛错时也能报出来（不是「worker 静默退出」）', async () => {
    const plugin = await makePlugin('acme-free', `throw new Error('bad entry')`)

    const error = await failureOf(() => pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' }))
    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('bad entry')
  })

  it('挂住的 hook 被超时掐掉，回 PLUGIN_TIMEOUT（而不是一直等）', async () => {
    const plugin = await makePlugin('acme-free', `
      return { obtainCredential: async function () { await new Promise(function () {}); return { status: 'failed', message: 'never' } } }
    `, { timeoutMilliseconds: 150 })

    const error = await failureOf(() => pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' }))
    expect(error.code).toBe('PLUGIN_TIMEOUT')
    expect(error.statusCode).toBe(504)
  })

  it('沙箱里没有 require / process（拿不到就等于没给）', async () => {
    const plugin = await makePlugin('acme-free', `
      return {
        obtainCredential: async function () {
          var probes = [
            typeof require,
            typeof process,
            typeof globalThis.process,
          ]
          return { status: 'ready', apiKey: probes.join(',') }
        },
      }
    `)

    const result = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })
    // 三个探针都必须是 'undefined'：沙箱里连 `require` 这个标识符都不存在。
    expect(result.value).toEqual({ status: 'ready', apiKey: 'undefined,undefined,undefined' })
  })

  it('顶层死循环被 vm 的超时拦住（同步的那一半）', async () => {
    // 宿主兜底计时器比这个值晚一秒，因此这条走的是沙箱内部的同步超时：
    // 它给出的诊断比宿主那句「没在 N 毫秒内跑完」具体得多。
    const plugin = await makePlugin('acme-free', `
      while (true) {}
      return {}
    `, { timeoutMilliseconds: 400 })

    const error = await failureOf(() => pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' }))
    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('too long')
  })
})

describe('plugin runner host capabilities', () => {
  it('密钥按插件命名空间隔离，并记下写入的引用', async () => {
    const plugin = await makePlugin('acme-free', `
      return {
        obtainCredential: async function (ctx) {
          await ctx.secrets.set('refresh', 'rt-1')
          var read = await ctx.secrets.get('refresh')
          var foreign = await ctx.secrets.get('hook::other')
          return { status: 'ready', apiKey: read + '/' + String(foreign) }
        },
      }
    `)

    const result = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })

    expect(secrets.get('plugin::acme-free::hook::refresh')).toBe('rt-1')
    expect(result.secretReferences).toEqual(['plugin::acme-free::hook::refresh'])
    // 读不到的名字回 null（不是空串）：插件才好区分「没设过」与「设成了空」。
    expect(result.value).toEqual({ status: 'ready', apiKey: 'rt-1/null' })
  })

  it('声明为 secret 的输入项在 `secrets.get(<inputKey>)` 下直接可读', async () => {
    const plugin = await makePlugin('acme-free', `
      return {
        obtainCredential: async function (ctx) {
          return { status: 'ready', apiKey: await ctx.secrets.get('apiKeyInput') }
        },
      }
    `, { inputs: [{ key: 'apiKeyInput', label: 'API Key', type: 'password', secret: true }] })
    secrets.set('plugin::acme-free::input::apiKeyInput', 'sk-from-user')

    const result = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })
    expect(result.value).toEqual({ status: 'ready', apiKey: 'sk-from-user' })
  })

  it('storage 跨调用留存（它就是给插件放 token 的抽屉）', async () => {
    const source = `
      return {
        obtainCredential: async function (ctx) {
          var previous = await ctx.storage.get('token')
          await ctx.storage.set('token', 'v2')
          return { status: 'ready', apiKey: String(previous) }
        },
      }
    `
    let plugin = await makePlugin('acme-free', source)
    const first = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })
    expect(first.value).toEqual({ status: 'ready', apiKey: 'null' })

    plugin = await loadPlugin(pluginsDirectory, 'acme-free')
    const second = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })
    expect(second.value).toEqual({ status: 'ready', apiKey: 'v2' })
    expect(secrets.get('plugin::acme-free::storage::token')).toBe('v2')
  })

  it('`ctx.http` 走宿主网络（因此与代理同一套出站设置）', async () => {
    vi.mocked(coreNetworkClient.requestHttpBuffered).mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"data":[{"id":"m-1"}]}',
    })
    const plugin = await makePlugin('acme-free', `
      return {
        listModels: async function (ctx) {
          var response = await ctx.http({ url: 'https://api.example.com/v1/models', headers: { authorization: 'Bearer x' } })
          var json = JSON.parse(response.body)
          return { models: [{ id: json.data[0].id }] }
        },
      }
    `)

    const result = await pluginRunner.runListModels({ plugin, hook: 'listModels', inputs: {}, providerId: 'prov_1' })

    expect(result.value).toEqual({ models: [{ id: 'm-1' }] })
    expect(coreNetworkClient.requestHttpBuffered).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(coreNetworkClient.requestHttpBuffered).mock.calls[0]
    expect(url.toString()).toBe('https://api.example.com/v1/models')
    expect(options).toMatchObject({ method: 'GET', hostname: 'api.example.com' })
  })

  it('`ctx.http` 只允许 http(s)（别的协议在宿主侧就被挡掉）', async () => {
    const plugin = await makePlugin('acme-free', `
      return {
        listModels: async function (ctx) {
          await ctx.http({ url: 'file:///etc/passwd' })
          return { models: [] }
        },
      }
    `)

    const error = await failureOf(() => pluginRunner.runListModels({ plugin, hook: 'listModels', inputs: {}, providerId: 'prov_1' }))
    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('Unsupported url protocol')
    expect(coreNetworkClient.requestHttpBuffered).not.toHaveBeenCalled()
  })

  it('调用宿主不认识的能力时被挡住（白名单没有兜底分支）', async () => {
    const plugin = await makePlugin('acme-free', `
      return {
        obtainCredential: async function () {
          return await __hostCall('database.query', '[]')
        },
      }
    `)

    const error = await failureOf(() => pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' }))
    expect(error.code).toBe('PLUGIN_RUN_FAILED')
    expect(error.message).toContain('unknown host method')
  })
})

describe('plugin runner hot reload', () => {
  it('改一行 entry.js 下一次调用就生效（不缓存 worker，也不缓存代码）', async () => {
    const plugin = await makePlugin('acme-free', `
      return { obtainCredential: async function () { return { status: 'ready', apiKey: 'first' } } }
    `)
    const first = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })
    expect(first.value).toEqual({ status: 'ready', apiKey: 'first' })

    fs.writeFileSync(
      path.join(pluginsDirectory, 'acme-free', 'entry.js'),
      `return { obtainCredential: async function () { return { status: 'ready', apiKey: 'second' } } }`,
      'utf8',
    )

    // 这里刻意仍用同一个 `ScannedPlugin`（entryPath 不变）：本地开发改的就是这个文件的内容，
    // 若有人为了「省点开销」把代码内容也缓存下来，这条就会红。
    const second = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })
    expect(second.value).toEqual({ status: 'ready', apiKey: 'second' })
  })

  it('同一插件的两次调用互不串味（每次都是一个新的 worker）', async () => {
    const plugin = await makePlugin('acme-free', `
      var counter = 0
      return {
        obtainCredential: async function () {
          counter = counter + 1
          return { status: 'ready', apiKey: String(counter) }
        },
      }
    `)

    const first = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })
    const second = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs: {}, providerId: 'prov_1' })

    // 两次都是 1：模块级变量不跨调用留存（留存要靠 `ctx.storage`）。
    expect([first.value, second.value]).toEqual([
      { status: 'ready', apiKey: '1' },
      { status: 'ready', apiKey: '1' },
    ])
  })
})
