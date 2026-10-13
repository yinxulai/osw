import { generateKeyReference } from '@common/secret-store'
import type { Protocol } from '@common/schemas'
import type {
  PluginCredentialResult,
  PluginInputField,
  PluginManifest,
  PluginModelListing,
  PluginSyncState,
} from '@common/plugin'
import { getProvider, createProvider, updateProvider, deleteProvider, replaceProviderEndpoints } from '../database/provider-store'
import { listProviderModelRoutesByProvider, createProviderModelRoute, deleteProviderModelRoute } from '../database/model-store'
import { deleteSchedulingPolicy, getDefaultLogicalModelRecordId, upsertSchedulingPolicy } from '../database/logical-model-store'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import { coreNetworkClient } from '../infrastructure/network/core-network'
import { buildModelListUrls, parseModelListResponse } from '../management/routes/diagnostics/provider-models-fetch'
import { pluginRunFailedError } from '../errors'
import { loadPlugin, hasUnresolvedTemplate, interpolateTemplate, type ScannedPlugin } from './manifest'
import { pluginRunner } from './runner'
import { removePluginDirectory } from './installer'
import { getPluginDirectory } from './registry'
import {
  clearPluginSettings,
  findManagedProviderId,
  markManagedProvider,
  pluginSecretReference,
  readPluginInputs,
  readPluginSyncState,
  writePluginInputs,
  writePluginSyncState,
} from './state'

/**
 * 插件的同步引擎：把「插件说了什么」落成一条可用的 Provider。
 *
 * 整个插件机制的落点在这一个文件：它**不碰代理内核**，只调用现有 CRUD
 * （`createProvider` / `replaceProviderEndpoints` / `createProviderModelRoute` / `upsertSchedulingPolicy`），
 * 因此插件产出的供应商与用户手建的供应商在后续每一层里完全同质（见 `apps/docs/specs/plugins.md` §8）。
 *
 * 四条不可动摇的规则，都在下面逐处兑现：
 * 1. **失败不动已有配置**：hook 抛错/超时只是这次同步失败，不删模型、不改端点。
 * 2. **空清单不删模型**：`listModels` 回空数组是「上游现在没有模型」，不是「用户想清空」。
 * 3. **`input-required` / `action-required` 是中间态不是失败**：记状态、等用户操作，已有密钥继续可用。
 * 4. **同步只由用户显式触发**：P0 不注册任何后台定时器（见 §8 末段）。
 */

/** 声明式（L0）插件在插值里额外提供的键：指向 `apiKeyInput` 的值。 */
const API_KEY_TEMPLATE_KEY = 'apiKey'

/**
 * 同步结果。它比 `PluginRunResult` 更靠外一层：hook 的「说什么」在这里已经变成「落库落成什么」。
 */
export interface PluginSyncOutcome {
  key: string
  providerId: string
  credentialStatus: PluginSyncState['credentialStatus']
  credentialMessage: string | null
  actionUrl: string | null
  /** 本次新增与移除的模型数（界面据此说「同步到 12 个模型」）。 */
  addedModels: number
  removedModels: number
  modelCount: number
  logs: string[]
}

/** 同一插件的并发同步必须被打回：两次同时跑会在 diff 阶段互相把对方的行当成「消失的模型」删掉。 */
const inFlight = new Set<string>()

// ========== 启用 / 禁用 ==========

/**
 * 启用插件：写输入项 → 建/更新托管 Provider → 同步一次。
 *
 * 顺序不能倒：密钥先落进 SecretStore 再同步，hook 才能通过 `ctx.secrets.get` 拿到刚填的值；
 * 托管标记也要在同步前打好，否则同步过程中另一次调用会以为这个插件还没有 Provider。
 */
export async function enablePlugin(key: string, inputs?: Record<string, string>): Promise<PluginSyncOutcome> {
  const plugin = await loadPlugin(getPluginDirectory(), key)
  const providerId = await ensureManagedProvider(plugin)
  if (inputs !== undefined) await writePluginInputs(providerId, await splitInputs(plugin, providerId, inputs))
  return syncPlugin(key)
}

/**
 * 只改输入项，不碰同步。
 *
 * 界面上的「保存」与「同步」是两颗按钮：保存输入项（尤其是密钥）时常会失败（Key 写错、
 * OAuth 要重新授权），把它们揗在一步里，用户就没法「先把设置存下来、以后再调」。
 * 但**存完仍会跑一次同步**——否则用户改完端点模板、界面上没有任何东西变化，
 * 会以为没生效。
 */
