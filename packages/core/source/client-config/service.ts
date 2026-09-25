import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AGENT_CLIENT_DEFINITIONS, agentClientFieldsOfFile, findAgentClient, findAgentClientFile, type AgentClientDefinition, type AgentClientFileDefinition } from '@common/clients'
import { CLIENT_CONFIG_SAMPLE_API_KEY } from '@common/client-config'
import type {
  ClientConfigApplyResult,
  ClientConfigChange,
  ClientConfigCoverage,
  ClientConfigFileState,
  ClientConfigFillResultItem,
  ClientConfigOverviewItem,
  ClientConfigPreviewResult,
  ClientConfigVersion,
  ClientConfigVersionEntry,
  ClientConfigVersionOrigin,
  ClientConfigWriteResult,
} from '@common/client-config'
import { resolveProxyOrigin } from '@common/proxy-origin'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME } from '@common/schemas'
import { AppError } from '../errors'
import {
  getClientConfigVersion,
  hashClientConfigContent,
  listClientConfigVersionsWithContent,
  saveClientConfigVersion,
  summarizeClientConfigVersions,
} from '../database/client-config-version-store'
import { getSettings } from '../database/settings-store'
import { ConfigParseError, createConfigEditor, supportsAutoFill, type ConfigEditor } from './formats'
import { resolveClientConfigPath } from './paths'
import { concreteProviderEntryPath, getClientApplyRule, resolveFieldValue, stripModelPrefix, type ClientApplyContext, type ClientApplyRule, type ClientFieldRole } from './rules'
import { diffClientConfigContent } from './version-diff'

export interface ClientConfigTarget {
  clientKey: string
  filePath: string
  resolvedPath: string
  file: AgentClientFileDefinition
}

/**
 * 自动填充的入参——就是 HTTP 请求体里除「文件定位」外的部分。
 *
 * 只有模型是调用方给的：地址与密钥由 `resolveClientConfigDefaults()` 就地填上，
 * 与「一键生效」用的是同一个来源。
 *
 * 与 `ClientApplyContext` 的差别只在 `smallModel`：这里是用户填的原文（可空），
 * 那里是回落主模型后的最终值，写配置时只认后者。
 */
export interface ClientApplyValues {
  baseUrl: string
  apiKey: string
  model: string
  smallModel?: string
}

/**
 * 「按本地服务改写」时**调用方唯一能决定的事**：模型名。
 *
 * 地址与密钥不在其中，因为客户端要指向的就是本机服务本身（见 `ClientConfigApplyRequestSchema`）。
 */
export interface ClientApplyOverrides {
  model: string
  smallModel?: string
}

/**
 * 解析目标文件。**这是唯一的入口**：客户端 key 与文件路径都必须与注册表逐字对上，
 * 否则一律拒绝——管理 API 没有鉴权，能把任意路径写进用户磁盘就等于把整个磁盘交出去。
 */
export function resolveClientConfigTarget(clientKey: string, filePath: string): ClientConfigTarget {
  const file = findAgentClientFile(clientKey, filePath)
  const resolvedPath = resolveClientConfigPath(clientKey, filePath)
  if (!file || !resolvedPath) {
    throw new AppError('CLIENT_CONFIG_PATH_NOT_ALLOWED', 400, `Config file is not writable: ${filePath}`, {
      details: { path: filePath },
    })
  }
  return { clientKey, filePath, resolvedPath, file }
}

async function readRaw(path: string): Promise<{ exists: boolean; content: string; modifiedTime: number | null }> {
  try {
    const [content, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    return { exists: true, content, modifiedTime: info.mtimeMs }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, content: '', modifiedTime: null }
    throw error
  }
}

