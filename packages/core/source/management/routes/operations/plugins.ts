import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { PluginInstallSourceSchema, PluginViewSchema, type PluginInputField, type PluginView } from '@common/plugin'
import { HttpRouter } from '@server/http-router'
import { loadPlugin, readPluginIcon, type ScannedPlugin } from '@server/plugins/manifest'
import { findManagedProviderId, pluginSecretReference, readPluginInputs, readPluginSyncState } from '@server/plugins/state'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import {
  disablePlugin,
  enablePlugin,
  recordSyncFailure,
  reloadPlugin,
  setPluginInputs,
  syncPlugin,
  uninstallPlugin,
  type PluginSyncOutcome,
} from '@server/plugins/sync-engine'
import { installPlugin, listPluginDirectories } from '@server/plugins/installer'
import { getPluginDirectory } from '@server/plugins/registry'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

/**
 * 插件管理接口（全 POST，见 `apps/docs/specs/plugins.md` §10）。
 *
 * 界面只消费聚合后的 `PluginView`：把清单、运行状态、托管 Provider 拼一次的活留在这里，
 * 而不是让前端自己去 join 三份数据——那种 join 一旦有一处漏了，界面就会显示一个
 * 「看起来正常、其实没有 Provider」的插件。
 */
export const pluginRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/plugin/list', handleList)
  .post('/api/plugin/get', handleGet)
  .post('/api/plugin/install', handleInstall)
  .post('/api/plugin/uninstall', handleUninstall)
  .post('/api/plugin/enable', handleEnable)
  .post('/api/plugin/disable', handleDisable)
  .post('/api/plugin/sync', handleSync)
  .post('/api/plugin/set-inputs', handleSetInputs)
  .post('/api/plugin/reload', handleReload)
  .post('/api/plugin/icon', handleIcon)

const KeySchema = z.object({ key: z.string().min(1) })

/** 列表：把每个**目录**都列出来，坏掉的那个回一条 `error` 而不是让整页失败。 */
async function handleList(_req: IncomingMessage, res: ServerResponse, _body: unknown): Promise<void> {
  const directory = getPluginDirectory()
  const keys = await listPluginDirectories(directory)
  const views: PluginView[] = []
  for (const key of keys) {
    try {
      views.push(await buildView(await loadPlugin(directory, key)))
    } catch (error) {
      // 装不上的目录照样出现在列表里：用户需要看到「我放进去的那个目录」以及它到底哪里不对。
      views.push(brokenView(key, error))
    }
  }
  sendSuccess(res, views)
}

async function handleGet(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { key } = KeySchema.parse(body)
  sendSuccess(res, await buildView(await loadPlugin(getPluginDirectory(), key)))
}

/**
 * 安装：只接本地目录（P0）。`github` 由 `installPlugin` 明确拒绝。
 *
 * 安装**不等于启用**：装进来只是让插件出现在列表里，用户还要点「启用」并填输入项。
 * 把两件事合成一步会在用户没填必填项时留下一条半残的 Provider。
 */
async function handleInstall(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { source } = z.object({ source: PluginInstallSourceSchema }).parse(body)
  const plugin = await installPlugin(getPluginDirectory(), source)
  sendSuccess(res, await buildView(plugin))
}

async function handleUninstall(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { key } = KeySchema.parse(body)
  await uninstallPlugin(key)
  sendSuccess(res, { key })
}

/** 启用：可以先带一批输入项（界面「填完直接启用」是一次调用）。 */
async function handleEnable(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = KeySchema.extend({ inputs: z.record(z.string(), z.string()).optional() }).parse(body)
  sendSuccess(res, await wrapSyncOutcome(input.key, () => enablePlugin(input.key, input.inputs)))
}

async function handleDisable(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { key } = KeySchema.parse(body)
  await disablePlugin(key)
  sendSuccess(res, { key })
}

/** 手动同步。失败时会先把错误记进 `plugin.state.lastSyncError`，再原样抛出（见 `recordSyncFailure`）。 */
async function handleSync(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { key } = KeySchema.parse(body)
  sendSuccess(res, await wrapSyncOutcome(key, () => syncPlugin(key)))
}

async function handleSetInputs(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = KeySchema.extend({ inputs: z.record(z.string(), z.string()) }).parse(body)
  sendSuccess(res, await wrapSyncOutcome(input.key, () => setPluginInputs(input.key, input.inputs)))
}