export async function setPluginInputs(key: string, inputs: Record<string, string>): Promise<PluginSyncOutcome> {
  const plugin = await loadPlugin(getPluginDirectory(), key)
  const providerId = await ensureManagedProvider(plugin)
  await writePluginInputs(providerId, await splitInputs(plugin, providerId, inputs))
  return syncPlugin(key)
}

/**
 * 停用插件：删 Provider（级联软删模型/端点/绑定）+ 删调度策略 + 清密钥。
 *
 * `deleteProvider` **不清 `scheduling_policies`**（见 `./state.ts` 与 `provider-store.ts`）——
 * 那是代理规划真正读的一张表，不显式删就会留下一批指向已删模型的绑定，
 * 逻辑模型页上会看到一排「幽灵模型」。
 */
export async function disablePlugin(key: string): Promise<void> {
  const providerId = await findManagedProviderId(key)
  if (!providerId) return
  const provider = await getProvider(providerId)
  const state = await readPluginSyncState(providerId)
  const models = await listProviderModelRoutesByProvider(providerId)

  await cleanupSchedulingPolicies(models.map(model => model.id))
  await deleteProvider(providerId)
  if (provider) await getSecretStore().delete(provider.apiKeyReference)
  // 引用清单里的键逐个删：`SecretStore` 只能按引用取值，没有「列出这个插件写过什么」的接口，
  // 这份清单是唯一的回收依据（见 `PluginSyncState.secretReferences`）。
  for (const reference of state.secretReferences) await getSecretStore().delete(reference)
  await clearPluginSettings(providerId)
}

/**
 * 卸载插件：先停用（把落库的东西清干净），再删磁盘目录。
 *
 * 目录删除只允许删**插件目录里面**的东西：`key` 会被 `install` 成符号链接，
 * 直接 `rm -rf <pluginsDir>/<key>` 在某些平台上会穿透软链、把用户的源码仓库删掉。
 */
export async function uninstallPlugin(key: string): Promise<void> {
  await disablePlugin(key)
  await removePluginDirectory(getPluginDirectory(), key)
}

/** 重载：重读清单与 `entry.js`，然后按同一套规则同步一次（本地开发的热重载入口）。 */
export async function reloadPlugin(key: string): Promise<PluginSyncOutcome> {
  // 刻意什么都不缓存：worker 每次调用都重新读 `entry.js`（见 `./runner.ts`），
  // 所以「重载」= 直接再同步一次，不需要任何失效逻辑。
  await loadPlugin(getPluginDirectory(), key)
  return syncPlugin(key)
}

// ========== 同步 ==========

/**
 * 跑一次同步。已经是启用状态时由它负责「记账」；没有托管 Provider 时先建一个。
 *
 * 抛出的是 `PLUGIN_*` 领域错误（含 hook 崩溃与超时）。**它不会让已有的 Provider 变坏**：
 * 失败前写下去的东西一律先落成 state 里的读数，配置本身在 `obtainCredential` 成功那一步才动。
 */
export async function syncPlugin(key: string): Promise<PluginSyncOutcome> {
  if (inFlight.has(key)) throw pluginRunFailedError(key, 'sync', 'another sync for this plugin is already running')
  inFlight.add(key)
  try {
    const plugin = await loadPlugin(getPluginDirectory(), key)
    const providerId = await ensureManagedProvider(plugin)
    return await runSync(plugin, providerId)
  } finally {
    inFlight.delete(key)
  }
}