/** 读一个文件的当前状态：内容、摘要、能否自动填充、以及回读到的现有值。只读，不碰文件。 */
export async function readClientConfigFile(clientKey: string, filePath: string): Promise<ClientConfigFileState> {
  const target = resolveClientConfigTarget(clientKey, filePath)
  const client = findAgentClient(clientKey)!
  const raw = await readRaw(target.resolvedPath)
  const contentHash = hashClientConfigContent(raw.content)

  const base = {
    clientKey,
    filePath,
    resolvedPath: target.resolvedPath,
    format: target.file.format,
    exists: raw.exists,
    content: raw.content,
    contentHash,
    sizeBytes: Buffer.byteLength(raw.content, 'utf8'),
    modifiedTime: raw.modifiedTime,
  }

  // 顺序即优先级：没有配方就没有「该填什么」这一说，格式能不能解析都无关。
  const rule = getClientApplyRule(clientKey)
  if (!rule) return { ...base, autoFill: 'unsupported-client', detected: {} }
  if (!supportsAutoFill(target.file.format)) return { ...base, autoFill: 'unsupported-format', detected: {} }

  const fields = agentClientFieldsOfFile(client, filePath)

  let editor
  try {
    editor = createConfigEditor(target.file.format, raw.content)
  } catch (error) {
    if (error instanceof ConfigParseError) return { ...base, autoFill: 'unparsable', detected: {} }
    throw error
  }

  // 只回读**标量**字段：对象字段（provider 表项）在界面上没法当一个输入框用，
  // 回读出来也只会是一串 JSON，徒增误解。
  const detected: Record<string, string> = {}
  for (const field of fields) {
    const value = editor.get(field.path)
    if (value !== null) detected[field.key] = value
  }

  return { ...base, autoFill: 'ready', detected }
}

/** 同目录临时文件 + rename，避免写到一半崩溃留下半个配置文件。 */
async function writeAtomic(path: string, content: string): Promise<void> {
  const temporaryPath = join(dirname(path), `.${path.split(/[\\/]/).pop()}.osw-tmp`)
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw new AppError('CLIENT_CONFIG_WRITE_FAILED', 500, `Could not write ${path}: ${(error as Error).message}`, {
      details: { path, message: (error as Error).message },
      cause: error,
    })
  }
}

/**
 * 「提交前先备份，再落盘」——三个写入口（自动填充 / 手动编辑 / 恢复历史）共用这一条路径，
 * 保证不会有哪个入口绕开备份。
 *
 * 备份幂等由 `saveClientConfigVersion` 保证：内容没变过就只有一个版本。
 */
async function commitClientConfig(target: ClientConfigTarget, nextContent: string, origin: ClientConfigVersionOrigin, note?: string): Promise<ClientConfigWriteResult> {
  const current = await readRaw(target.resolvedPath)
  const backedUp = saveClientConfigVersion({
    clientKey: target.clientKey,
    filePath: target.filePath,
    content: current.content,
    origin,
    note,
  })

  if (nextContent !== current.content) await writeAtomic(target.resolvedPath, nextContent)

  return { state: await readClientConfigFile(target.clientKey, target.filePath), backedUp }
}

/** 手动保存（用户在下方直接编辑内容）。 */
export async function saveClientConfigContent(clientKey: string, filePath: string, content: string, note?: string): Promise<ClientConfigWriteResult> {
  const target = resolveClientConfigTarget(clientKey, filePath)
  return commitClientConfig(target, content, 'manual', note)
}

function assertHttpBaseUrl(baseUrl: string): void {
  if (!/^https?:\/\//.test(baseUrl)) {
    // 只接受完整 URL：写进客户端配置的地址会被真实请求打出去，
    // 一个缺 scheme 的地址会在 CLI 里变成一个语焉不详的报错。
    throw new AppError('VALIDATION_ERROR', 400, `Base URL must start with http:// or https://: ${baseUrl}`, {
      details: { baseUrl },
    })
  }
}

/**
 * 一次「改动」的完整打算：改了哪些键，以及改完之后文件该长什么样。
 *
 * 两者必须一起算出来：分开算就要把编辑器里的改动跑第二遍，白白多一次解析，
 * 也多一处可能不一致的地方。
 */
interface ClientConfigPlan {
  changes: ClientConfigChange[]
  nextContent: string
}

