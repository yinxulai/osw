import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PluginSyncStateSchema } from '@common/plugin'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'
import { closeDatabases, initDatabases } from '../database'
import {
  createProvider,
  deleteProvider,
  getProviderSetting,
  listProviderSettings,
  upsertProviderSetting,
} from '../database/provider-store'
import {
  PLUGIN_INPUTS_SETTING_KEY,
  PLUGIN_PROVIDER_SETTING_KEY,
  PLUGIN_STATE_SETTING_KEY,
  clearPluginSettings,
  findManagedProviderId,
  markManagedProvider,
  missingRequiredInputs,
  pluginSecretReference,
  readManagedProviderIds,
  readPluginInputs,
  readPluginStorageValue,
  readPluginSyncState,
  writePluginInputs,
  writePluginStorageValue,
  writePluginSyncState,
} from './state'

/**
 * 插件运行时状态的落点。
 *
 * 这一层有两个容易默默错掉的地方，所以每条都单独验：
 *
 * 1. **托管关系靠 `plugin.key` 而不是 Provider 名字**（用户能改名，改完插件就找不到自己那条 Provider）。
 * 2. **读路径一律不许抛**——用户在设置里手改过配置库、JSON 坏掉，页面还得能打开。
 */

let temporaryDirectory: string
let secrets: Map<string, string>

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-plugin-state-'))
  await initDatabases(temporaryDirectory)
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
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function managedProvider(name = 'Acme Free'): Promise<{ id: string }> {
  return createProvider({ name, apiKeyReference: 'secret-prov-1' })
}

describe('plugin state: secret references', () => {
  it('拼出带命名空间的引用，三种作用域各自可分辨', () => {
    // 命名空间是插件之间唯一的隔离手段（§12）：读侧靠 `plugin::<key>::*` 前缀做校验，
    // 少一段就等于把别的插件的密钥也放进了可读范围。
    expect(pluginSecretReference('acme-free', 'input', 'apiKey')).toBe('plugin::acme-free::input::apiKey')
    expect(pluginSecretReference('acme-free', 'hook', 'refresh')).toBe('plugin::acme-free::hook::refresh')
    expect(pluginSecretReference('acme-free', 'storage', 'token')).toBe('plugin::acme-free::storage::token')
  })

  it('storage 读写走密钥库，而不是配置库', async () => {
    // `ctx.storage` 的典型用法是缓存 OAuth token，写进配置库等于把它明文放进用户会导出的文件里。
    await writePluginStorageValue('acme-free', 'token', 't-1')

    expect(secrets.get('plugin::acme-free::storage::token')).toBe('t-1')
    expect(await readPluginStorageValue('acme-free', 'token')).toBe('t-1')
    // 一条设置行都不该多出来。
    expect(secrets.size).toBe(1)
  })

  it('storage 没写过时回 null（不是空串）', async () => {
    await expect(readPluginStorageValue('acme-free', 'missing')).resolves.toBeNull()
  })
})

describe('plugin state: inputs', () => {
  it('写进去再读出来是同一份', async () => {
    const provider = await managedProvider()

    await writePluginInputs(provider.id, { serverUrl: 'https://api.example.com' })

    expect(await readPluginInputs(provider.id)).toEqual({ serverUrl: 'https://api.example.com' })
    expect((await getProviderSetting(provider.id, PLUGIN_INPUTS_SETTING_KEY))?.valueType).toBe('json')
  })

  it('没写过时回空对象（未启用不是错误）', async () => {
    const provider = await managedProvider()
    await expect(readPluginInputs(provider.id)).resolves.toEqual({})
  })

  it('只接受字符串值，其余类型被丢掉', async () => {
    // 表单控件给的就是字符串，`number` / `boolean` 只是渲染提示。留着非字符串会一路
    // 传到插值里变成 "[object Object]" 这种地址。
    const provider = await managedProvider()
    await upsertProviderSetting({
      providerId: provider.id,
      key: PLUGIN_INPUTS_SETTING_KEY,
      value: JSON.stringify({ serverUrl: 'https://api.example.com', count: 3, flag: true, nested: { a: 1 } }),
      valueType: 'json',
    })

    expect(await readPluginInputs(provider.id)).toEqual({ serverUrl: 'https://api.example.com' })
  })

  it('JSON 被手改坏时当成「什么都没填」，而不是让整页打不开', async () => {
    const provider = await managedProvider()
    await upsertProviderSetting({ providerId: provider.id, key: PLUGIN_INPUTS_SETTING_KEY, value: '{ not json', valueType: 'json' })

    await expect(readPluginInputs(provider.id)).resolves.toEqual({})
  })

  it('顶层不是对象时也回空对象（数组/字面量都不该漏出去）', async () => {
    const provider = await managedProvider()
    for (const value of ['[1,2,3]', '"plain"', 'null']) {
      await upsertProviderSetting({ providerId: provider.id, key: PLUGIN_INPUTS_SETTING_KEY, value, valueType: 'json' })
      await expect(readPluginInputs(provider.id)).resolves.toEqual({})
    }
  })
})