async function runSync(plugin: ScannedPlugin, providerId: string): Promise<PluginSyncOutcome> {
  const provider = await getProvider(providerId)
  if (!provider) throw pluginRunFailedError(plugin.key, 'sync', 'the managed Provider disappeared during the sync')

  const inputs = await readPluginInputs(providerId)
  const previous = await readPluginSyncState(providerId)
  const logs: string[] = []
  const writtenReferences = new Set(previous.secretReferences)
  /** 不变量：一次同步里「模型清单」最多被读一次，空清单也照样参与 diff（只是不删东西）。 */
  let credential: PluginCredentialResult = { status: 'ready', apiKey: '', endpointOverrides: undefined }
  let dynamicFields: PluginInputField[] = []
  let credentialStatus: PluginSyncState['credentialStatus'] = 'ok'
  let credentialMessage: string | null = null
  let actionUrl: string | null = null

  if (plugin.entryPath) {
    const result = await pluginRunner.runCredential({ plugin, hook: 'obtainCredential', inputs, providerId })
    for (const reference of result.secretReferences) writtenReferences.add(reference)
    pushLogs(logs, result.logs)
    if (result.missing) {
      // 有 `entry.js` 但没实现 `obtainCredential`：正常形态，交给下面的声明式回退。
      credential = await credentialFromManifest(plugin, provider.apiKeyReference)
    } else if (!result.value) {
      throw pluginRunFailedError(plugin.key, 'obtainCredential', 'the hook returned no value')
    } else {
      credential = result.value
    }
  } else {
    credential = await credentialFromManifest(plugin, provider.apiKeyReference)
  }

  if (credential.status === 'ready') {
    // 密钥与端点先写：`listModels` 的声明式回退要靠刚写下去的端点地址去拉清单。
    // `apiKey` 为空串表示「这个插件不需要密钥」（清单没声明 `apiKeyInput`，也没有 hook），
    // 此时保留用户可能已经填过的值，不要把已有的密钥冲掉。
    if (credential.apiKey) await getSecretStore().set(provider.apiKeyReference, credential.apiKey)
    await replaceProviderEndpoints(providerId, {
      ...(await resolveEndpoints(plugin, inputs, credential.endpointOverrides)),
      ...(credential.endpointOverrides ?? {}),
    })
  } else if (credential.status === 'input-required') {
    dynamicFields = credential.fields
    credentialStatus = 'input-required'
    credentialMessage = null
  } else if (credential.status === 'action-required') {
    credentialStatus = 'action-required'
    credentialMessage = credential.instruction
    actionUrl = credential.actionUrl ?? null
  } else {
    credentialStatus = 'error'
    credentialMessage = credential.message
  }

  // `input-required` 时**不拉模型清单**：密钥还没拿到，拉一次只会得到一堆 401，
  // 而且会把上一次成功的模型当成「上游现在没有了」去 diff（第 2 条规则的反面）。
  let addedModels = 0
  let removedModels = 0
  let modelCount = previous.modelCount
  if (credential.status === 'ready') {
    const models = await resolveModels(plugin, providerId, inputs, logs)
    if (models !== null) {
      const diff = await diffModels(providerId, models)
      addedModels = diff.added
      removedModels = diff.removed
      // 取库里的真实数量，而不是 `models.length`：空清单不删模型（第 2 条规则），
      // 若照清单长度记账，界面上会写「0 个模型」而库里的行还好端端地在参与调度。
      modelCount = diff.total
    }
  }

  const state: PluginSyncState = {
    credentialStatus,
    credentialMessage,
    actionUrl,
    credentialFields: dynamicFields,
    // 时间戳只记「跑过一次」，与成败无关：`lastSyncError` 才是成败的读数。
    lastSyncTime: Date.now(),
    lastSyncError: null,
    modelCount,
    // 用户填的密钥输入项也要记进去：它们不属于任何一次 hook 调用，但同样要能被卸载清掉。
    secretReferences: [...writtenReferences, ...secretInputReferences(plugin)],
  }
  await writePluginSyncState(providerId, state)
  return { key: plugin.key, providerId, credentialStatus, credentialMessage, actionUrl, addedModels, removedModels, modelCount, logs }
}

/**
 * 把一次同步的失败记进 state，然后把错误原样抛出去。
 *
 * 界面要两样东西：这次调用为什么失败（抛出的错误），以及「上次同步」那一栏该显示什么
 * （落盘的 `lastSyncError`）。少记一半，用户点完同步只看得到一句 toast，重进页面就什么都不知道了。
 */
export async function recordSyncFailure(key: string, error: unknown): Promise<void> {
  const providerId = await findManagedProviderId(key)
  if (!providerId) return
  const previous = await readPluginSyncState(providerId)
  await writePluginSyncState(providerId, {
    ...previous,
    lastSyncTime: Date.now(),
    lastSyncError: error instanceof Error ? error.message : String(error),
  })
}

// ========== 托管 Provider ==========

