import { describe, expect, it } from 'vitest'
import { AGENT_CLIENT_DEFINITION_BY_KEY, AGENT_CLIENT_DEFINITIONS, AGENT_CLIENT_ICON_URL_BY_KEY } from './index'

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
})
