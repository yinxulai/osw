import { describe, expect, it } from 'vitest'
import { PROXY_INTERFACE_IDS, PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { INTERFACE_DESCRIPTION_KEYS } from '@/components/interface-entries'
import { getTranslator } from '@/i18n/active'

/*
 * 「本服务受理哪些接口」的界面清单。
 *
 * 契约层是事实来源（`PROXY_INTERFACE_ENTRIES`），这里只补每行的中文说明。用例守的是
 * **两边一一对应**：契约层加了接口而这里忘了补说明，就该红；多了没主的说明也该红。
 * 类型上的 `Record<ProxyInterfaceId, UiCatalogKey>` 已经在编译期挡了一半，这里再挡
 * 「文案 key 打错字」那一半。
 */

describe('接口清单与中文说明', () => {
  it('契约层的每个接口都有说明，不多不少', () => {
    expect(Object.keys(INTERFACE_DESCRIPTION_KEYS).sort()).toEqual([...PROXY_INTERFACE_IDS].sort())
  })

  it('说明 key 都能取到词（不是打错字的死 key）', () => {
    const t = getTranslator('zh-CN')

    for (const key of Object.values(INTERFACE_DESCRIPTION_KEYS)) {
      const text = t(key)
      expect(text).toBeTruthy()
      // 目录里缺 key 时取词函数会原样回吐 key 本身，这就是「死 key」的特征。
      expect(text).not.toBe(key)
    }
  })

  it('每个接口的说明各不相同（复制粘贴容易漏改）', () => {
    const t = getTranslator('zh-CN')
    const texts = Object.values(INTERFACE_DESCRIPTION_KEYS).map(key => t(key))

    expect(new Set(texts).size).toBe(texts.length)
  })

  it('中文说明不与协议正式名重复（正式名由 PROTOCOL_DISPLAY_NAMES 提供）', () => {
    const t = getTranslator('zh-CN')
    const descriptions = Object.values(INTERFACE_DESCRIPTION_KEYS).map(key => t(key))

    for (const description of descriptions) {
      expect(description).not.toContain('OpenAI')
      expect(description).not.toContain('Anthropic')
    }
  })

  it('接口数量与契约层的注册表一致（少一个说明就少一行）', () => {
    expect(PROXY_INTERFACE_ENTRIES.length).toBe(PROXY_INTERFACE_IDS.length)
    expect(Object.keys(INTERFACE_DESCRIPTION_KEYS)).toHaveLength(PROXY_INTERFACE_ENTRIES.length)
  })

  it('只列兜底模型的入口也在这份清单里（它有说明，只是没有协议名）', () => {
    const modelsEntry = PROXY_INTERFACE_ENTRIES.find(entry => entry.id === 'models')

    expect(modelsEntry?.protocol).toBeNull()
    expect(INTERFACE_DESCRIPTION_KEYS.models).toBe('access.interface.entry.models')
  })
})