/**
 * 把客户端配置改成指到本地服务，**只算不写**。
 *
 * 抽出来是为了让「一键生效」、列表页的覆盖状态与界面上的预览共用同一条判断：
 * 列表说「已生效」的定义就是这里算出来的改动为空，界面显示「下面会变成这样」
 * 用的也正是这里的 `nextContent`。否则状态、预览与按钮迟早会各说各话。
 *
 * 基线是**调用方给的文本**而不是就地读盘：预览要的是「这段内容 + 这些值 = 什么」，
 * 让调用方决定拿哪段内容来算，读盘只剩调用方那一步。
 */
function planClientConfigChanges(target: ClientConfigTarget, text: string, values: ClientApplyValues, rule: ClientApplyRule, client: AgentClientDefinition): ClientConfigPlan {
  assertHttpBaseUrl(values.baseUrl)

  const context: ClientApplyContext = {
    baseUrl: values.baseUrl,
    apiKey: values.apiKey,
    model: values.model,
    // 小模型留空就回落主模型：留一个空串写进配置，客户端会当成「没有模型」而不是「用默认的」。
    smallModel: values.smallModel?.trim() ? values.smallModel : values.model,
  }

  const fields = agentClientFieldsOfFile(client, target.filePath)

  let editor
  try {
    editor = createConfigEditor(target.file.format, text)
  } catch (error) {
    if (error instanceof ConfigParseError) {
      throw new AppError('CLIENT_CONFIG_PARSE_FAILED', 400, `Cannot parse ${target.filePath} as ${target.file.format}`, {
        details: { format: target.file.format },
        cause: error,
      })
    }
    throw error
  }

  const changes: ClientConfigChange[] = []
  const record = (path: string, before: string | null, after: string) => {
    if (before === after) return
    changes.push({ path, before, after })
  }

  for (const field of fields) {
    const role = rule.roles[field.key]
    if (!role || role === 'providerEntry') continue
    const value = resolveFieldValue(role, context, rule)
    if (value === null) continue
    const before = editor.get(field.path)
    const after = String(value)
    if (before === after) continue
    editor.set(field.path, value)
    record(field.path, before, after)
  }

  if (rule.providerEntry) {
    const path = concreteProviderEntryPath(rule)
    const owned = path !== null && fields.some(field => rule.roles[field.key] === 'providerEntry')
    if (path && owned) {
      const entry = rule.providerEntry.build(context)
      // 对象字段没有标量可读（`get` 对对象返回 null），所以只能拿整份文本比：
      // 不变就不算改动，否则「已生效」的客户端会永远显示成待写入。
      const snapshot = editor.serialize()
      editor.setObject(path, entry)
      if (editor.serialize() !== snapshot) {
        // 对象字段没法用「前后两个字符串」讲清楚，这里只承诺「这一项被整体重写了」。
        record(path, null, JSON.stringify(entry))
      }
    }
  }

  return { changes, nextContent: editor.serialize() }
}

/**
 * 把客户端配置直接指到本地服务。
 *
 * 地址与密钥由 `resolveClientConfigDefaults()` 就地取（用户不需要、也无法在这里指定它们），
 * 调用方只给模型名。只改**属于本次目标文件**的字段：Gemini CLI 的模型在 settings.json、
 * 地址与密钥在 .env，往 `.env` 里写 `model` 会写出一个工具根本不读的键。
 */
export async function applyClientConfigOverrides(clientKey: string, filePath: string, overrides: ClientApplyOverrides): Promise<ClientConfigApplyResult> {
  const target = resolveClientConfigTarget(clientKey, filePath)
  const client = findAgentClient(clientKey)!
  const rule = getClientApplyRule(clientKey)
  if (!rule) {
    // 界面在 `autoFill === 'unsupported-client'` 时不会给出这个按钮，这里是兜底。
    throw new AppError('CLIENT_CONFIG_CLIENT_NOT_SUPPORTED', 400, `Automatic filling is not available for ${client.name}`, {
      details: { clientName: client.name },
    })
  }

  const defaults = await resolveClientConfigDefaults()
  const values: ClientApplyValues = { baseUrl: defaults.origin, apiKey: defaults.apiKey, model: overrides.model, smallModel: overrides.smallModel }
  const raw = await readRaw(target.resolvedPath)
  const plan = planClientConfigChanges(target, raw.content, values, rule, client)
  // 一处都不用改就直接返回：没有改动就不该落盘，也不该多出一个版本，
  // 否则反复点按钮会往历史里塞一堆内容相同的记录。
  if (plan.changes.length === 0) {
    return { state: await readClientConfigFile(clientKey, filePath), backedUp: null, changes: [] }
  }

  const result = await commitClientConfig(target, plan.nextContent, 'apply')
  return { ...result, changes: plan.changes }
}

