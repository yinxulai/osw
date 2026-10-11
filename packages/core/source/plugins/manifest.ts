import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { PluginManifestSchema, type PluginManifest } from '@common/plugin'
import { pluginEntryMissingError, pluginManifestInvalidError, pluginNotFoundError } from '../errors'

/**
 * 插件目录的扫描与校验。
 *
 * 插件的事实源是**磁盘上的目录**（`<pluginsDir>/<key>/plugin.json`），不是数据库里的行——
 * 这一条决定了这里没有「注册表」：每次要用插件就读一遍目录，用户把文件夹删掉插件就没了。
 * 运行时状态（密钥、同步结果）挂在它托管的 Provider 上，见 `./state.ts`。
 *
 * 目录与清单的关系是**双向的**：目录名必须等于 `manifest.key`。不做「以目录名为准」的兜底——
 * 那会让用户改一个文件夹名就悄悄换掉托管关系（`plugin.key` 标记、密钥引用命名空间都跟着变），
 * 而他只是重命名了一下。
 */

/** 清单文件名。 */
export const PLUGIN_MANIFEST_FILENAME = 'plugin.json'
/** 可执行入口的默认文件名。 */
export const PLUGIN_DEFAULT_ENTRY = 'entry.js'
/** 可选图标的文件名。 */
export const PLUGIN_ICON_FILENAME = 'icon.svg'

/** 一个已扫描并校验通过的插件。 */
export interface ScannedPlugin {
  key: string
  /** 插件目录的绝对路径。 */
  directory: string
  manifest: PluginManifest
  /**
   * `entry.js` 的绝对路径；`null` 表示这是**声明式（L0）**插件——没有代码可执行，
   * 端点与模型清单全部来自 `plugin.json`。
   */
  entryPath: string | null
}

function pluginDirectory(pluginsDirectory: string, key: string): string {
  return join(pluginsDirectory, key)
}

/**
 * 读一个目录的清单并校验。
 *
 * `expectedKey` 传入目录名时会额外核对 `manifest.key` 是否一致（扫描与安装都走这里，
 * 两处口径必须相同，否则「安装时校验、扫描时不校验」会放进来一批坏数据）。
 */