describe('plugin state: sync state', () => {
  it('没写过时回 schema 的缺省值', async () => {
    const provider = await managedProvider()

    await expect(readPluginSyncState(provider.id)).resolves.toEqual(PluginSyncStateSchema.parse({}))
  })

  it('写进去再读出来是同一份，含密钥引用清单', async () => {
    const provider = await managedProvider()
    const state = PluginSyncStateSchema.parse({
      credentialStatus: 'ok',
      lastSyncTime: 1_700_000_000_000,
      modelCount: 3,
      secretReferences: ['plugin::acme-free::hook::refresh'],
    })

    await writePluginSyncState(provider.id, state)

    expect(await readPluginSyncState(provider.id)).toEqual(state)
    expect((await getProviderSetting(provider.id, PLUGIN_STATE_SETTING_KEY))?.valueType).toBe('json')
  })

  it('JSON 坏掉时退回缺省值（不让一条坏设置行打断列表）', async () => {
    const provider = await managedProvider()
    await upsertProviderSetting({ providerId: provider.id, key: PLUGIN_STATE_SETTING_KEY, value: '{ not json', valueType: 'json' })

    await expect(readPluginSyncState(provider.id)).resolves.toEqual(PluginSyncStateSchema.parse({}))
  })

  it('形状对不上 schema 时也退回缺省值', async () => {
    // 例如 `modelCount` 被手改成了负数：解析会抛，但读路径不许抛。
    const provider = await managedProvider()
    await upsertProviderSetting({ providerId: provider.id, key: PLUGIN_STATE_SETTING_KEY, value: JSON.stringify({ modelCount: -1 }), valueType: 'json' })

    await expect(readPluginSyncState(provider.id)).resolves.toEqual(PluginSyncStateSchema.parse({}))
  })
})