/**
 * 找这个插件托管的 Provider；没有就建一个并打上标记。
 *
 * 认的是 `plugin.key` 设置行而不是 Provider 名字：名字是用户在界面上能改的，
 * 改完插件就找不到自己的 Provider 了（会再建一条，用户改过的设置留在旧的那条上）。
 */
export async function ensureManagedProvider(plugin: ScannedPlugin): Promise<string> {
  const existing = await findManagedProviderId(plugin.key)
  if (existing) {
    // 名字跟着清单走：用户在清单里改了 `providerName`，同步一次就该看到新名字。
    // `description` 同理——它是界面上这个供应商的说明，插件应当能维护它。
    const provider = await getProvider(existing)
    const name = plugin.manifest.providerName ?? plugin.manifest.name
    if (provider && (provider.name !== name || provider.description !== plugin.manifest.description)) {
      await updateProvider(existing, { name, description: plugin.manifest.description })
    }
    return existing
  }
  const provider = await createProvider({
    name: plugin.manifest.providerName ?? plugin.manifest.name,
    description: plugin.manifest.description,
    apiKeyReference: generateKeyReference('plugin_'),
    timeoutMilliseconds: plugin.manifest.timeoutMilliseconds,
  })
  await markManagedProvider(provider.id, plugin.key)
  return provider.id
}

// ========== 输入项 ==========

/**
 * 输入项分流：`secret: true` 的进 SecretStore，其余进 `plugin.inputs`。
 *
 * 空值的处理是**按字段不同**的：密钥项填空 = 删掉那条密钥（用户想清掉它）；
 * 普通项填空 = 从 JSON 里移除该键（等价于没填，`{{key}}` 保持未插值形态）。
 */
export async function splitInputs(plugin: ScannedPlugin, providerId: string, raw: Record<string, string>): Promise<Record<string, string>> {
  const secretFields = new Set(plugin.manifest.inputs.filter(field => field.secret).map(field => field.key))
  const values: Record<string, string> = await readPluginInputs(providerId)
  for (const [key, value] of Object.entries(raw)) {
    if (secretFields.has(key)) {
      // 密钥项**不区分空串与未填**：界面回的是「已设置」占位符（它拿不到明文），
      // 把它当新值写下去，用户下次同步就会拿到一串圆点。要改密钥就填新值，要清就留空。
      if (isSecretPlaceholder(value)) continue
      const reference = pluginSecretReference(plugin.key, 'input', key)
      if (value.length === 0) await getSecretStore().delete(reference)
      else await getSecretStore().set(reference, value)
      continue
    }
    const trimmed = value.trim()
    if (trimmed.length === 0) delete values[key]
    else values[key] = value
  }
  return values
}

/** 密钥项的占位符：界面只能拿到它，见 `management/routes/operations/plugins.ts`。 */
function isSecretPlaceholder(value: string): boolean {
  return value.length > 0 && /^[\u2022\u25cf\*]+$/.test(value)
}

/** 用户填的密钥项的引用；它们不在任何一次 hook 的返回值里，得单独算出来记账。 */
function secretInputReferences(plugin: ScannedPlugin): string[] {
  return plugin.manifest.inputs
    .filter(field => field.secret)
    .map(field => pluginSecretReference(plugin.key, 'input', field.key))
}

/** 读一个密钥输入项的当前值（明文），供同步时写进 Provider 的密钥引用。 */
async function readSecretInput(plugin: ScannedPlugin, name: string): Promise<string | null> {
  return getSecretStore().get(pluginSecretReference(plugin.key, 'input', name))
}

// ========== 凭据：声明式回退 ==========

/**
 * 没有 hook（L0）时怎么拿凭据：拿清单声明的 `apiKeyInput` 里用户填的值。
 *
 * 没填就回 `input-required`（**不是** `failed`）：这是中间态，界面据此给出「去填一下」的入口，
 * 而不是一句无从下手的错误。判断规则与界面同源（见 `state.ts` 的 `missingRequiredInputs`），
 * 但落到这里的是「密钥项」那一档——其余必填项交给端点的模板剔除规则处理（见 `resolveEndpoints`）。
 */