export async function readPluginManifest(directory: string, expectedKey?: string): Promise<PluginManifest> {
  const keyForMessage = expectedKey ?? directory
  const manifestPath = join(directory, PLUGIN_MANIFEST_FILENAME)
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch (error) {
    throw pluginManifestInvalidError(keyForMessage, `cannot read ${PLUGIN_MANIFEST_FILENAME}: ${(error as Error).message}`)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (error) {
    throw pluginManifestInvalidError(keyForMessage, `${PLUGIN_MANIFEST_FILENAME} is not valid JSON: ${(error as Error).message}`)
  }

  const parsed = PluginManifestSchema.safeParse(json)
  if (!parsed.success) {
    throw pluginManifestInvalidError(keyForMessage, formatManifestIssues(parsed.error.issues))
  }
  if (expectedKey !== undefined && parsed.data.key !== expectedKey) {
    throw pluginManifestInvalidError(expectedKey, `it declares key "${parsed.data.key}", which does not match its directory name`)
  }
  return parsed.data
}

/** zod 报告的一条问题。只用其中两个字段，因此不引 zod 的类型进来。 */
interface ManifestIssue {
  path: PropertyKey[]
  message: string
}

/** zod 的问题列表压成一句可读的话：清单出错时用户要能直接照着改字段。 */
function formatManifestIssues(issues: ManifestIssue[]): string {
  return issues
    .map(issue => `${issue.path.length > 0 ? issue.path.map(String).join('.') : PLUGIN_MANIFEST_FILENAME}: ${issue.message}`)
    .join('; ')
}

/**
 * 读出入口文件的绝对路径；不存在时返回 `null`。
 *
 * 默认的 `entry.js` 缺失 = 声明式（L0），这是**正常形态**，不报错；只有显式声明了别的入口
 * 却找不到文件才是错（见 `pluginEntryMissingError`）——那种情况下的清单在骗人，
 * 静默降级成 L0 会让用户以为自己的代码在跑。
 */
async function resolveEntryPath(key: string, directory: string, entry: string): Promise<string | null> {
  const entryPath = resolve(directory, entry)
  // 入口必须落在插件目录里：`entry: "../../x.js"` 会让插件去执行别人的文件，
  // 而清单是可以从别处拷来的，这一条不能只靠自觉。
  if (!isPathInside(directory, entryPath)) {
    throw pluginManifestInvalidError(key, `entry "${entry}" points outside the plugin directory`)
  }
  if (await isFile(entryPath)) return entryPath
  if (entry === PLUGIN_DEFAULT_ENTRY) return null
  throw pluginEntryMissingError(key, entry)
}

function isPathInside(directory: string, candidate: string): boolean {
  const path = relative(resolve(directory), candidate)
  return path.length > 0 && !path.startsWith('..') && !isAbsolute(path)
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** 扫描插件目录。目录不存在时返回空列表（「一个插件都没装」不是错误）。 */
export async function scanPlugins(pluginsDirectory: string): Promise<ScannedPlugin[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(pluginsDirectory, { withFileTypes: true })
  } catch {
    return []
  }

  const plugins: ScannedPlugin[] = []
  for (const entry of entries) {
    // 只认目录与指到目录的符号链接：本地开发就是用符号链接把源码目录接进来的
    // （见 `apps/docs/specs/plugins.md` §10），因此 `isDirectory()` 为假的软链要再看一次。
    if (!entry.isDirectory() && !(entry.isSymbolicLink() && await isDirectory(join(pluginsDirectory, entry.name)))) continue
    // 点开头的目录一律跳过：`node_modules`、`.git` 这类不该被当成插件，也不该因为
    // 少一个 `plugin.json` 就在界面上报一次错（扫描是「有就用」而不是「必须全对」）。
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    plugins.push(await buildScannedPlugin(pluginsDirectory, entry.name))
  }
  return plugins.sort((left, right) => left.key.localeCompare(right.key))
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function buildScannedPlugin(pluginsDirectory: string, key: string): Promise<ScannedPlugin> {
  const directory = pluginDirectory(pluginsDirectory, key)
  const manifest = await readPluginManifest(directory, key)
  return { key, directory, manifest, entryPath: await resolveEntryPath(key, directory, manifest.entry) }
}

/**
 * 按 key 读一个插件；不存在（目录没了 / 清单坏了 / 目录名对不上）时抛 `PLUGIN_NOT_FOUND`
 * 或清单错误。
 *
 * 扫描与单点读取共用同一段构建逻辑，因此「列表里有它」与「按 key 能取到它」永远是同一个答案。
 */
export async function loadPlugin(pluginsDirectory: string, key: string): Promise<ScannedPlugin> {
  const directory = pluginDirectory(pluginsDirectory, key)
  if (!await isDirectory(directory)) throw pluginNotFoundError(key)
  return buildScannedPlugin(pluginsDirectory, key)
}

/** 读可选的 `icon.svg`（界面取不到就画通用图标）。读不出来就返回 `null`，不是错误。 */
export async function readPluginIcon(directory: string): Promise<string | null> {
  try {
    const iconPath = join(directory, PLUGIN_ICON_FILENAME)
    if (!await isFile(iconPath)) return null
    return await readFile(iconPath, 'utf8')
  } catch {
    return null
  }
}

/**
 * `{{inputKey}}` 插值。
 *
 * 端点模板与声明式 models 地址都走这里：两者都是「由用户填的地址拼出来的」，必须用同一套
 * 规则，否则同一个 `{{serverUrl}}` 在端点里生效、在 models 地址里不生效，用户没法解释。
 * 没填的键**原样留着**（而不是替换成空串）：留下的 `{{serverUrl}}` 会让地址解析失败，
 * 用户从报错里一眼看出是哪个键没填；换成空串只会得到一个看起来正常的半截地址。
 */
export function interpolateTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key: string) => values[key] ?? match)
}

/** 端点模板里是否还有没插上的键（用于「还缺哪些输入」的判断）。 */
export function hasUnresolvedTemplate(template: string): boolean {
  return /\{\{\s*[a-zA-Z0-9_-]+\s*\}\}/.test(template)
}

export { pluginDirectory }