describe('plugin state: managed provider lookup', () => {
  it('靠 plugin.key 找到托管的那条 Provider', async () => {
    const provider = await managedProvider()

    await markManagedProvider(provider.id, 'acme-free')

    expect((await getProviderSetting(provider.id, PLUGIN_PROVIDER_SETTING_KEY))?.value).toBe('acme-free')
    expect(await findManagedProviderId('acme-free')).toBe(provider.id)
    expect(await findManagedProviderId('other-plugin')).toBeNull()
  })

  it('用户改了 Provider 名字也照样找得到', async () => {
    // 托管关系挂在设置行上而不是名字上，正是为了这一条：改名不该让插件丢掉自己的 Provider。
    const provider = await managedProvider('Acme Free')

    await markManagedProvider(provider.id, 'acme-free')

    expect(await findManagedProviderId('acme-free')).toBe(provider.id)
  })

  it('没打标记的 Provider 不算被托管', async () => {
    await managedProvider('Hand Written')
    expect(await findManagedProviderId('acme-free')).toBeNull()
  })

  it('软删掉的 Provider 不再被找到', async () => {
    const provider = await managedProvider()
    await markManagedProvider(provider.id, 'acme-free')

    await deleteProvider(provider.id)

    expect(await findManagedProviderId('acme-free')).toBeNull()
    // 设置行还留着（`deleteProvider` 不清它），但那不是「托管」。
    expect(await getProviderSetting(provider.id, PLUGIN_PROVIDER_SETTING_KEY)).toBeDefined()
  })

  it('readManagedProviderIds 一次给出 key → providerId 的对照', async () => {
    const first = await managedProvider('First')
    const second = await managedProvider('Second')
    await managedProvider('Not Managed')
    await markManagedProvider(first.id, 'acme-free')
    await markManagedProvider(second.id, 'acme-plus')

    expect([...(await readManagedProviderIds()).entries()].sort()).toEqual([
      ['acme-free', first.id],
      ['acme-plus', second.id],
    ])
  })

  it('clearPluginSettings 把三行设置都清掉', async () => {
    // 这三行是插件的全部痕迹（托管标记、输入项、同步状态），留着任何一行都会让下一次
    // 启用拿到上一次的残留。
    const provider = await managedProvider()
    await markManagedProvider(provider.id, 'acme-free')
    await writePluginInputs(provider.id, { serverUrl: 'https://api.example.com' })
    await writePluginSyncState(provider.id, PluginSyncStateSchema.parse({ modelCount: 1 }))

    await clearPluginSettings(provider.id)

    const settings = await listProviderSettings(provider.id)
    expect(settings.map(setting => setting.key)).not.toContain(PLUGIN_PROVIDER_SETTING_KEY)
    expect(settings.map(setting => setting.key)).not.toContain(PLUGIN_INPUTS_SETTING_KEY)
    expect(settings.map(setting => setting.key)).not.toContain(PLUGIN_STATE_SETTING_KEY)
    expect(await findManagedProviderId('acme-free')).toBeNull()
  })

  it('clearPluginSettings 不动 Provider 自带的设置行', async () => {
    // 它只管插件那三行。顺手清掉密钥引用或超时配置会把用户填过的东西一起抹掉。
    const provider = await managedProvider()
    await markManagedProvider(provider.id, 'acme-free')

    await clearPluginSettings(provider.id)

    const keys = (await listProviderSettings(provider.id)).map(setting => setting.key)
    expect(keys).toContain('security.secretReference')
    expect(keys).toContain('connection.timeoutMilliseconds')
  })
})

describe('plugin state: missing required inputs', () => {
  const fields = [
    { key: 'serverUrl', label: 'Server URL', type: 'url' as const, required: true, secret: false },
    { key: 'apiKey', label: 'API Key', type: 'password' as const, required: false, secret: true },
    { key: 'org', label: 'Organization', type: 'string' as const, required: true, secret: false },
  ]

  it('只报必填项里还缺的那些', () => {
    expect(missingRequiredInputs(fields, { serverUrl: 'https://api.example.com' }, () => false)).toEqual(['org'])
  })

  it('可选项不参与判断（空着就是空着）', () => {
    expect(missingRequiredInputs(fields, { serverUrl: 'https://api.example.com', org: 'acme' }, () => false)).toEqual([])
  })

  it('纯空白的值等于没填', () => {
    // 用户敲了几个空格，不该被当成填过了。
    expect(missingRequiredInputs(fields, { serverUrl: '   ', org: 'acme' }, () => false)).toEqual(['serverUrl'])
  })

  it('密钥项的值在密钥库里也算填过', () => {
    const secretOnly = [{ key: 'apiKey', label: 'API Key', type: 'password' as const, required: true, secret: true }]

    expect(missingRequiredInputs(secretOnly, {}, key => key === 'apiKey')).toEqual([])
    expect(missingRequiredInputs(secretOnly, {}, () => false)).toEqual(['apiKey'])
    // 提交上来的值也算。
    expect(missingRequiredInputs(secretOnly, { apiKey: 'sk-1' }, () => false)).toEqual([])
  })

  it('一项都没声明时回空数组', () => {
    expect(missingRequiredInputs([], {}, () => false)).toEqual([])
  })
})
