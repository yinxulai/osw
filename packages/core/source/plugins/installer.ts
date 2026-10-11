import { mkdir, readdir, rm, symlink, lstat, stat, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { PLUGIN_KEY_PATTERN } from '@common/plugin'
import { pluginSourceUnsupportedError, pluginManifestInvalidError } from '../errors'
import { PLUGIN_MANIFEST_FILENAME, pluginDirectory, readPluginManifest, loadPlugin, type ScannedPlugin } from './manifest'

/**
 * 插件的安装与卸载（只有「把目录接进插件目录」这一件事）。
 *
 * **P0 只支持本地目录**，而且以**符号链接**接入而不是拷贝：
 *
 * - 拷贝意味着「安装」之后就有一份副本，本地开发时改源码不生效——必须重新安装，
 *   而这恰好是插件机制最需要顺手的场景（见 `apps/docs/specs/plugins.md` §10）。
 * - 符号链接让「插件目录即源码目录」，改一行 `entry.js` 点一下「重新同步」就是新代码。
 *
 * P1 的 GitHub 安装（`{ type: 'github', … }`）明确回 `PLUGIN_SOURCE_UNSUPPORTED`：
 * 只支持一半的安装来源，比明说不支持更难排查。
 */
/** 安装来源（比契约里的判别联合宽一点：这里要能把「不认识的类型」报成一句可读的错）。 */
type InstallSourceInput = { type: string } & Record<string, unknown>

export async function installPlugin(pluginsDirectory: string, source: InstallSourceInput): Promise<ScannedPlugin> {
  if (source.type !== 'directory') {
    // 这里刻意**不做半个实现**（不偷偷当成本地路径、也不去猜 repo）：
    // 「不支持」是一句用户能照做的话，而「支持了一半」是一类查不出来的故障。
    throw pluginSourceUnsupportedError(source.type === 'github' ? 'a GitHub repository' : String(source.type))
  }
  const rawPath = typeof source.path === 'string' ? source.path.trim() : ''
  if (rawPath.length === 0) throw pluginManifestInvalidError('(unknown)', 'the install path is empty')
  const sourceDirectory = resolve(rawPath)
  const key = await readSourceKey(sourceDirectory)
  const target = pluginDirectory(pluginsDirectory, key)

  await mkdir(pluginsDirectory, { recursive: true })
  if (await exists(target)) {
    // 已经装过同一个 key：**不覆盖**。覆盖一个软链是安全的，但如果目标是个真目录
    // （用户手放的、或上一版拷贝进来的），删它会连插件自己的文件一起删掉。
    // 要重装就先卸载——那是一次显式动作，用户知道自己在删什么。
    throw pluginManifestInvalidError(key, `a plugin directory named "${key}" already exists, uninstall it first`)
  }

  await createDirectoryLink(sourceDirectory, target)
  return loadPlugin(pluginsDirectory, key)
}

/**
 * 读源目录的插件 key。
 *
 * 校验就在这一步发生（`readPluginManifest` 必填 `plugin.json` 且与目录名相符）：
 * 先把坏目录接进来、再在扫描时报错，用户会得到「插件列表里有一个报错的条目」，
 * 而他刚做的是「安装」——错误该落在安装这一步上（见 §10 的「校验前置」）。
 */
async function readSourceKey(sourceDirectory: string): Promise<string> {
  if (!await isDirectory(sourceDirectory)) {
    throw pluginManifestInvalidError(basename(sourceDirectory) || sourceDirectory, 'the install path is not a directory')
  }
  if (!await exists(join(sourceDirectory, PLUGIN_MANIFEST_FILENAME))) {
    throw pluginManifestInvalidError(basename(sourceDirectory), `the directory has no ${PLUGIN_MANIFEST_FILENAME}`)
  }
  const manifest = await readPluginManifest(sourceDirectory)
  // 目录名不必等于 key（源码目录常叫 `my-plugin-repo`），但**接入后的目录名必须是 key**，
  // 因此这里只按 key 建链接，不要求源目录名一致。
  return manifest.key
}

/**
 * 建目录链接。
 *
 * Windows 上用 **junction**（目录重排点）而不是符号链接：符号链接需要管理员权限或
 * 开发者模式，而 junction 对普通用户可用。它只支持本地绝对路径——正好是这里的场景。
 */
async function createDirectoryLink(sourceDirectory: string, target: string): Promise<void> {
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  try {
    await symlink(sourceDirectory, target, type)
  } catch (error) {
    throw pluginManifestInvalidError(basename(target), `cannot link the plugin directory: ${(error as Error).message}`)
  }
}

/**
 * 卸载：删掉插件目录。
 *
 * **只删链接本身，不跟随链接删源目录**：`lstat` + `unlink` 对符号链接/junction 是「删这个入口」，
 * 而 `rm -r` 会沿着链接一路删下去，把用户的源码仓库清空——这是这个功能里唯一可能造成
 * 不可恢复损失的一步，因此不走通用的递归删除。
 */
export async function removePluginDirectory(pluginsDirectory: string, key: string): Promise<void> {
  // key 会被拼进路径，必须先是合法 key。插件 key 的字符集（`[a-z][a-z0-9-]*`）不含路径分隔符
  // 与 `..`，所以通过这道门就不可能有「删到插件目录外面」的路径（key 是从目录名/接口来的）。
  if (!PLUGIN_KEY_PATTERN.test(key)) throw pluginManifestInvalidError(key, 'the plugin key is not valid')
  const target = pluginDirectory(pluginsDirectory, key)
  let info
  try {
    info = await lstat(target)
  } catch {
    return
  }
  if (info.isSymbolicLink()) {
    await unlink(target)
    return
  }
  // 真目录（用户手放的插件）：里面若还嵌着链接，`rm` 只删链接本身、不会穿透。
  await rm(target, { recursive: true, force: true })
}
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 插件目录里的全部 key（含装不上的那些目录）。
 *
 * 列表接口不能直接用 `scanPlugins`：一个 `plugin.json` 写坏的目录会让它整个抛错，
 * 而用户看到的将是「插件列表打不开」——比「某个插件报错」糟糕得多。
 */
export async function listPluginDirectories(pluginsDirectory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(pluginsDirectory, { withFileTypes: true })
  } catch {
    return []
  }
  const keys: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    if (entry.isDirectory()) {
      keys.push(entry.name)
      continue
    }
    // 本地开发用的链接（见 `createDirectoryLink`）：`isDirectory()` 为假，得再看一次。
    if (entry.isSymbolicLink() && await isDirectory(join(pluginsDirectory, entry.name))) keys.push(entry.name)
  }
  return keys.sort((left, right) => left.localeCompare(right))
}
