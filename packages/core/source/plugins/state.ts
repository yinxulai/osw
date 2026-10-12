import { PluginSyncStateSchema, type PluginInputField, type PluginSyncState } from '@common/plugin'
import { getProviderSetting, listProviders, deleteProviderSetting, upsertProviderSetting } from '../database/provider-store'
import { getSecretStore } from '../infrastructure/secrets/secret-store'

/**
 * 插件的运行时状态落点。
 *
 * **不新增数据库表**：插件的身份是磁盘上的目录，它运行时的东西（托管了哪个 Provider、用户填了什么、
 * 上次同步结果）本来就依附于那条 Provider 记录。所以这里全部复用 `provider_settings` 这个 KV，
 * 挂在**被托管的 Provider** 上（见 `apps/docs/specs/plugins.md` §7）：
 *
 * | key | 值 |
 * | --- | --- |
 * | `plugin.key` | 插件 key。**这一行的存在本身就是「这个插件已启用」**，不需要额外的开关列 |
 * | `plugin.inputs` | JSON：非密钥输入项的值 |
 * | `plugin.state` | JSON：上次同步的读数（`PluginSyncState`） |
 *
 * 托管关系靠 `plugin.key` 认，而不是靠 Provider 名字：名字是用户能改的，改完插件就找不到自己的
 * Provider 了（会新建一条，用户改过的设置留在旧的那条上）。
 */

export const PLUGIN_PROVIDER_SETTING_KEY = 'plugin.key'
export const PLUGIN_INPUTS_SETTING_KEY = 'plugin.inputs'
export const PLUGIN_STATE_SETTING_KEY = 'plugin.state'

/** 密钥引用的命名空间前缀：`plugin::<key>::{input|hook|storage}::<name>`。 */
export function pluginSecretReference(key: string, scope: 'input' | 'hook' | 'storage', name: string): string {
  return `plugin::${key}::${scope}::${name}`
}

/** 非密钥输入项的落点（secret 输入项不进这里，见文件头）。 */
export async function readPluginInputs(providerId: string): Promise<Record<string, string>> {
  const setting = await getProviderSetting(providerId, PLUGIN_INPUTS_SETTING_KEY)
  if (!setting) return {}
  try {
    const parsed: unknown = JSON.parse(setting.value)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const values: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      // 值一律存字符串：表单控件给的就是字符串，`number` / `boolean` 类型只是渲染提示。
      if (typeof value === 'string') values[key] = value
    }
    return values
  } catch {
    // 用户手改过配置库、JSON 坏了：当成「什么都没填」继续跑，而不是让整页打不开。
    return {}
  }
}

export async function writePluginInputs(providerId: string, inputs: Record<string, string>): Promise<void> {
  await upsertProviderSetting({ providerId, key: PLUGIN_INPUTS_SETTING_KEY, value: JSON.stringify(inputs), valueType: 'json' })
}

/** 读托管状态；非密钥输入项之外的东西一律回默认值（`PluginSyncStateSchema` 自带缺省）。 */
export async function readPluginSyncState(providerId: string): Promise<PluginSyncState> {
  const setting = await getProviderSetting(providerId, PLUGIN_STATE_SETTING_KEY)
  if (!setting) return PluginSyncStateSchema.parse({})
  try {
    return PluginSyncStateSchema.parse(JSON.parse(setting.value))
  } catch {
    return PluginSyncStateSchema.parse({})
  }
}

export async function writePluginSyncState(providerId: string, state: PluginSyncState): Promise<void> {
  await upsertProviderSetting({ providerId, key: PLUGIN_STATE_SETTING_KEY, value: JSON.stringify(state), valueType: 'json' })
}

/**
 * `ctx.storage` 的落点。
 *
 * 它进的是**密钥库**而不是配置库：`storage` 的典型用法就是缓存 OAuth 的 access/refresh token
 * 这类东西（§5 的原话是「插件私有持久化（token 缓存等）」），写进配置库等于把它们明文放在
 * 用户随时会导出/备份的文件里。密钥引用命名空间同样限定在 `plugin::<key>::*` 之下（§12）。
 */
export async function readPluginStorageValue(key: string, name: string): Promise<string | null> {
  return getSecretStore().get(pluginSecretReference(key, 'storage', name))
}

export async function writePluginStorageValue(key: string, name: string, value: string): Promise<void> {
  await getSecretStore().set(pluginSecretReference(key, 'storage', name), value)
}


/**
 * 找出这个插件当前托管的 Provider。
 *
 * 一次遍历所有活跃供应商、逐个读 `plugin.key`：托管关系是低频读（只在启用/同步/打开插件页时），
 * 而供应商数量是个位数，为它加一份常驻索引不划算。**也没法用 `listProviders` 的读缓存**——
 * 那份缓存里没有设置行（见 `database/provider-store.ts` 的 `mapProvider`）。
 */
export async function findManagedProviderId(key: string): Promise<string | null> {
  for (const provider of await listProviders()) {
    const setting = await getProviderSetting(provider.id, PLUGIN_PROVIDER_SETTING_KEY)
    if (setting?.value === key) return provider.id
  }
  return null
}

/** 读全部插件的托管标记（一次遍历，供列表接口用，避免每个插件各扫一遍）。 */
export async function readManagedProviderIds(): Promise<Map<string, string>> {
  const managed = new Map<string, string>()
  for (const provider of await listProviders()) {
    const setting = await getProviderSetting(provider.id, PLUGIN_PROVIDER_SETTING_KEY)
    if (setting && setting.value) managed.set(setting.value, provider.id)
  }
  return managed
}

/** 打上托管标记。写在 `createProvider` 之后、同步之前——中途失败的话这条 Provider 只是没被占用。 */
export async function markManagedProvider(providerId: string, key: string): Promise<void> {
  await upsertProviderSetting({ providerId, key: PLUGIN_PROVIDER_SETTING_KEY, value: key, valueType: 'string' })
}

/** 清掉全部插件痕迹（禁用/卸载时用）。密钥引用与调度策略由同步引擎负责，这里只管这三行设置。 */
export async function clearPluginSettings(providerId: string): Promise<void> {
  await deleteProviderSetting(providerId, PLUGIN_STATE_SETTING_KEY)
  await deleteProviderSetting(providerId, PLUGIN_INPUTS_SETTING_KEY)
  await deleteProviderSetting(providerId, PLUGIN_PROVIDER_SETTING_KEY)
}

/**
 * 用户填的关注点与清单声明的输入项的对照：返回**还缺哪些必填项**。
 *
 * 界面拿它做「启用」按钮的可用性判断。同步入口**不做**这道前置校验：缺项会落进
 * `credentialFromManifest` 变成 `input-required` 中间态（而不是同步失败），所以这里
 * 只有界面一个调用方——但规则仍只能有一份，界面放行的组合不该被宿主拒掉。
 */
export function missingRequiredInputs(fields: PluginInputField[], values: Record<string, string>, hasSecret: (key: string) => boolean): string[] {
  return fields
    .filter(field => field.required)
    .filter(field => {
      const value = values[field.key]
      if (field.secret) return !((value && value.length > 0) || hasSecret(field.key))
      return !value || value.trim().length === 0
    })
    .map(field => field.key)
}