/** 重载：本地开发的热重载入口（重读清单与 `entry.js` 后重新同步）。 */
async function handleReload(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { key } = KeySchema.parse(body)
  sendSuccess(res, await wrapSyncOutcome(key, () => reloadPlugin(key)))
}

/** 插件图标（可选 `icon.svg`）。读不到就回 `null`，界面画通用图标——不是错误。 */
async function handleIcon(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { key } = KeySchema.parse(body)
  sendSuccess(res, { key, svg: await readPluginIcon(getPluginDirectory(key)) })
}

/** 同步类入口统一走这里：失败先落盘成状态，再把错误交给统一的错误处理器。 */
async function wrapSyncOutcome(key: string, action: () => Promise<PluginSyncOutcome>): Promise<PluginSyncOutcome> {
  try {
    return await action()
  } catch (error) {
    await recordSyncFailure(key, error)
    throw error
  }
}

// ========== 视图拼装 ==========

/** 把「清单 + 托管 Provider + 同步状态 + 密钥存在性」拼成界面直接能用的那一份。 */
async function buildView(plugin: ScannedPlugin): Promise<PluginView> {
  const providerId = await findManagedProviderId(plugin.key)
  const state = providerId ? await readPluginSyncState(providerId) : null
  const values = providerId ? await readPluginInputs(providerId) : {}
  // `input-required` 时 hook 动态要求的字段要一起给出来，否则界面无表可填（见 `PluginSyncState`）。
  const fields = mergeFields(plugin.manifest.inputs, state?.credentialFields ?? [])
  const secrets = new Set<PluginInputField['key']>([])
  const secretStore = getSecretStore()
  const inputValues: Record<string, string> = {}
  for (const field of fields) {
    if (field.secret) {
      // 密钥项**绝不回明文**：只回一个非空占位符，界面据此显示「已设置」。
      const exists = await secretStore.get(pluginSecretReference(plugin.key, 'input', field.key))
      if (exists) {
        secrets.add(field.key)
        inputValues[field.key] = SECRET_PLACEHOLDER
      }
      continue
    }
    const value = values[field.key]
    if (value !== undefined) inputValues[field.key] = value
  }

  return PluginViewSchema.parse({
    key: plugin.key,
    name: plugin.manifest.name,
    description: plugin.manifest.description,
    homepage: plugin.manifest.homepage ?? null,
    providerName: plugin.manifest.providerName ?? plugin.manifest.name,
    capabilities: plugin.manifest.capabilities,
    error: null,
    executable: plugin.entryPath !== null,
    dev: plugin.manifest.dev,
    enabled: providerId !== null,
    credentialStatus: state?.credentialStatus ?? 'none',
    credentialMessage: state?.credentialMessage ?? null,
    actionUrl: state?.actionUrl ?? null,
    inputs: fields,
    inputValues,
    hasSecrets: [...secrets],
    providerId,
    modelCount: state?.modelCount ?? 0,
    lastSyncTime: state?.lastSyncTime ?? null,
    lastSyncError: state?.lastSyncError ?? null,
  })
}

/** 密钥项回给界面的占位符。它只表示「有值」，界面提交时会把原值原样送回（见 `setPluginInputs`）。 */
export const SECRET_PLACEHOLDER = '••••••••'

/**
 * 清单声明 + hook 动态要求的字段，去重后合并。
 *
 * 顺序上清单在前：用户熟悉的那几个字段不该因为一次 `input-required` 就换位置。
 */
function mergeFields(declared: PluginInputField[], dynamic: PluginInputField[]): PluginInputField[] {
  const seen = new Set(declared.map(field => field.key))
  return [...declared, ...dynamic.filter(field => !seen.has(field.key))]
}

/**
 * 坏目录的占位视图。
 *
 * 其余字段填中性值而不是抛错：列表要能显示「这一条是坏的」，用户才知道去哪个目录修。
 */
function brokenView(key: string, error: unknown): PluginView {
  return PluginViewSchema.parse({
    key,
    name: key,
    description: '',
    providerName: key,
    capabilities: [],
    inputs: [],
    inputValues: {},
    error: error instanceof Error ? error.message : String(error),
  })
}
