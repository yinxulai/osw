import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_CLIENT_DEFINITION_BY_KEY, AGENT_CLIENT_DEFINITIONS, AGENT_CLIENT_ICON_URL_BY_KEY } from './index'

/**
 * 定义住在契约包里（`@common/clients`），图标却是打包器扫出来的——两边靠**目录名**对齐。
 * 图标扫描是最容易静默出错的那种代码：glob 路径写错只会得到空表，界面上少一张图而没人知道。
 * 因此下面拿 `readdirSync` 的结果与定义列表直接做集合比对。
 */
const contractsClientsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../contracts/source/clients')

/** 契约包里真实存在的客户端目录。 */
function clientDirectories(): string[] {
  return readdirSync(contractsClientsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

describe('agent client registry', () => {
  it('scans every client directory', () => {
    expect(AGENT_CLIENT_DEFINITIONS.length).toBeGreaterThan(0)
  })

  it('indexes by the same key it declares', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      expect(AGENT_CLIENT_DEFINITION_BY_KEY[client.key]).toBe(client)
      expect(AGENT_CLIENT_ICON_URL_BY_KEY[client.key]).toBe(client.iconUrls)
    }
  })

  it('orders clients by descending order weight', () => {
    const orders = AGENT_CLIENT_DEFINITIONS.map(client => client.order)
    expect(orders).toEqual([...orders].sort((left, right) => right - left))
    // 权重是逐个手填的：重复值不会报错（排序会按 key 兜底），但那是漏改的痕迹。
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('gives every client a distinct key', () => {
    const keys = AGENT_CLIENT_DEFINITIONS.map(client => client.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every client both a light and a dark icon', () => {
    // 图标 URL 在生产构建里是指向资源文件的路径，在测试里被内联成 data URI，
    // 所以这里只断言两侧都解析出了一个非空地址。
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      expect(client.iconUrls.light).toBeTruthy()
      expect(client.iconUrls.dark).toBeTruthy()
    }
  })

  it('describes every client', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      expect(client.name.trim().length).toBeGreaterThan(0)
      expect(client.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('gives every https website a bare origin', () => {
    // 有的客户端（Pi、DeepSeek Harness）没有可引用的官网，允许缺省。
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      if (client.websiteUrl) {
        expect(client.websiteUrl).toMatch(/^https:\/\/[^/]+\.[^/]+/)
      }
    }
  })

  it('locates every config under a home-relative dir', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      expect(client.configDir).toMatch(/^~\//)
      expect(client.files.length).toBeGreaterThan(0)
      for (const file of client.files) {
        expect(file.path).toMatch(/^~\//)
        expect(file.purpose.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('describes each config field with a path and a purpose', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      expect(client.fields.length).toBeGreaterThan(0)
      for (const field of client.fields) {
        expect(field.key.trim().length).toBeGreaterThan(0)
        expect(field.path.trim().length).toBeGreaterThan(0)
        expect(field.description.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('lists configuration files without duplicates', () => {
    for (const client of AGENT_CLIENT_DEFINITIONS) {
      const paths = client.files.map(file => file.path)
      expect(new Set(paths).size).toBe(paths.length)
    }
  })

  it('每个契约目录都对应一条定义，每条定义也都对应一个目录', () => {
    expect(AGENT_CLIENT_DEFINITIONS.map(client => client.key).sort()).toEqual(clientDirectories())
  })

  it('每个目录里都真的有图标（只给一张图时主题回退，一张都没有才报错）', () => {
    for (const key of clientDirectories()) {
      const dir = join(contractsClientsDir, key)
      expect(existsSync(join(dir, 'definition.json'))).toBe(true)
      const hasShared = existsSync(join(dir, 'icon.svg'))
      const hasLight = existsSync(join(dir, 'icon.light.svg'))
      // 单图形式（icon.svg）与双图形式至少要满足一种，否则注册表会在导入时抛错。
      expect(hasShared || hasLight).toBe(true)
    }
  })
})