/**
 * 「这些模型值写进去之后，这份文件会长成什么样」——只算不写，**不产生版本、不碰磁盘**。
 *
 * 与 `applyClientConfigOverrides` 是同一个规划的两个用法：那边算完就落盘，这边只把结果交回界面。
 * 界面拿它渲染下方的内容，用户改模型/切文件时看到的就是「如果现在保存，文件会变成这样」。
 */
export async function previewClientConfigOverrides(clientKey: string, filePath: string, overrides: ClientApplyOverrides): Promise<ClientConfigPreviewResult> {
  const target = resolveClientConfigTarget(clientKey, filePath)
  const client = findAgentClient(clientKey)!
  const rule = getClientApplyRule(clientKey)
  if (!rule) {
    throw new AppError('CLIENT_CONFIG_CLIENT_NOT_SUPPORTED', 400, `Automatic filling is not available for ${client.name}`, {
      details: { clientName: client.name },
    })
  }

  const defaults = await resolveClientConfigDefaults()
  const values: ClientApplyValues = { baseUrl: defaults.origin, apiKey: defaults.apiKey, model: overrides.model, smallModel: overrides.smallModel }
  const raw = await readRaw(target.resolvedPath)
  const plan = planClientConfigChanges(target, raw.content, values, rule, client)
  return { content: plan.nextContent, changes: plan.changes }
}

/**
 * 某个文件的版本列表。
 *
 * 每条的摘要都带「与当前文件相比改了哪几行」：列表原来显示这一版开头的若干字符，
 * 而配置文件的开头往往只是一个 `{`，于是八条历史长得一模一样、谁也没说出自己是什么。
 * 算差异要把当前文件读出来（个别时候读不到，就当空内容——那正好把这一版写着的行全列出来），
 * 所以这个函数是 async 的。只读文件：不写、不产生新版本。
 */
export async function listClientConfigFileVersions(clientKey: string, filePath: string): Promise<ClientConfigVersionEntry[]> {
  const target = resolveClientConfigTarget(clientKey, filePath)
  const versions = listClientConfigVersionsWithContent(clientKey, filePath)
  const raw = await readRaw(target.resolvedPath)
  return versions.map(version => {
    const { content, ...summary } = version
    return { ...summary, diff: diffClientConfigContent(raw.content, content) }
  })
}

/** 读取某个历史版本的完整内容（界面展开预览用）。 */
export function readClientConfigVersion(id: string): ClientConfigVersion | null {
  return getClientConfigVersion(id)
}

/** 把文件回退到某个历史版本；回退前同样先备份当前内容。 */
export async function restoreClientConfigVersion(clientKey: string, filePath: string, versionId: string): Promise<ClientConfigWriteResult> {
  const target = resolveClientConfigTarget(clientKey, filePath)
  const version = getClientConfigVersion(versionId)
  if (!version) {
    throw new AppError('NOT_FOUND', 404, `Config version not found: ${versionId}`, { details: { path: versionId } })
  }
  if (version.clientKey !== clientKey || version.filePath !== filePath) {
    throw new AppError('VALIDATION_ERROR', 400, `Config version ${versionId} does not belong to ${filePath}`, {
      details: { path: filePath },
    })
  }
  return commitClientConfig(target, version.content, 'restore')
}

// ========== 列表页与一键生效 ==========

