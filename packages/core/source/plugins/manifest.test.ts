import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../errors'
import {
  PLUGIN_DEFAULT_ENTRY,
  PLUGIN_ICON_FILENAME,
  PLUGIN_MANIFEST_FILENAME,
  hasUnresolvedTemplate,
  interpolateTemplate,
  loadPlugin,
  readPluginIcon,
  readPluginManifest,
  scanPlugins,
} from './manifest'

/**
 * 插件目录的扫描与校验。
 *
 * 这一层的每一道拒绝都对应一类「用户放进去一个坏目录」的具体形态：JSON 写坏、目录名与 key
 * 不一致、入口指到目录外面、声明的入口文件不存在。它们不能互相掩盖——一条统一的
 * 「清单不合法」会让本地开发时完全不知道该改哪个字段。
 */

let temporaryDirectory: string
let pluginsDirectory: string

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-plugin-manifest-'))
  pluginsDirectory = path.join(temporaryDirectory, 'plugins')
  fs.mkdirSync(pluginsDirectory, { recursive: true })
})

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

/** 落一个插件目录。`manifest` 传字符串时原样写入（用来造坏 JSON / 坏字段）。 */
function writePlugin(key: string, manifest: unknown, files: Record<string, string> = {}): string {
  const directory = path.join(pluginsDirectory, key)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, PLUGIN_MANIFEST_FILENAME),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    'utf8',
  )
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content, 'utf8')
  return directory
}

