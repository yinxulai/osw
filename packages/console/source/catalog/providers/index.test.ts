import { describe, expect, it } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PROVIDER_DEFINITION_BY_KEY, PROVIDER_DEFINITIONS, PROVIDER_ICON_URL_BY_KEY } from './index'

/*
 * 内置供应商注册表。
 *
 * 这里的每一项都是**目录扫描**的结果（`import.meta.glob` 找 `provider.json` + 两张图标），
 * 所以最该守住的是「磁盘上的目录」与「代码里的定义」逐项对上：
 * 少一张图标时注册表会抛错、界面直接白屏，而多出一个没登记的定义只会让某家厂商静静消失。
 *
 * 同类事故已经发生过一次（账单背景图标因为 glob 路径写错而静默清空），
 * 因此下面有一条用例是拿 `readdirSync` 的结果与定义列表做集合比对，而不是只看定义自己。
 */

const catalogDir = dirname(fileURLToPath(import.meta.url))

function providerDirectories(): string[] {
  return readdirSync(catalogDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

describe('供应商注册表', () => {
  it('扫描到的目录与定义列表一一对应（多一个少一个都不行）', () => {
    expect(PROVIDER_DEFINITIONS.map(provider => provider.key).sort()).toEqual(providerDirectories())
  })

  it('权重大的排在前面（曝光顺序由 provider.json 决定，不是目录名拼写）', () => {
    const orders = PROVIDER_DEFINITIONS.map(provider => provider.order)
    expect(orders).toEqual([...orders].sort((left, right) => right - left))
    // 七牛云是 9999，专门用来钉住「置顶」这个语义。
    expect(PROVIDER_DEFINITIONS[0].key).toBe('qiniu')
  })

  it('三个索引按同一个 key 指向同一份对象', () => {
    for (const provider of PROVIDER_DEFINITIONS) {
      expect(PROVIDER_DEFINITION_BY_KEY[provider.key]).toBe(provider)
      expect(PROVIDER_ICON_URL_BY_KEY[provider.key]).toBe(provider.iconUrls)
    }
  })

  it('每个供应商都有两张图标（图标 URL 在测试里被内联成 data URI）', () => {
    for (const provider of PROVIDER_DEFINITIONS) {
      expect(provider.iconUrls.light).toBeTruthy()
      expect(provider.iconUrls.dark).toBeTruthy()
    }
  })

  it('每个目录里真的躺着那三份资源（注册表抛错的条件就是这里缺文件）', () => {
    for (const key of providerDirectories()) {
      expect(existsSync(join(catalogDir, key, 'provider.json'))).toBe(true)
      expect(existsSync(join(catalogDir, key, 'icon.light.svg'))).toBe(true)
      expect(existsSync(join(catalogDir, key, 'icon.dark.svg'))).toBe(true)
    }
  })

  it('名字、颜色、官网都填齐了', () => {
    for (const provider of PROVIDER_DEFINITIONS) {
      expect(provider.name.trim().length).toBeGreaterThan(0)
      expect(provider.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(provider.websiteUrl).toMatch(/^https:\/\/[^/]+\.[^/]+/)
    }
  })

  it('远端端点都是绝对的 https 地址（本地服务是唯一的例外）', () => {
    for (const provider of PROVIDER_DEFINITIONS) {
      const endpoints = Object.values(provider.endpoints) as string[]
      expect(endpoints.length).toBeGreaterThan(0)
      if (provider.key === 'ollama') continue
      for (const url of endpoints) {
        expect(url).toMatch(/^https:\/\//)
      }
    }
  })

  it('本地服务的端点指向本机（Ollama 不会往公网发）', () => {
    // Ollama 是唯一带 loopback 地址的供应商，那也是它唯一能用的地址。
    const ollama = PROVIDER_DEFINITION_BY_KEY.ollama
    expect(ollama).toBeTruthy()
    expect(Object.values(ollama.endpoints).every(url => /^http:\/\/(localhost|127\.0\.0\.1)/.test(url as string))).toBe(true)
    // 反过来说：除了它，没有第二家把请求发到自己机器上。
    const loopback = PROVIDER_DEFINITIONS.filter(provider =>
      Object.values(provider.endpoints).some(url => /localhost|127\.0\.0\.1/.test(url as string)))
    expect(loopback.map(provider => provider.key)).toEqual(['ollama'])
  })

  it('别名在表内唯一，且不与其他供应商的 key 撞车', () => {
    const providerKeys = new Set(PROVIDER_DEFINITIONS.map(provider => provider.key))
    const seen = new Set<string>()
    for (const provider of PROVIDER_DEFINITIONS) {
      const aliases = provider.aliases ?? []
      // 别名里带上自己的 key 是合法的（七牛云就列了 `qiniu`），它就是给用户搜的。
      expect(new Set(aliases).size).toBe(aliases.length)
      for (const alias of aliases) {
        expect(providerKeys.has(alias) && alias !== provider.key).toBe(false)
        expect(seen.has(alias)).toBe(false)
        seen.add(alias)
      }
    }
  })
})