/**
 * 「本机服务给客户端的那套固定值」——地址、密钥、兜底模型。
 *
 * 地址取自本机监听设置而不是界面：写进客户端配置的地址就是我们自己，
 * 用户没有第二选择，所以「一键生效」与详情页的直接改写都从这里取，不经过请求体。
 * 密钥是那个固定的样例值（本地服务不校验鉴权），模型是内置默认逻辑模型
 * ——只在文件里读不到模型名时才用得上。
 */
interface ClientConfigDefaults {
  origin: string
  apiKey: string
  model: string
}

async function resolveClientConfigDefaults(): Promise<ClientConfigDefaults> {
  const settings = await getSettings()
  const origin = resolveProxyOrigin(settings.listenHost, settings.listenPort)
  if (!origin) {
    throw new AppError('VALIDATION_ERROR', 400, `Local service address is not available: ${settings.listenHost}:${settings.listenPort}`)
  }
  return { origin, apiKey: CLIENT_CONFIG_SAMPLE_API_KEY, model: BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME }
}

/** 这个客户端的哪些文件会被自动填充碰到：有角色声明的字段，才说明这里有可写的键。 */
function writableClientConfigFiles(client: AgentClientDefinition, rule: ClientApplyRule): AgentClientFileDefinition[] {
  return client.files.filter(file => agentClientFieldsOfFile(client, file.path).some(field => rule.roles[field.key] !== undefined))
}

/**
 * 一键生效要写进这个文件的值。
 *
 * 地址与密钥是我们的既定事实，覆盖没商量；**模型名沿用文件里已有的**——模型选择是用户自己的
 * 取舍（本地服务不校验模型名，任何非空名字都能透传），我们只负责把「还没填」的补上。
 * 读不出来（格式不支持、语法坏了、字段不在这个文件里）就落回兜底值。
 */
async function clientConfigFillValues(target: ClientConfigTarget, client: AgentClientDefinition, rule: ClientApplyRule, defaults: ClientConfigDefaults): Promise<ClientApplyValues> {
  const values: ClientApplyValues = { baseUrl: defaults.origin, apiKey: defaults.apiKey, model: defaults.model }
  if (!supportsAutoFill(target.file.format)) return values

  const raw = await readRaw(target.resolvedPath)
  if (!raw.exists) return values

  let editor: ConfigEditor
  try {
    editor = createConfigEditor(target.file.format, raw.content)
  } catch {
    // 内容坏了是「读不到」，不是「写不了」：兜底值照样写，语法错误会在规划那一步被报出来。
    return values
  }

  const fields = agentClientFieldsOfFile(client, target.filePath)
  const read = (role: ClientFieldRole): string | null => {
    const field = fields.find(item => rule.roles[item.key] === role)
    const value = field ? editor.get(field.path) : null
    return value && value.trim() ? stripModelPrefix(rule, value) : null
  }

  const model = read('model')
  if (model) values.model = model
  const smallModel = read('smallModel')
  if (smallModel) values.smallModel = smallModel
  return values
}

interface ClientConfigCoverageReport {
  coverage: ClientConfigCoverage
  pendingChanges: number
}

/**
 * 这个客户端现在被覆盖到什么程度。
 *
 * 判据是一次 dry run（见 `planClientConfigChanges`），所以「已生效」和「点一下会改几处」
 * 说的是同一件事，界面上的状态不会和按钮的真实行为打架。解析不了的文件算「不可自动生效」
 * （`unavailable`）——那确实是要用户先动手的种类。
 */
async function readClientConfigCoverage(client: AgentClientDefinition, defaults: ClientConfigDefaults): Promise<ClientConfigCoverageReport> {
  const rule = getClientApplyRule(client.key)
  if (!rule) return { coverage: 'unavailable', pendingChanges: 0 }
  const files = writableClientConfigFiles(client, rule)
  if (files.length === 0) return { coverage: 'unavailable', pendingChanges: 0 }

  let pendingChanges = 0
  let exists = false
  for (const file of files) {
    const target = resolveClientConfigTarget(client.key, file.path)
    const raw = await readRaw(target.resolvedPath)
    if (raw.exists) exists = true
    try {
      const values = await clientConfigFillValues(target, client, rule, defaults)
      const plan = planClientConfigChanges(target, raw.content, values, rule, client)
      pendingChanges += plan.changes.length
    } catch {
      return { coverage: 'unavailable', pendingChanges }
    }
  }

  if (!exists) return { coverage: 'absent', pendingChanges }
  return pendingChanges === 0 ? { coverage: 'applied', pendingChanges: 0 } : { coverage: 'pending', pendingChanges }
}