async function credentialFromManifest(plugin: ScannedPlugin, apiKeyReference: string): Promise<PluginCredentialResult> {
  const key = plugin.manifest.apiKeyInput
  if (!key) {
    // 不需要密钥的插件（纯公开接口的聚合源）：把 Provider 的密钥引用清空，
    // 免得它带着上一次的旧 Key 去请求。留空串即可，读取侧会拿到 `''`。
    await getSecretStore().delete(apiKeyReference)
    return { status: 'ready', apiKey: '' }
  }
  const value = await readSecretInput(plugin, key)
  if (!value) {
    // 用户在设置页还没填这个密钥项：把它报成缺输入。用 `input-required` 而不是 `failed`，
    // 界面才会给出「去填一下」的入口，而不是一句无从下手的错误。
    const field = plugin.manifest.inputs.find(candidate => candidate.key === key)
    return { status: 'input-required', fields: [field ?? { key, label: key, type: 'password', required: true, secret: true }] }
  }
  return { status: 'ready', apiKey: value }
}

// ========== 端点 ==========

/**
 * 清单端点模板 → 协议 → URL。
 *
 * 缺插值的项被**剔除**而不是原样写入：`{{serverUrl}}` 变成一个非法 URL 会让
 * `replaceProviderEndpoints` 撞上 `ProviderEndpointSchema` 的 `z.string().url()`，
 * 用户看到一条通用的校验错误，而真正的错因是「哪个输入没填」——这一点由
 * `hasUnresolvedTemplate`（供需要前置判断的调用方使用）与同步内回 `input-required` 共同兜住。
 */
async function resolveEndpoints(plugin: ScannedPlugin, inputs: Record<string, string>, overrides?: Partial<Record<Protocol, string>>): Promise<Partial<Record<Protocol, string>>> {
  const values = await templateValues(plugin, inputs)
  const endpoints: Partial<Record<Protocol, string>> = {}
  for (const [protocol, template] of Object.entries(plugin.manifest.endpoints)) {
    const url = interpolateTemplate(template, values).trim()
    if (url.length === 0 || hasUnresolvedTemplate(url)) continue
    endpoints[protocol as Protocol] = url
  }
  for (const [protocol, url] of Object.entries(overrides ?? {})) {
    if (typeof url === 'string' && url.trim().length > 0) endpoints[protocol as Protocol] = url.trim()
  }
  return endpoints
}

/** 模板可用的键：用户填的非密钥项 + 密钥项（按 `apiKeyInput` 暴露成 `{{apiKey}}`）。 */
async function templateValues(plugin: ScannedPlugin, inputs: Record<string, string>): Promise<Record<string, string>> {
  const values: Record<string, string> = { ...inputs }
  if (plugin.manifest.apiKeyInput) {
    const secret = await readSecretInput(plugin, plugin.manifest.apiKeyInput)
    if (secret) values[API_KEY_TEMPLATE_KEY] = secret
  }
  return values
}

// ========== 模型清单 ==========

/**
 * 拿模型清单：优先 hook，其次声明式的 `models` 地址。
 *
 * 返回 `null` 表示「这一次没拿到」（无 hook 也无 `models` 声明）——**与空数组不同**：
 * 空数组是一次成功的「上游现在没有模型」，会参与 diff；`null` 表示这次不参与，
 * 已有模型保持原样。
 */
async function resolveModels(plugin: ScannedPlugin, providerId: string, inputs: Record<string, string>, logs: string[]): Promise<PluginModelListing[] | null> {
  if (plugin.entryPath) {
    const result = await pluginRunner.runListModels({ plugin, hook: 'listModels', inputs, providerId })
    pushLogs(logs, result.logs)
    if (!result.missing) return result.value ? result.value.models : null
  }
  const spec = plugin.manifest.models
  if (!spec) return null
  return await fetchManifestModels(plugin, providerId, inputs, spec)
}

/**
 * 声明式拉取模型清单。
 *
 * 地址由模板插值得到（`{{serverUrl}}/v1/models`），鉴权用 Provider 当前的密钥引用——
 * 也就是刚才 `obtainCredential` 写下去的那把 Key。走 `coreNetworkClient`，
 * 因此与代理共用同一套出站代理设置（插件的唯一出站口，见 §12）。
 */
