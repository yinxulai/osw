import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../errors'
import { PLUGIN_MANIFEST_FILENAME, loadPlugin } from './manifest'
import { installPlugin, listPluginDirectories, removePluginDirectory } from './installer'

/**
 * 安装与卸载。
 *
 * 这里最要紧的一条断言是**卸载不跟随链接**：安装是以目录链接接入的（源码目录即插件目录），
 * 卸载若用递归删除就会顺着链接把用户的源码仓库清空。这不是「顺手检查一下」，
 * 而是这个功能里唯一可能造成不可恢复损失的一步，必须有测试钉住。
 */

let temporaryDirectory: string
let pluginsDirectory: string
let sourceDirectory: string

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-plugin-installer-'))
  pluginsDirectory = path.join(temporaryDirectory, 'plugins')
  sourceDirectory = path.join(temporaryDirectory, 'my-plugin-repo')
  fs.mkdirSync(sourceDirectory, { recursive: true })
  writeManifest(sourceDirectory, { manifestVersion: 1, key: 'acme-free', name: 'Acme Free' })
})

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function writeManifest(directory: string, manifest: unknown): void {
  fs.writeFileSync(
    path.join(directory, PLUGIN_MANIFEST_FILENAME),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    'utf8',
  )
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

describe('plugin install', () => {
  it('把源码目录以链接接入，目录名用清单里的 key（源目录名可以随便叫）', async () => {
    const plugin = await installPlugin(pluginsDirectory, { type: 'directory', path: sourceDirectory })

    expect(plugin.key).toBe('acme-free')
    expect(plugin.directory).toBe(path.join(pluginsDirectory, 'acme-free'))
    expect(fs.existsSync(path.join(pluginsDirectory, 'acme-free', PLUGIN_MANIFEST_FILENAME))).toBe(true)
    await expect(listPluginDirectories(pluginsDirectory)).resolves.toEqual(['acme-free'])
  })

  it('改动源码立即生效（接入的是同一个目录，不是副本）', async () => {
    await installPlugin(pluginsDirectory, { type: 'directory', path: sourceDirectory })
    fs.writeFileSync(path.join(sourceDirectory, 'entry.js'), 'return {}', 'utf8')

    const plugin = await loadPlugin(pluginsDirectory, 'acme-free')
    expect(plugin.entryPath).toBe(path.join(pluginsDirectory, 'acme-free', 'entry.js'))
    expect(fs.readFileSync(plugin.entryPath as string, 'utf8')).toBe('return {}')
  })

  it('重复装同一个 key 时拒绝，并要求先卸载', async () => {
    await installPlugin(pluginsDirectory, { type: 'directory', path: sourceDirectory })

    const error = await failureOf(() => installPlugin(pluginsDirectory, { type: 'directory', path: sourceDirectory }))
    expect(error.code).toBe('PLUGIN_MANIFEST_INVALID')
    expect(error.message).toContain('already exists')
  })

  it('github 来源明确回「不支持」而不是猜半个实现', async () => {
    const error = await failureOf(() => installPlugin(pluginsDirectory, { type: 'github', repo: 'acme/free-models' }))
    expect(error.code).toBe('PLUGIN_SOURCE_UNSUPPORTED')
    expect(error.message).toContain('GitHub repository')
  })

  it('路径为空时拒绝', async () => {
    const error = await failureOf(() => installPlugin(pluginsDirectory, { type: 'directory', path: '   ' }))
    expect(error.message).toContain('install path is empty')
  })

  it('源路径不是目录时拒绝', async () => {
    const file = path.join(temporaryDirectory, 'not-a-directory.txt')
    fs.writeFileSync(file, 'x', 'utf8')

    const error = await failureOf(() => installPlugin(pluginsDirectory, { type: 'directory', path: file }))
    expect(error.message).toContain('not a directory')
  })

  it('源目录没有 plugin.json 时拒绝（校验前置，不放进插件目录再报错）', async () => {
    const bare = path.join(temporaryDirectory, 'bare')
    fs.mkdirSync(bare, { recursive: true })

    const error = await failureOf(() => installPlugin(pluginsDirectory, { type: 'directory', path: bare }))
    expect(error.message).toContain(PLUGIN_MANIFEST_FILENAME)
    expect(fs.existsSync(path.join(pluginsDirectory, 'bare'))).toBe(false)
  })

  it('源目录清单不合法时拒绝', async () => {
    writeManifest(sourceDirectory, '{ "manifestVersion": 1,')

    const error = await failureOf(() => installPlugin(pluginsDirectory, { type: 'directory', path: sourceDirectory }))
    expect(error.code).toBe('PLUGIN_MANIFEST_INVALID')
  })

  it('把插件目录建出来（首次安装时它还不存在）', async () => {
    await expect(listPluginDirectories(pluginsDirectory)).resolves.toEqual([])

    await installPlugin(pluginsDirectory, { type: 'directory', path: sourceDirectory })

    expect(fs.statSync(pluginsDirectory).isDirectory()).toBe(true)
  })
})

describe('plugin uninstall', () => {
  it('只删链接本身，源目录与源码必须还在', async () => {
    await installPlugin(pluginsDirectory, { type: 'directory', path: sourceDirectory })
    fs.writeFileSync(path.join(sourceDirectory, 'entry.js'), 'return {}', 'utf8')

    await removePluginDirectory(pluginsDirectory, 'acme-free')

    expect(fs.existsSync(path.join(pluginsDirectory, 'acme-free'))).toBe(false)
    expect(fs.existsSync(sourceDirectory)).toBe(true)
    expect(fs.readFileSync(path.join(sourceDirectory, 'entry.js'), 'utf8')).toBe('return {}')
    expect(fs.existsSync(path.join(sourceDirectory, PLUGIN_MANIFEST_FILENAME))).toBe(true)
  })

  it('删掉手放进去的真目录（不是链接）', async () => {
    const manual = path.join(pluginsDirectory, 'acme-free')
    fs.mkdirSync(manual, { recursive: true })
    writeManifest(manual, { manifestVersion: 1, key: 'acme-free', name: 'Acme Free' })

    await removePluginDirectory(pluginsDirectory, 'acme-free')

    expect(fs.existsSync(manual)).toBe(false)
  })

  it('删一个本来就不存在的插件不报错（重复卸载是幂等的）', async () => {
    await expect(removePluginDirectory(pluginsDirectory, 'missing')).resolves.toBeUndefined()
  })

  it('非法 key 直接拒绝（它会被拼进路径）', async () => {
    const error = await failureOf(() => removePluginDirectory(pluginsDirectory, '../escape'))
    expect(error.code).toBe('PLUGIN_MANIFEST_INVALID')
    expect(error.message).toContain('not valid')
  })
})

describe('plugin directory listing', () => {
  it('目录不存在时回空列表', async () => {
    await expect(listPluginDirectories(path.join(temporaryDirectory, 'nowhere'))).resolves.toEqual([])
  })

  it('列出链接与真目录，跳过点开头与 node_modules，按名字排序', async () => {
    fs.mkdirSync(path.join(pluginsDirectory, 'zeta'), { recursive: true })
    fs.mkdirSync(path.join(pluginsDirectory, 'alpha'), { recursive: true })
    fs.mkdirSync(path.join(pluginsDirectory, 'node_modules'), { recursive: true })
    fs.mkdirSync(path.join(pluginsDirectory, '.git'), { recursive: true })
    fs.symlinkSync(sourceDirectory, path.join(pluginsDirectory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')

    // 只认目录名：这里不读清单，坏目录也要出现在列表里（界面得能显示「这个装不上」）。
    await expect(listPluginDirectories(pluginsDirectory)).resolves.toEqual(['alpha', 'linked', 'zeta'])
  })

  it('跳过散落的文件', async () => {
    fs.mkdirSync(pluginsDirectory, { recursive: true })
    fs.writeFileSync(path.join(pluginsDirectory, 'README.md'), 'x', 'utf8')
    fs.mkdirSync(path.join(pluginsDirectory, 'acme-free'), { recursive: true })

    await expect(listPluginDirectories(pluginsDirectory)).resolves.toEqual(['acme-free'])
  })
})
