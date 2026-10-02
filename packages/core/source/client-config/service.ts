import { access, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
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
import { resolveLocale, type Locale } from '@common/i18n'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_ID } from '@common/schemas'
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
import { clientSupportsCurrentEnvironment, currentLocalProviderIdentity } from './environment'
import { resolveClientConfigPath } from './paths'
import { concreteProviderEntryPath, getClientApplyRule, resolveFieldValue, stripModelPrefix, type ClientApplyContext, type ClientApplyRule, type ClientFieldRole } from './rules'
import { currentShellPlatform, defaultShellProfileCandidates, envFileHeader, managedBlock, resolveShellProfilePath, stripEnvFileHeader, upsertManagedBlock, type ShellPlatform } from './shell'
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
  // 「环境装不下」排在格式之后：格式能不能写是这份文件本身的事，而我们能不能写是环境的事——
  // 前者更具体，说给用户听更近一步。
  const rule = getClientApplyRule(clientKey)
  if (!rule) return { ...base, autoFill: 'unsupported-client', detected: {} }
  if (!supportsAutoFill(target.file.format)) return { ...base, autoFill: 'unsupported-format', detected: {} }
  if (!clientSupportsCurrentEnvironment(clientKey)) return { ...base, autoFill: 'unsupported-environment', detected: {} }

  const fields = agentClientFieldsOfFile(client, filePath)

  let editor
  try {
    editor = createConfigEditor(target.file.format, raw.content, target.file.shape)
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

  // OSW 拥有的 load 文件（见 `AgentClientFileDefinition.load`）多一句「由 OSW 生成」的抬头：
  // 这份文件工具自己不会读、全靠登录 shell 加载，用户手改它不会生效，写清楚比留白好。
  const effectiveContent = target.file.load ? withEnvFileHeader(nextContent, await resolveContentLocale()) : nextContent
  if (effectiveContent !== current.content) await writeAtomic(target.resolvedPath, effectiveContent)
  if (target.file.load) await syncLoadFileShellIntegration(target)

  return { state: await readClientConfigFile(target.clientKey, target.filePath), backedUp }
}

/**
 * env 文件抬头用哪种语言：跟着设置里的界面语言走，`system` 时按 core 进程的系统语言归一。
 *
 * env 文件的读者是用户自己，抬头就该跟界面同语言；core 拿不到 `app.getLocale()` /
 * `navigator.language`（它在独立的 utilityProcess 里），沿用这里既有的 `Intl` 系统语言兜底。
 */
async function resolveContentLocale(): Promise<Locale> {
  const settings = await getSettings()
  return resolveLocale(settings.language, Intl.DateTimeFormat().resolvedOptions().locale)
}

/** env 文件顶部那句「由 OSW 生成」的注释；重复写入或换语言都不会叠加。 */
function withEnvFileHeader(content: string, locale: Locale): string {
  const header = envFileHeader(locale)
  const body = stripEnvFileHeader(content)
  if (body === '') return `${header}\n`
  return `${header}\n\n${body}`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 让登录 shell 加载这个 `load` 文件。
 *
 * 只有 `file.load` 的文件会走到这里：它承载的是客户端**只从进程环境读**的键（Copilot CLI 的
 * `COPILOT_PROVIDER_*`），工具本身不会去读这个文件，全靠登录 shell 把它带进环境。
 *
 * 落点选择与写入规则都在 `./shell` 里（存在哪个启动文件就改哪个，找到哨兵就整段替换、
 * 找不到才追加），这里只负责读盘、比对、落盘。
 *
 * 启动文件写失败**不**算整次失败：env 文件已经落盘，用户手边就有一份可用的值，大不了自己
 * `source` 一下；把它判负反而连这份值也一并回滚掉。
 */
async function syncLoadFileShellIntegration(target: ClientConfigTarget): Promise<void> {
  const platform: ShellPlatform = currentShellPlatform()
  const candidates = defaultShellProfileCandidates()

  const existingPaths: string[] = []
  for (const candidate of candidates) {
    if (await pathExists(candidate)) existingPaths.push(candidate)
  }
  const profilePath = resolveShellProfilePath(existingPaths, candidates)

  const current = await readRaw(profilePath)
  const next = upsertManagedBlock(current.content, managedBlock(platform, target.resolvedPath))
  if (next === current.content) return

  try {
    await writeAtomic(profilePath, next)
  } catch {
    // 见上：加载失败不阻断配置写入。
  }
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
    editor = createConfigEditor(target.file.format, text, target.file.shape)
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
    // 「改前」由编辑器回传，不再自己 `get` 一次：内容里的值可能是数字或布尔（`true`），
    // `get` 交回来的是它的字符串形态，写下去的是真正的 `true`——两次读到的字面写法不一样，
    // 会让「只改缩进的键」被算成一处改动。编辑器手里有那段原文，让它直接给。
    const before = editor.set(field.path, value)
    record(field.path, before, String(value))
  }

  if (rule.providerEntry) {
    const path = concreteProviderEntryPath(rule)
    const owned = path !== null && fields.some(field => rule.roles[field.key] === 'providerEntry')
    if (path && owned) {
      // 路径与内容必须用**同一套身份**展开（VS Code 的路径就是展示名），否则会写成两条互不相认的表项。
      const entry = rule.providerEntry.build(context, currentLocalProviderIdentity())
      const snapshot = editor.serialize()
      // 「改前」由编辑器回传（`get` 只认标量，读不到一个对象），但**算不算改动要看文本有没有变**：
      // 回传的是原文那一截、写进去的是规范写法，两者空白不同不等于值变了；
      // 只比值又会漏掉「一键生效点两次」这种真正没动的场合，白记一笔改动。
      const before = editor.setObject(path, entry)
      if (editor.serialize() !== snapshot) record(path, before, JSON.stringify(entry))
    }
  }

  return { changes, nextContent: editor.serialize() }
}