/**
 * 列表页要的「一个客户端一行」。
 *
 * 组装在服务端而不是让界面循环调 8 次 `/get`：`coverage` 需要跑 dry run，那是只有 core
 * 才知道的事（配方、默认值、磁盘）。界面只负责把 `—` 和徽标摆好。
 */
export async function listClientConfigOverview(): Promise<ClientConfigOverviewItem[]> {
  const defaults = await resolveClientConfigDefaults()
  const items: ClientConfigOverviewItem[] = []
  for (const client of AGENT_CLIENT_DEFINITIONS) {
    const primary = client.files[0]
    if (!primary) continue
    // 主文件的状态就是这一行的状态：多文件的客户端（Gemini CLI）在详情页里再看逐文件。
    const state = await readClientConfigFile(client.key, primary.path)
    const versions = summarizeClientConfigVersions(client.key)
    const report = await readClientConfigCoverage(client, defaults)
    items.push({
      clientKey: client.key,
      filePath: state.filePath,
      resolvedPath: state.resolvedPath,
      format: state.format,
      exists: state.exists,
      sizeBytes: state.sizeBytes,
      modifiedTime: state.modifiedTime,
      autoFill: state.autoFill,
      coverage: report.coverage,
      pendingChanges: report.pendingChanges,
      versionCount: versions.count,
      lastVersionTime: versions.lastTime,
    })
  }
  return items
}

/**
 * 一键生效：把客户端配置指到本地服务。
 *
 * 一个客户端可能有多个可写文件（Gemini CLI 的 settings.json 与 .env），逐个走同一条
 * 「先备份再写」的路径；单个文件出错不中断其余——用户要的是「能生效的先生效」，
 * 而不是因为某个文件语法坏了就一个都不改。
 */
export async function applyClientConfigDefaults(clientKey?: string): Promise<ClientConfigFillResultItem[]> {
  const defaults = await resolveClientConfigDefaults()
  const clients = clientKey ? AGENT_CLIENT_DEFINITIONS.filter(item => item.key === clientKey) : AGENT_CLIENT_DEFINITIONS
  if (clientKey && clients.length === 0) {
    throw new AppError('NOT_FOUND', 404, `Unknown client: ${clientKey}`, { details: { path: clientKey } })
  }

  const items: ClientConfigFillResultItem[] = []
  for (const client of clients) {
    const rule = getClientApplyRule(client.key)
    const files = rule ? writableClientConfigFiles(client, rule) : []
    if (!rule || files.length === 0) {
      items.push({
        clientKey: client.key,
        status: 'skipped',
        filePaths: [],
        changeCount: 0,
        newVersions: 0,
        message: `Automatic filling is not available for ${client.name}`,
      })
      continue
    }

    const filePaths: string[] = []
    let changeCount = 0
    let newVersions = 0
    let message = ''
    for (const file of files) {
      try {
        const target = resolveClientConfigTarget(client.key, file.path)
        const values = await clientConfigFillValues(target, client, rule, defaults)
        const result = await applyClientConfigOverrides(client.key, file.path, values)
        changeCount += result.changes.length
        if (result.backedUp) newVersions += 1
        filePaths.push(file.path)
      } catch (error) {
        if (!message) message = error instanceof Error ? error.message : String(error)
      }
    }

    items.push({
      clientKey: client.key,
      status: message ? 'failed' : changeCount > 0 ? 'applied' : 'unchanged',
      filePaths,
      changeCount,
      newVersions,
      message,
    })
  }
  return items
}