async function fetchManifestModels(plugin: ScannedPlugin, providerId: string, inputs: Record<string, string>, spec: NonNullable<PluginManifest['models']>): Promise<PluginModelListing[] | null> {
  const values = await templateValues(plugin, inputs)
  const url = interpolateTemplate(spec.url, values).trim()
  const headers: Record<string, string> = { Accept: 'application/json' }
  for (const [name, template] of Object.entries(spec.headers)) headers[name] = interpolateTemplate(template, values)
  const provider = await getProvider(providerId)
  const apiKey = provider ? await getSecretStore().get(provider.apiKeyReference) : null
  if (apiKey) {
    // 与 `provider/fetch-models` 同一套鉴权口径：声明式插件不需要知道该用哪个头部名。
    headers.Authorization = `Bearer ${apiKey}`
  }

  // 先把用户写的地址当成 URL 验一次：不合法就在这里给一句「地址不对」，
  // 而不是让它落到 `requestModelList` 里被 catch 成「地址都不通」（那个错误会让人去查网络）。
  if (!isHttpUrl(url)) throw pluginRunFailedError(plugin.key, 'listModels', `the models url is not a valid URL: ${url}`)
  // 与 `provider/fetch-models` 一样多探几个候选地址（用户填的可能是 base、带 /v1、或完整 chat 地址）：
  // 声明式插件里最容易错的就是这个地址，而多试一次几乎不花钱。
  const candidates = spec.method === 'GET' && Object.keys(spec.headers).length === 0 ? [url, ...buildModelListUrls(url).filter(candidate => candidate !== url)] : [url]
  for (const candidate of candidates) {
    const response = await requestModelList(candidate, spec, headers, plugin.manifest.timeoutMilliseconds)
    if (response === null) continue
    const models = parseModelList(plugin, spec, response)
    if (models !== null) return models
  }
  throw pluginRunFailedError(plugin.key, 'listModels', 'the models endpoint did not return a recognizable model list')
}

/** 只接受 http/https 的绝对地址；`new URL` 对 `{{x}}/v1/models` 这类未插值的字符串也会“成功”。 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * 取一次模型清单原文；非 2xx 与网络错误都返回 `null`（由调用方决定要不要试下一个地址）。
 *
 * 这里刻意**不抛**：一个地址失败不代表这件事失败，抛出去会让「多试几个候选」这个想法落空。
 * 全都失败时由调用方给一句统一的错误。
 */
async function requestModelList(url: string, spec: NonNullable<PluginManifest['models']>, headers: Record<string, string>, timeoutMilliseconds: number): Promise<string | null> {
  const parsed = new URL(url)
  try {
    const response = await coreNetworkClient.requestHttpBuffered(parsed, {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: spec.method,
      headers,
      timeout: timeoutMilliseconds,
    }, spec.body === undefined ? Buffer.alloc(0) : Buffer.from(spec.body, 'utf8'))
    if (response.statusCode < 200 || response.statusCode >= 300) return null
    return response.body
  } catch {
    return null
  }
}

/**
 * 解析模型清单。
 *
 * 声明的 `path`（如 `data[].id`）优先；没声明就退到 `parseModelListResponse` 的常见形状
 * （OpenAI 的 `data[].id`、Anthropic 的 `data[].id`）。`path` 存在的意义是**让用户
 * 能描述一个现有解析器不认识的形状**（例如 `models[].name`），而不是替代它。
 */
function parseModelList(plugin: ScannedPlugin, spec: NonNullable<PluginManifest['models']>, body: string): PluginModelListing[] | null {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  if (spec.path) {
    const extracted = extractByPath(json, spec.path)
    if (extracted !== null) return extracted.map(id => ({ id }))
    // 声明了 `path` 但取不到：**不静默回退**。用户写了路径却被忽略，比报错更难查。
    throw pluginRunFailedError(plugin.key, 'listModels', `the response does not match the declared path: ${spec.path}`)
  }
  const models = parseModelListResponse(body)
  return models === null ? null : models.map(model => ({ id: model.id, name: model.displayName ?? undefined }))
}

/**
 * `data[].id` / `models[].name` / `[].id` 这种取值路径。
 *
 * 语法只有两种成分：**段名**与**数组展开**（`[]`）。不引入 JSONPath 之类的依赖：
 * 插件清单是用户写的，多一种语法就多一处要解释、要多一种报错。
 */