/**
 * 把客户端配置直接指到本地服务。
 *
 * 地址与密钥由 `resolveClientConfigDefaults()` 就地取（用户不需要、也无法在这里指定它们），
 * 调用方只给模型名。只改**属于本次目标文件**的字段：往 A 文件里写本属于 B 文件的键，
 * 会写出一个工具根本不读的东西。
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
  // 兜底同上：开发环境装不下第二套 provider 的客户端，界面不会给按钮，但接口不该因为界面没拦就写下去。
  // 这里拒绝得比「写进去」更严格是故意的——写错了是把用户正式的配置改掉，那没法自动恢复。
  if (!clientSupportsCurrentEnvironment(clientKey)) {
    throw new AppError('CLIENT_CONFIG_CLIENT_NOT_SUPPORTED', 400, `Skipped in development: ${client.name} supports only one provider, so writing it would overwrite your production configuration`, {
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
    // 例外：`load` 文件的抬头随界面语言变化。切换语言本身不产生任何字段改动，
    // 走早退分支会让抬头一直停在旧语言，所以这里比一次实际落盘内容，只在抬头确实不同时重写。
    if (target.file.load && withEnvFileHeader(plan.nextContent, await resolveContentLocale()) !== raw.content) {
      const result = await commitClientConfig(target, plan.nextContent, 'manual', 'header refresh')
      return { ...result, changes: [] }
    }
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
  // 与写入同一条判断：预览就是「保存会写成什么」，不能在开发环境里演示一段它不会去写的内容。
  if (!clientSupportsCurrentEnvironment(clientKey)) {
    throw new AppError('CLIENT_CONFIG_CLIENT_NOT_SUPPORTED', 400, `Skipped in development: ${client.name} supports only one provider, so writing it would overwrite your production configuration`, {
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
  return { origin, apiKey: CLIENT_CONFIG_SAMPLE_API_KEY, model: BUILT_IN_DEFAULT_LOGICAL_MODEL_ID }
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

  /**
   * 回读某个角色当前写着的值，在**该客户端的全部文件**里找。
   *
   * 不看目标文件一个：跨文件客户端的模型名与 provider 表项分在两个文件里（Pi 的模型名在
   * settings.json，provider 表项在 models.json），只看本次要写的那个文件时，写 models.json 就
   * 读不到用户选好的模型名，于是会把它悄悄换回兜底值。顺序上先看目标文件（就地的声明优先），
   * 再看其余文件；「内容坏了 / 格式不支持 / 字段不在这个文件里」都算这一类读不到，跳过继续找。
   */
  const read = async (role: ClientFieldRole): Promise<string | null> => {
    const ordered = [target.file, ...client.files.filter(file => file.path !== target.filePath)]
    for (const file of ordered) {
      if (!supportsAutoFill(file.format)) continue
      const field = agentClientFieldsOfFile(client, file.path).find(item => rule.roles[item.key] === role)
      if (!field) continue
      const path = resolveClientConfigPath(client.key, file.path)
      if (!path) continue
      const raw = await readRaw(path)
      if (!raw.exists) continue
      let editor: ConfigEditor
      try {
        // 必须带上 `file.shape`：缺了它，`patchList` 文件会被当成普通映射来解析，
        // 里层的字段路径（如 `agent-default-model.model`）读出来永远是空，于是跨文件回读
        // 悄悄退回兜底值。这与读路径（`readClientConfigFile`）保持一致。
        editor = createConfigEditor(file.format, raw.content, file.shape)
      } catch {
        // 内容坏了是「读不到」，不是「写不了」：跳过这个文件、兜底值照样写，
        // 语法错误会在规划那一步被报出来。
        continue
      }
      const value = editor.get(field.path)
      if (value && value.trim()) return stripModelPrefix(rule, value)
    }
    return null
  }

  const model = await read('model')
  if (model) values.model = model
  const smallModel = await read('smallModel')
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
  // 开发环境装不下的客户端直接算「不可自动生效」：不能去跑 dry run——那个规划算的是「正式环境
  // 会写成什么」，把它当成这一行的状态会让列表显示「待写入几项」，点下去却什么也不该发生。
  if (!clientSupportsCurrentEnvironment(client.key)) return { coverage: 'unavailable', pendingChanges: 0 }
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
    // 主文件的状态就是这一行的状态：声明了多个文件的客户端在详情页里再看逐文件。
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
 * 一个客户端可能有多个可写文件，逐个走同一条
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
    // 开发环境装不下第二套 provider 的客户端在这里被**忽略**：写进去就是抢正式环境那一套。
    // 这是「按用户要求跳过」而不是「出错」，所以在结果里同样算 `skipped`，与「本来就没有配方」同类。
    if (!clientSupportsCurrentEnvironment(client.key)) {
      items.push({
        clientKey: client.key,
        status: 'skipped',
        filePaths: [],
        changeCount: 0,
        newVersions: 0,
        message: `Skipped in development: ${client.name} supports only one provider, so writing it would overwrite your production configuration`,
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
