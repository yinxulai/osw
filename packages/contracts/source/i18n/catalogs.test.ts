/**
 * 目录门禁（对应 `apps/docs/specs/i18n.md` §9 第 2/3 条）。
 *
 * 编译期已经保证两件事：`uiZhCN` 的类型是 `Record<keyof typeof uiEn, MessageValue>`（不会少 key），
 * `t('…')` 的 key 会在编译期校验（不会拼错）。这里补的是编译期看不见的那部分：
 * 值本身是不是空的 / 是不是占位符、有没有**谁都不引用**的死 key、
 * 以及错误码枚举与 `errors.<CODE>` 文案是否一一对应。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ApiErrorCodeSchema } from '@common/schemas'
import { CATALOGS, uiEn, uiZhCN } from './catalogs'
import { diffCatalogKeys } from './index'
import { LOCALES, type Catalog, type MessageValue } from './types'

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** 生产源码分布在各个包内；这里必须覆盖全部宿主侧入口，否则「死 key」结论只是漏扫的假象。 */
const SOURCE_DIRECTORIES = [
  'packages/console/source',
  'packages/contracts/source',
  'packages/core/source',
  'apps/app/source',
  // 命令行宿主用的是同一份目录（`native.cli.*`）：漏掉它，那批 key 会被误判成死 key。
  'apps/cli/source',
]

/** 动态拼 key 的调用点：`` t(`errors.${code}`) `` 这种扫描不到字面量，只能按前缀豁免。 */
const DYNAMIC_KEY_PREFIXES = ['errors.', 'failureReason.']

function collectSourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      found.push(...collectSourceFiles(fullPath))
      continue
    }
    if (/\.tsx?$/.test(entry)) found.push(fullPath)
  }
  return found
}

interface ScanResult {
  referenced: Set<string>
  fileCount: number
}

/**
 * 扫描生产源码里出现的文案引用。
 *
 * 判定方式是「key 字面量在源码里出现过」——`t('a.b')`、`{ labelKey: 'a.b' }`
 * （`Record<K, UiCatalogKey>` 的映射表）都会被算进来，不需要理解调用形态。
 */
function collectReferencedKeys(): ScanResult {
  const referenced = new Set<string>()
  const files = SOURCE_DIRECTORIES.flatMap(directory => collectSourceFiles(path.join(REPO_ROOT, directory)))
  // 键表与「前缀 → 键」映射只算一次。放进文件循环里意味着每个文件都重新 `Object.keys`
  // 一遍、并对每个键跑一次 `startsWith`——上千文件 × 上千键，满负载跑全量时会顶到默认超时。
  const keys = Object.keys(uiEn)
  const keysByPrefix = DYNAMIC_KEY_PREFIXES.map(prefix => [prefix, keys.filter(key => key.startsWith(prefix))] as const)
  for (const file of files) {
    if (file.includes(path.join('i18n', 'catalogs'))) continue
    const content = readFileSync(file, 'utf8')
    for (const key of keys) {
      if (content.includes(key)) referenced.add(key)
    }
    for (const [prefix, prefixedKeys] of keysByPrefix) {
      if (content.includes(`${prefix}\${`)) {
        for (const key of prefixedKeys) referenced.add(key)
      }
    }
  }
  return { referenced, fileCount: files.length }
}

/** 值必须是「非空、不是占位符」的字符串；复数对象要求每一档都合法。 */
function invalidValues(catalog: Catalog): string[] {
  const invalid: string[] = []
  for (const [key, value] of Object.entries(catalog)) {
    const variants: MessageValue[] = typeof value === 'string' ? [value] : Object.values(value)
    if (variants.length === 0) invalid.push(`${key}: 复数对象没有任何分档`)
    for (const variant of variants) {
      if (typeof variant !== 'string' || variant.trim() === '') invalid.push(`${key}: 空值`)
      else if (/TODO|FIXME/.test(variant)) invalid.push(`${key}: 占位文案 ${variant}`)
    }
  }
  return invalid
}

describe('i18n 目录', () => {
  it('en 与 zh-CN 的 key 集合一致', () => {
    const diff = diffCatalogKeys(uiEn, uiZhCN)
    expect({ missing: diff.missing, extra: diff.extra }).toEqual({ missing: [], extra: [] })
  })

  it('每个语言都有目录', () => {
    for (const locale of LOCALES) {
      expect(CATALOGS[locale], `缺少 ${locale} 目录`).toBeDefined()
    }
  })

  it('没有空值与占位文案', () => {
    for (const locale of LOCALES) {
      expect(invalidValues(CATALOGS[locale]), `${locale} 目录存在非法值`).toEqual([])
    }
  })

  it('没有无人引用的死 key', () => {
    const { referenced, fileCount } = collectReferencedKeys()
    // 自检：扫描必须真的走到了各个子目录，否则「死 key」结论只是漏扫的假象。
    expect(fileCount, '扫描到的源码文件太少，检查 collectSourceFiles').toBeGreaterThan(200)
    const unused = Object.keys(uiEn).filter(key => !referenced.has(key))
    expect(unused, '这些 key 在源码里没有任何引用').toEqual([])
    // 这条用例要读上千个源文件，耗时随仓库规模线性增长：满负载跑全量、且叠加 v8 覆盖率插桩时
    // 会超过 vitest 默认的 5s。它是**真的在扫盘**，不是卡死，所以显式放宽而不是压缩扫描范围
    //（少扫一个目录，「死 key」结论就会变成漏扫的假象）。
  }, 30_000)

  it('每个 API 错误码都有本地化文案，且没有多余的错误码 key', () => {
    const codeKeys = Object.keys(uiEn).filter(key => key.startsWith('errors.'))
    const expected = ApiErrorCodeSchema.options.map(code => `errors.${code}`)
    expect([...codeKeys].sort()).toEqual([...expected].sort())
  })
})