function extractByPath(json: unknown, path: string): string[] | null {
  const segments = path.split('.').map(segment => segment.trim()).filter(segment => segment.length > 0)
  const results: string[] = []
  let current: unknown[] = [json]
  for (const segment of segments) {
    const isArray = segment.endsWith('[]')
    const name = isArray ? segment.slice(0, -2) : segment
    const next: unknown[] = []
    for (const node of current) {
      if (name.length === 0) next.push(node)
      else if (node !== null && typeof node === 'object' && name in (node as Record<string, unknown>)) next.push((node as Record<string, unknown>)[name])
      else return null
    }
    current = isArray ? next.flatMap(node => Array.isArray(node) ? node : []) : next
  }
  for (const node of current) {
    if (typeof node === 'string' && node.trim().length > 0) results.push(node.trim())
  }
  return results.length > 0 ? results : null
}

// ========== 模型 diff ==========

/**
 * 把清单与库里的模型对比，增删到一致。
 *
 * **空清单不走这一步**（调用方已挡住）：一次上游抖动返回空数组就把用户的模型全删掉，
 * 是这套机制里最不可接受的失败形态（见 §5 的失败语义）。反过来，「上游真的下架了某个模型」
 * 时它确实会消失——那是非空清单里的一个洞，按规则删。
 *
 * 返回的 `total` 是 diff 之后库里应有的模型数（含之前就有的）：它是界面与 `plugin.state`
 * 要的那个读数，照清单长度取会在「空清单没删东西」时自相矛盾。
 */
async function diffModels(providerId: string, listings: PluginModelListing[]): Promise<{ added: number; removed: number; total: number }> {
  const desired = new Map(listings.map(listing => [listing.id, listing]))
  const existing = await listProviderModelRoutesByProvider(providerId)
  const existingByName = new Map(existing.map(model => [model.modelName, model]))

  let added = 0
  let index = 0
  const logicalModelRecordId = desired.size > 0 ? await getDefaultLogicalModelRecordId() : null
  for (const [id] of desired) {
    const current = existingByName.get(id)
    // 已存在的模型**完全不动**：`priority` 可能被用户手调过（它决定同一逻辑模型内
    // 这个供应商的选中顺序），插件同步把它按清单顺序重排，等于每次同步都推翻用户的调整。
    if (current) continue
    // `priority` 只按「本次新增的第几个」编号，不把已存在的算进去：跳过它们会让新模型的
    // priority 出现空洞（1、5、9…），而调度策略里的 priority 是直接比较大小的。
    index += 1
    // 端点留空走供应商默认地址（与 `provider/fetch-models` 建模型的形态一致）：
    // 插件的端点声明是**供应商级**的，逐模型复制一份会让「换地址」变成一件要改 N 行的事。
    const model = await createProviderModelRoute({ providerId, modelName: id, priority: index, enabled: true, endpoints: [] })
    if (logicalModelRecordId) {
      // 新模型的第一条绑定跟着模型本体走，priority 用清单顺序：上游给的顺序就是它的推荐顺序。
      await upsertSchedulingPolicy({ logicalModelId: logicalModelRecordId, providerModelId: model.id, priority: index, enabled: true })
    }
    added += 1
  }

  let removed = 0
  // 清单非空时的「消失」才算消失（上面已挡住空清单）；这里再确认一次 desired.size > 0，
  // 是因为 `diffModels` 也可能被别处调用，不变量写在这里比写在心里可靠。
  if (desired.size > 0 && logicalModelRecordId) {
    for (const model of existing) {
      if (desired.has(model.modelName)) continue
      await deleteProviderModelRoute(model.id)
      await deleteSchedulingPolicy(logicalModelRecordId, model.id)
      removed += 1
    }
  }
  return { added, removed, total: existing.length + added - removed }
}

/** 删一批模型在默认逻辑模型上的调度绑定。停用/卸载时用；`deleteProviderModelRoute` 已经处理了别的表。 */
async function cleanupSchedulingPolicies(modelIds: string[]): Promise<void> {
  if (modelIds.length === 0) return
  const logicalModelRecordId = await getDefaultLogicalModelRecordId()
  for (const modelId of modelIds) await deleteSchedulingPolicy(logicalModelRecordId, modelId)
}

function pushLogs(logs: string[], incoming: string[]): void {
  for (const line of incoming) {
    if (logs.length >= PLUGIN_SYNC_LOG_LIMIT) return
    logs.push(line)
  }
}

/** 一次同步最多带回多少行插件日志：两次 hook（凭据 + 模型）的日志合起来也不能把响应撑爆。 */
const PLUGIN_SYNC_LOG_LIMIT = 100