function minimalManifest(key: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { manifestVersion: 1, key, name: key, ...extra }
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

describe('plugin manifest', () => {
  it('读出清单并补齐默认值', async () => {
    const directory = writePlugin('acme-free', minimalManifest('acme-free'))

    await expect(readPluginManifest(directory, 'acme-free')).resolves.toMatchObject({
      manifestVersion: 1,
      key: 'acme-free',
      name: 'acme-free',
      description: '',
      capabilities: ['provider'],
      entry: PLUGIN_DEFAULT_ENTRY,
      dev: false,
      timeoutMilliseconds: 30_000,
      inputs: [],
      endpoints: {},
    })
  })

  it('目录名与 key 不一致时拒绝（不做「以目录名为准」的兜底）', async () => {
    const directory = writePlugin('acme-free', minimalManifest('other-key'))

    const error = await failureOf(() => readPluginManifest(directory, 'acme-free'))
    expect(error.code).toBe('PLUGIN_MANIFEST_INVALID')
    // 报错要指出「声明的是哪个 key」，否则用户只知道自己放错了目录，不知道错在哪。
    expect(error.message).toContain('other-key')
  })

  it('不传目录名时不核对 key（安装阶段读源目录用）', async () => {
    const directory = writePlugin('my-plugin-repo', minimalManifest('acme-free'))

    await expect(readPluginManifest(directory)).resolves.toMatchObject({ key: 'acme-free' })
  })

  it('JSON 写坏时把解析器的原话带出来', async () => {
    const directory = writePlugin('acme-free', '{ "manifestVersion": 1,')

    const error = await failureOf(() => readPluginManifest(directory, 'acme-free'))
    expect(error.code).toBe('PLUGIN_MANIFEST_INVALID')
    expect(error.message).toContain('not valid JSON')
  })

  it('缺 plugin.json 时说明是文件缺失，而不是「字段不合法」', async () => {
    const directory = path.join(pluginsDirectory, 'acme-free')
    fs.mkdirSync(directory, { recursive: true })

    const error = await failureOf(() => readPluginManifest(directory, 'acme-free'))
    expect(error.message).toContain(`cannot read ${PLUGIN_MANIFEST_FILENAME}`)
  })

  it('字段不合法时把 zod 的字段路径拼进错误里', async () => {
    const directory = writePlugin('acme-free', minimalManifest('acme-free', { manifestVersion: 2 }))

    const error = await failureOf(() => readPluginManifest(directory, 'acme-free'))
    expect(error.code).toBe('PLUGIN_MANIFEST_INVALID')
    expect(error.message).toContain('manifestVersion')
  })

  it('key 不满足字符集时拒绝（它同时是目录名与密钥命名空间）', async () => {
    const directory = writePlugin('acme-free', minimalManifest('Acme Free'))

    const error = await failureOf(() => readPluginManifest(directory, 'acme-free'))
    expect(error.message).toContain('Plugin key must match')
  })

  it('没有 entry.js 即声明式插件，不报错', async () => {
    const directory = writePlugin('acme-free', minimalManifest('acme-free'))

    await expect(loadPlugin(pluginsDirectory, 'acme-free')).resolves.toMatchObject({ key: 'acme-free', entryPath: null })
    expect(fs.existsSync(directory)).toBe(true)
  })

  it('有 entry.js 时给出入口的绝对路径', async () => {
    const directory = writePlugin('acme-free', minimalManifest('acme-free'), { [PLUGIN_DEFAULT_ENTRY]: 'return {}' })

    const plugin = await loadPlugin(pluginsDirectory, 'acme-free')
    expect(plugin.entryPath).toBe(path.join(directory, PLUGIN_DEFAULT_ENTRY))
  })

  it('清单显式声明了别的入口却找不到文件时报错（不静默降级成 L0）', async () => {
    writePlugin('acme-free', minimalManifest('acme-free', { entry: 'main.js' }))

    const error = await failureOf(() => loadPlugin(pluginsDirectory, 'acme-free'))
    expect(error.code).toBe('PLUGIN_ENTRY_MISSING')
    expect(error.message).toContain('main.js')
  })

  it('入口指到插件目录外面时拒绝', async () => {
    const outside = path.join(temporaryDirectory, 'outside.js')
    fs.writeFileSync(outside, 'return {}', 'utf8')
    writePlugin('acme-free', minimalManifest('acme-free', { entry: '../outside.js' }))

    const error = await failureOf(() => loadPlugin(pluginsDirectory, 'acme-free'))
    expect(error.code).toBe('PLUGIN_MANIFEST_INVALID')
    expect(error.message).toContain('points outside the plugin directory')
  })

  it('按 key 取一个不存在的插件时回 PLUGIN_NOT_FOUND', async () => {
    const error = await failureOf(() => loadPlugin(pluginsDirectory, 'missing'))
    expect(error.code).toBe('PLUGIN_NOT_FOUND')
  })
})

describe('plugin scanning', () => {
  it('插件目录不存在时回空列表（「一个都没装」不是错误）', async () => {
    await expect(scanPlugins(path.join(temporaryDirectory, 'nowhere'))).resolves.toEqual([])
  })

  it('按 key 排序，并跳过点开头与 node_modules', async () => {
    writePlugin('zeta', minimalManifest('zeta'))
    writePlugin('alpha', minimalManifest('alpha'))
    writePlugin('.git', minimalManifest('git'))
    writePlugin('node_modules', minimalManifest('node_modules'))

    await expect(scanPlugins(pluginsDirectory)).resolves.toMatchObject([{ key: 'alpha' }, { key: 'zeta' }])
  })

  it('扫描遇到坏目录时抛错（列表接口另走「一个坏目录不弄坏整页」的入口）', async () => {
    fs.mkdirSync(path.join(pluginsDirectory, 'empty'), { recursive: true })
    writePlugin('acme-free', minimalManifest('acme-free'))

    const error = await failureOf(() => scanPlugins(pluginsDirectory))
    expect(error.code).toBe('PLUGIN_MANIFEST_INVALID')
  })

  it('符号链接进来的目录也算插件（本地开发的接入形态）', async () => {
    const source = path.join(temporaryDirectory, 'source-repo')
    fs.mkdirSync(source, { recursive: true })
    fs.writeFileSync(path.join(source, PLUGIN_MANIFEST_FILENAME), JSON.stringify(minimalManifest('acme-free')), 'utf8')
    fs.symlinkSync(source, path.join(pluginsDirectory, 'acme-free'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(scanPlugins(pluginsDirectory)).resolves.toMatchObject([
      { key: 'acme-free', manifest: { key: 'acme-free' } },
    ])
  })
})

describe('plugin icon and templates', () => {
  it('读不到 icon.svg 时回 null（不是错误）', async () => {
    const directory = writePlugin('acme-free', minimalManifest('acme-free'))
    await expect(readPluginIcon(directory)).resolves.toBeNull()
  })

  it('读到 icon.svg 时回原文', async () => {
    const directory = writePlugin('acme-free', minimalManifest('acme-free'), { [PLUGIN_ICON_FILENAME]: '<svg/>' })
    await expect(readPluginIcon(directory)).resolves.toBe('<svg/>')
  })

  it('插值只替换认识的键，没填的键原样留着', () => {
    expect(interpolateTemplate('{{serverUrl}}/v1/{{path}}', { serverUrl: 'https://a.example', path: 'models' }))
      .toBe('https://a.example/v1/models')
    // 原样留着（而不是换成空串）：用户从报错里能一眼看出是哪个键没填。
    expect(interpolateTemplate('{{serverUrl}}/v1/models', {})).toBe('{{serverUrl}}/v1/models')
    expect(interpolateTemplate('{{ serverUrl }}/v1', { serverUrl: 'https://a.example' })).toBe('https://a.example/v1')
  })

  it('hasUnresolvedTemplate 认得出还剩没插上的键', () => {
    expect(hasUnresolvedTemplate('{{serverUrl}}/v1')).toBe(true)
    expect(hasUnresolvedTemplate('https://a.example/v1')).toBe(false)
  })
})
